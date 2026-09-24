import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../helpers";
import { encryptSecret } from "@/lib/settings/secret";
import { attachDrive, includeDocument, processStep, rebuildConflicts } from "@/lib/evidence/jobs";
import { appendUpload, beginUpload, createIntake, finishUpload } from "@/lib/evidence/store";
import { extractEvidence } from "@/lib/evidence/extract";
import { DRIVE_FOLDER_MIME, DRIVE_SHORTCUT_MIME, DriveError, downloadDriveFile, getDriveFile, listDriveChildren, refreshAccessToken, type DriveFile } from "@/lib/evidence/drive";

vi.mock("@/lib/evidence/drive", async (original) => ({
  ...await original<typeof import("@/lib/evidence/drive")>(),
  downloadDriveFile: vi.fn(), getDriveFile: vi.fn(), listDriveChildren: vi.fn(), refreshAccessToken: vi.fn(),
}));
vi.mock("@/lib/evidence/extract", async (original) => {
  const actual = await original<typeof import("@/lib/evidence/extract")>();
  return { ...actual, extractEvidence: vi.fn(actual.extractEvidence) };
});

const folder = (id: string, name = id): DriveFile => ({ id, name, mimeType: DRIVE_FOLDER_MIME });
const textFile = (id: string, version = "1", name = `${id}.txt`): DriveFile => ({ id, name, version, mimeType: "text/plain" });
const profile = (name: string) => Buffer.from(`Company profile\nCompany name: ${name}\nBusiness activity: Poultry distribution\nCurrency: IDR\n`);
const URL = "https://drive.google.com/drive/folders/root";

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  vi.stubEnv("SETTINGS_SECRET", "evidence-job-test-secret-32-characters-long");
  vi.mocked(refreshAccessToken).mockResolvedValue({ accessToken: "access", expiresIn: 3600 });
  vi.mocked(getDriveFile).mockImplementation(async (_token, id) => folder(id, "Citra Ternak synthetic"));
  vi.mocked(downloadDriveFile).mockImplementation(async (_token, file) => ({ name: file.name, data: profile(file.id) }));
});
afterEach(() => { vi.unstubAllEnvs(); });

async function setup() {
  const firm = await db.firm.create({ data: { name: "Synthetic accounting firm" } });
  await db.driveConnection.create({ data: { firmId: firm.id, refreshToken: encryptSecret("refresh") } });
  const intake = await createIntake(db, firm.id);
  await attachDrive(db, firm.id, intake.id, URL);
  return { firmId: firm.id, intakeId: intake.id };
}
async function finish(ids: Awaited<ReturnType<typeof setup>>) {
  for (let step = 0; step < 30; step++) {
    const result = await processStep(db, ids.firmId, ids.intakeId);
    if (result.error) throw new Error(result.error);
    if (!result.more) return;
  }
  throw new Error("Intake failed to finish in 30 bounded steps");
}
async function document(ids: Awaited<ReturnType<typeof setup>>, sourceKey: string) {
  return db.evidenceDocument.findUniqueOrThrow({ where: { intakeId_sourceKey: { intakeId: ids.intakeId, sourceKey } }, include: { versions: true } });
}

describe("Drive intake jobs", () => {
  it("ignores loose code and tooling files without downloading them", async () => {
    const codeNames = ["build.cjs", "task.py", "package-lock.json", ".gitignore", "AGENTS.md"];
    vi.mocked(listDriveChildren).mockResolvedValue({ files: codeNames.map((name, i) => textFile(`code-${i}`, "1", name)) });
    const ids = await setup();
    await finish(ids);
    expect(vi.mocked(downloadDriveFile)).not.toHaveBeenCalled();
    for (let i = 0; i < codeNames.length; i++) expect(await document(ids, `code-${i}`)).toMatchObject({ status: "IGNORED", excluded: true });
  });
  it("resumes paginated nested folders while ignoring code and excluding backups/shortcuts", async () => {
    vi.mocked(listDriveChildren).mockImplementation(async (_token, id, page) => {
      if (id === "root" && !page) return { files: [folder("nested"), folder("system", "node_modules"), textFile("backup", "1", "report backup.txt"), { id: "shortcut", name: "External folder", mimeType: DRIVE_SHORTCUT_MIME, shortcutDetails: { targetId: "external", targetMimeType: DRIVE_FOLDER_MIME } }], nextPageToken: "page2" };
      if (id === "root" && page === "page2") return { files: [textFile("company")] };
      if (id === "nested") return { files: [textFile("notes")] };
      throw new Error(`Unexpected traversal ${id}`);
    });
    const ids = await setup();
    await processStep(db, ids.firmId, ids.intakeId);
    const paused = await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } });
    expect(paused.leaseToken).toBeNull();
    expect(paused.cursor).toMatchObject({ queue: [{ id: "root", pageToken: "page2" }, { id: "nested" }], complete: false });
    await finish(ids);
    expect(vi.mocked(listDriveChildren).mock.calls.map(c => [c[1], c[2]])).toEqual([["root", undefined], ["root", "page2"], ["nested", undefined]]);
    expect(await document(ids, "system")).toMatchObject({ status: "IGNORED", excluded: true });
    expect(await document(ids, "backup")).toMatchObject({ excluded: true });
    expect(await document(ids, "shortcut")).toMatchObject({ status: "SHORTCUT", excluded: true });
    expect(await document(ids, "notes")).toMatchObject({ path: "Citra Ternak synthetic/nested/notes.txt", status: "READY" });
    expect(downloadDriveFile).toHaveBeenCalledTimes(2);
    expect(await db.journalEntry.count()).toBe(0);
    expect(await db.journalLine.count()).toBe(0);
  });

  it("unchanged refresh does not download or re-extract prior content", async () => {
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("company")] });
    const ids = await setup(); await finish(ids);
    const original = await document(ids, "company");
    vi.mocked(downloadDriveFile).mockClear(); vi.mocked(extractEvidence).mockClear();
    await attachDrive(db, ids.firmId, ids.intakeId, URL); await finish(ids);
    expect(downloadDriveFile).not.toHaveBeenCalled();
    expect(extractEvidence).not.toHaveBeenCalled();
    expect((await document(ids, "company")).currentVersionId).toBe(original.currentVersionId);
    expect(await db.evidenceVersion.count()).toBe(1);
  });

  it("retains historical revisions and makes reverted bytes the active cached version", async () => {
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("company", "1")] });
    vi.mocked(downloadDriveFile).mockResolvedValue({ name: "company.txt", data: profile("Citra Ternak A") });
    const ids = await setup(); await finish(ids);
    const first = await document(ids, "company");
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("company", "2")] });
    vi.mocked(downloadDriveFile).mockResolvedValue({ name: "company.txt", data: profile("Citra Ternak B") });
    await attachDrive(db, ids.firmId, ids.intakeId, URL); await finish(ids);
    const second = await document(ids, "company");
    expect(second.currentVersionId).not.toBe(first.currentVersionId);
    expect(second.versions).toHaveLength(2);
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("company", "3")] });
    vi.mocked(downloadDriveFile).mockResolvedValue({ name: "company.txt", data: profile("Citra Ternak A") });
    vi.mocked(extractEvidence).mockClear();
    await attachDrive(db, ids.firmId, ids.intakeId, URL); await finish(ids);
    const reverted = await document(ids, "company");
    expect(reverted.currentVersionId).toBe(first.currentVersionId);
    expect(reverted.versions).toHaveLength(2);
    expect(extractEvidence).not.toHaveBeenCalled();
    expect(await db.journalEntry.count()).toBe(0);
  });

  it("keeps a partial inventory visible after permission loss and does not mark unseen files missing", async () => {
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("company")] });
    const ids = await setup(); await finish(ids);
    await attachDrive(db, ids.firmId, ids.intakeId, URL);
    vi.mocked(listDriveChildren).mockRejectedValue(new DriveError("Akses file ditolak.", "FORBIDDEN", 403));
    const result = await processStep(db, ids.firmId, ids.intakeId);
    expect(result).toMatchObject({ more: false, error: "Akses file ditolak." });
    expect(await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).toMatchObject({ status: "PARTIAL", issue: "Akses file ditolak.", leaseToken: null });
    expect((await document(ids, "company")).status).toBe("READY");
  });

  it("marks inaccessible downloads as errors without losing prior versions", async () => {
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("company")] });
    const ids = await setup(); await finish(ids);
    const first = await document(ids, "company");
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("company", "2")] });
    vi.mocked(downloadDriveFile).mockRejectedValue(new DriveError("File tidak ditemukan.", "NOT_FOUND", 404));
    await attachDrive(db, ids.firmId, ids.intakeId, URL);
    await processStep(db, ids.firmId, ids.intakeId);
    expect(await processStep(db, ids.firmId, ids.intakeId)).toMatchObject({ more: true, error: "File tidak ditemukan." });
    expect(await document(ids, "company")).toMatchObject({ status: "ERROR", currentVersionId: first.currentVersionId, issue: "File tidak ditemukan." });
    expect(await db.evidenceVersion.count()).toBe(1);
  });

  it("requires explicit inclusion before reading an external shortcut target", async () => {
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [{ id: "shortcut", name: "External note", mimeType: DRIVE_SHORTCUT_MIME, shortcutDetails: { targetId: "external", targetMimeType: "text/plain", targetResourceKey: "external-key" } }] });
    const ids = await setup(); await finish(ids);
    expect(downloadDriveFile).not.toHaveBeenCalled();
    expect(getDriveFile).toHaveBeenCalledTimes(1);
    const shortcut = await document(ids, "shortcut");
    vi.mocked(getDriveFile).mockResolvedValue(textFile("external"));
    await includeDocument(db, ids.firmId, ids.intakeId, shortcut.id); await finish(ids);
    expect(getDriveFile).toHaveBeenLastCalledWith("access", "external", "external-key");
    expect(downloadDriveFile).toHaveBeenLastCalledWith("access", expect.objectContaining({ id: "external" }));
    expect((await document(ids, "shortcut")).status).toBe("READY");
  });

  it("does not finish inventories exceeding the 500-file bound", async () => {
    const ids = await setup();
    await db.evidenceDocument.createMany({ data: Array.from({ length: 500 }, (_, i) => ({ firmId: ids.firmId, intakeId: ids.intakeId, sourceKey: `old_${i}`, name: `old_${i}`, path: `old_${i}`, mimeType: "text/plain", excluded: true })) });
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("one_too_many")] });
    await processStep(db, ids.firmId, ids.intakeId);
    const intake = await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } });
    expect(intake.status).toBe("PARTIAL");
    expect(intake.issue).toContain("500");
    expect(intake.cursor).toMatchObject({ complete: false });
    expect(await db.evidenceDocument.count()).toBe(500);
    expect(await db.journalEntry.count()).toBe(0);
  });

  it("counts in-flight upload reservations before admitting Drive files", async () => {
    const ids = await setup();
    await db.evidenceDocument.createMany({ data: Array.from({ length: 499 }, (_, i) => ({ firmId: ids.firmId, intakeId: ids.intakeId, sourceKey: `old_${i}`, name: `old_${i}`, path: `old_${i}`, mimeType: "text/plain", excluded: true })) });
    const upload = await beginUpload(db, ids.firmId, ids.intakeId, "manual.txt", 5);
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("would_be_501")] });
    await processStep(db, ids.firmId, ids.intakeId);
    expect(await db.evidenceDocument.count()).toBe(499);
    expect(await db.evidenceUpload.count()).toBe(1);
    expect(await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).toMatchObject({ status: "PARTIAL" });
    await appendUpload(db, ids.firmId, upload.id, 0, Buffer.from("hello"));
    await finishUpload(db, ids.firmId, upload.id);
    expect(await db.evidenceDocument.count()).toBe(500);
    expect(await db.evidenceUpload.count()).toBe(0);
    expect(await db.evidenceDocument.findFirst({ where: { intakeId: ids.intakeId, sourceKey: "would_be_501" } })).toBeNull();
    expect(await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).toMatchObject({ status: "PARTIAL", issue: expect.stringContaining("500") });
    await finish(ids);
    expect(await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).toMatchObject({ status: "PARTIAL", issue: expect.stringContaining("500") });
  });

  it("does not claim completion when an incomplete Drive cursor has no remaining queue", async () => {
    const ids = await setup();
    await db.evidenceIntake.update({ where: { id: ids.intakeId }, data: { status: "READY", issue: null, cursor: { run: "truncated", visited: ["root"], queue: [], complete: false } } });
    expect(await processStep(db, ids.firmId, ids.intakeId)).toEqual({ more: false });
    expect(await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).toMatchObject({ status: "PARTIAL", issue: expect.stringContaining("belum lengkap") });
  });

  it("remembers shortcut consent, refreshes its target, and requires approval when target changes", async () => {
    const shortcut = { id: "shortcut", name: "External note", mimeType: DRIVE_SHORTCUT_MIME, shortcutDetails: { targetId: "external", targetMimeType: "text/plain" } };
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [shortcut] });
    const ids = await setup(); await finish(ids);
    vi.mocked(getDriveFile).mockImplementation(async (_token, id) => id === "root" ? folder("root") : textFile(id));
    await includeDocument(db, ids.firmId, ids.intakeId, (await document(ids, "shortcut")).id); await finish(ids);
    expect(await document(ids, "shortcut")).toMatchObject({ approvedShortcutTarget: "external", excluded: false });
    vi.mocked(downloadDriveFile).mockClear(); vi.mocked(extractEvidence).mockClear();
    await attachDrive(db, ids.firmId, ids.intakeId, URL); await finish(ids);
    expect(await document(ids, "shortcut")).toMatchObject({ approvedShortcutTarget: "external", excluded: false, status: "READY" });
    expect(downloadDriveFile).not.toHaveBeenCalled();
    expect(extractEvidence).not.toHaveBeenCalled();

    vi.mocked(getDriveFile).mockImplementation(async (_token, id) => id === "root" ? folder("root") : textFile(id, "2"));
    vi.mocked(downloadDriveFile).mockResolvedValue({ name: "external.txt", data: profile("New target revision") });
    await attachDrive(db, ids.firmId, ids.intakeId, URL); await finish(ids);
    expect((await document(ids, "shortcut")).versions).toHaveLength(2);
    expect(downloadDriveFile).toHaveBeenCalledTimes(1);

    vi.mocked(listDriveChildren).mockResolvedValue({ files: [{ ...shortcut, shortcutDetails: { targetId: "other", targetMimeType: "text/plain" } }] });
    vi.mocked(getDriveFile).mockClear(); vi.mocked(downloadDriveFile).mockClear();
    await attachDrive(db, ids.firmId, ids.intakeId, URL); await finish(ids);
    expect(await document(ids, "shortcut")).toMatchObject({ approvedShortcutTarget: null, excluded: true, status: "SHORTCUT" });
    expect(getDriveFile).toHaveBeenCalledTimes(1); // Only the root; no unapproved target read.
    expect(downloadDriveFile).not.toHaveBeenCalled();
  });

  it.each([false, true])("an expired download worker cannot overwrite a replacement worker (throws=%s)", async (fails) => {
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("company")] });
    const ids = await setup();
    await processStep(db, ids.firmId, ids.intakeId);
    const doc = await document(ids, "company");
    vi.mocked(downloadDriveFile).mockImplementation(async () => {
      await db.evidenceIntake.update({ where: { id: ids.intakeId }, data: { leaseToken: "new-worker", leaseUntil: new Date(Date.now() + 90_000) } });
      await db.evidenceDocument.update({ where: { id: doc.id }, data: { status: "READY", issue: "new-worker-result" } });
      if (fails) throw new Error("expired download failed");
      return { name: "company.txt", data: profile("Old worker") };
    });
    await processStep(db, ids.firmId, ids.intakeId);
    expect(await document(ids, "company")).toMatchObject({ status: "READY", issue: "new-worker-result" });
    expect((await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).leaseToken).toBe("new-worker");
    expect(await db.evidenceVersion.count()).toBe(0);
  });

  it("expired inventory errors cannot overwrite the replacement intake status", async () => {
    const ids = await setup();
    vi.mocked(listDriveChildren).mockImplementation(async () => {
      await db.evidenceIntake.update({ where: { id: ids.intakeId }, data: { leaseToken: "new-worker", leaseUntil: new Date(Date.now() + 90_000), status: "DONE", issue: "new-result" } });
      throw new Error("old inventory failed");
    });
    await processStep(db, ids.firmId, ids.intakeId);
    expect(await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).toMatchObject({ status: "DONE", issue: "new-result", leaseToken: "new-worker" });
  });

  it("does not conflict facts from different companies sharing the same unit key", async () => {
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("a"), textFile("b")] });
    vi.mocked(downloadDriveFile).mockImplementation(async (_token, file) => ({ name: file.name, data: profile(file.id === "a" ? "PT Alpha" : "PT Beta") }));
    const ids = await setup(); await finish(ids);
    const a = await document(ids, "a"), b = await document(ids, "b");
    const base = { key: "Sheet1", label: "Sheet1", kind: "CONTEXT", role: "CONTEXT", entity: "PT Alpha", periodStart: null, periodEnd: null, currency: null, scale: "1", passages: [], facts: [], figures: [], issues: [] };
    await db.evidenceVersion.update({ where: { id: a.currentVersionId! }, data: { units: [{ ...base }] } });
    await db.evidenceVersion.update({ where: { id: b.currentVersionId! }, data: { units: [{ ...base, entity: "PT Beta" }] } });
    await db.evidenceFact.createMany({ data: [
      { firmId: ids.firmId, intakeId: ids.intakeId, versionId: a.currentVersionId!, unitKey: "Sheet1", key: "industry", value: "Poultry", locator: "A1" },
      { firmId: ids.firmId, intakeId: ids.intakeId, versionId: b.currentVersionId!, unitKey: "Sheet1", key: "industry", value: "Software", locator: "A1" },
    ] });
    await rebuildConflicts(db, ids.firmId, ids.intakeId);
    expect(await db.evidenceFact.count({ where: { key: "industry", status: "CONFLICTING" } })).toBe(0);
    await db.evidenceVersion.update({ where: { id: b.currentVersionId! }, data: { units: [{ ...base }] } });
    await rebuildConflicts(db, ids.firmId, ids.intakeId);
    expect(await db.evidenceFact.count({ where: { key: "industry", status: "CONFLICTING" } })).toBe(2);
  });

  it("archives obsolete conflicts after exclusion and reopens them if sources return", async () => {
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("a"), textFile("b")] });
    vi.mocked(downloadDriveFile).mockResolvedValue({ name: "profile.txt", data: profile("Same company") });
    const ids = await setup(); await finish(ids);
    expect(await db.evidenceConflict.count({ where: { resolved: false } })).toBe(1);
    const b = await document(ids, "b");
    await db.evidenceDocument.update({ where: { id: b.id }, data: { excluded: true } });
    await rebuildConflicts(db, ids.firmId, ids.intakeId);
    expect(await db.evidenceConflict.findFirstOrThrow()).toMatchObject({ resolved: true, note: "Otomatis: konflik tidak lagi melibatkan versi sumber aktif." });
    await db.evidenceDocument.update({ where: { id: b.id }, data: { excluded: false } });
    await rebuildConflicts(db, ids.firmId, ids.intakeId);
    expect(await db.evidenceConflict.findFirstOrThrow()).toMatchObject({ resolved: false, note: null });
  });

  it("bounds duplicate conflict rebuilding and keeps a completed folder scan PARTIAL", async () => {
    const ids = await setup();
    const unit = { key: "document", label: "Profile", kind: "CONTEXT", role: "CONTEXT", entity: "PT Alpha", periodStart: null, periodEnd: null, currency: null, scale: "1", passages: [], facts: [], figures: [], issues: [] };
    await db.evidenceDocument.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ id: `bounded-doc-${i}`, firmId: ids.firmId, intakeId: ids.intakeId, sourceKey: `bounded_${i}`, name: `copy-${i}.txt`, path: `copy-${i}.txt`, mimeType: "text/plain", status: "READY", currentVersionId: `bounded-version-${i}` })) });
    await db.evidenceVersion.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ id: `bounded-version-${i}`, firmId: ids.firmId, documentId: `bounded-doc-${i}`, hash: "same-content", name: `copy-${i}.txt`, size: 1, data: Buffer.from("a"), extracted: true, units: [unit] })) });
    await db.evidenceIntake.update({ where: { id: ids.intakeId }, data: { cursor: { run: "complete", visited: ["root"], queue: [], complete: true } } });
    expect(await processStep(db, ids.firmId, ids.intakeId)).toEqual({ more: false });
    expect(await db.evidenceConflict.count()).toBe(500);
    expect(await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).toMatchObject({ status: "PARTIAL", issue: expect.stringContaining("500 konflik") });
    await processStep(db, ids.firmId, ids.intakeId);
    expect(await db.evidenceConflict.count()).toBe(500);
    expect((await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).status).toBe("PARTIAL");
    await db.evidenceDocument.updateMany({ where: { intakeId: ids.intakeId, id: { notIn: ["bounded-doc-0", "bounded-doc-1"] } }, data: { excluded: true } });
    await processStep(db, ids.firmId, ids.intakeId);
    expect((await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).status).toBe("DONE");
    expect(await db.evidenceConflict.count({ where: { resolved: false } })).toBe(1);
  });
  it("keeps truncated extraction and oversized downloads visibly incomplete", async () => {
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("long")] });
    vi.mocked(downloadDriveFile).mockResolvedValue({ name: "long.txt", data: Buffer.from(Array.from({ length: 2100 }, (_, i) => `Line ${i}`).join("\n")) });
    const ids = await setup(); await finish(ids);
    expect(await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).toMatchObject({ status: "PARTIAL", issue: expect.stringContaining("dibatasi") });
    vi.mocked(listDriveChildren).mockResolvedValue({ files: [textFile("oversize")] });
    vi.mocked(downloadDriveFile).mockRejectedValue(new DriveError("File melebihi batas 10 MiB.", "TOO_LARGE"));
    await attachDrive(db, ids.firmId, ids.intakeId, URL);
    await processStep(db, ids.firmId, ids.intakeId);
    await processStep(db, ids.firmId, ids.intakeId);
    await processStep(db, ids.firmId, ids.intakeId);
    expect(await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).toMatchObject({ status: "PARTIAL", issue: expect.stringContaining("10 MiB") });
  });

  it("persists rejected upload limits without bytes or foreign-firm mutation", async () => {
    const ids = await setup();
    await expect(beginUpload(db, "foreign", ids.intakeId, "huge.txt", 11 * 1024 * 1024)).rejects.toThrow("tidak ditemukan");
    expect((await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).status).toBe("READY");
    await expect(beginUpload(db, ids.firmId, ids.intakeId, "huge.txt", 11 * 1024 * 1024)).rejects.toThrow("10 MiB");
    expect(await db.evidenceIntake.findUniqueOrThrow({ where: { id: ids.intakeId } })).toMatchObject({ status: "PARTIAL", issue: expect.stringContaining("huge.txt") });
    expect(await db.evidenceUpload.count()).toBe(0);
    expect(await db.evidenceVersion.count()).toBe(0);
  });

});
