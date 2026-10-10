import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { appendLinkUpload, beginLinkUpload, contentMatches, createUploadLink, finishLinkUpload, LINK_FILE_LIMIT, resolveUploadLink, revokeUploadLink, tokenHash, uploadLinks } from "@/lib/upload-links";
import { beginUpload, createIntake } from "@/lib/evidence/store";
import { deleteClient } from "@/lib/clients/delete";

// Tautan unggah klien (I1d): secret, expiring, revocable, upload-only; files land in the link's own inbox.
type G = Awaited<ReturnType<typeof makeGroup>>;
let g: G;
beforeEach(async () => {
  await resetDb();
  g = await makeGroup();
});

const CSV = Buffer.from("Tanggal;Keterangan;Debet;Kredit;Saldo\n01/08/2026;SALDO AWAL;;;1.000,00\n");
async function send(token: string, name: string, data: Buffer) {
  const id = await beginLinkUpload(db, token, name, data.length);
  await appendLinkUpload(db, token, id, 0, data);
  return finishLinkUpload(db, token, id);
}

describe("upload links", () => {
  it("stores only the token's hash, lands files in the link's inbox and audits the link", async () => {
    const { link, token } = await createUploadLink(db, { firmId: g.firm.id, clientId: g.client.id, days: 14 });
    expect(link.tokenHash).toBe(tokenHash(token));
    expect(JSON.stringify(await db.uploadLink.findMany())).not.toContain(token);
    const resolved = await resolveUploadLink(db, token);
    expect(resolved).toMatchObject({ clientName: "Grup Uji", firmName: "KJA Uji" });
    expect(await send(token, "bca-agustus.csv", CSV)).toEqual({ name: "bca-agustus.csv" });
    // The same file twice is one document.
    await send(token, "bca-agustus.csv", CSV);
    const docs = await db.evidenceDocument.findMany({ where: { intakeId: link.intakeId } });
    expect(docs.map((d) => d.name)).toEqual(["bca-agustus.csv"]);
    const intake = await db.evidenceIntake.findUniqueOrThrow({ where: { id: link.intakeId } });
    expect(intake).toMatchObject({ clientId: g.client.id, firmId: g.firm.id });
    expect(intake.name).toMatch(/^Kiriman klien · /);
    expect((await uploadLinks(db, g.client.id))[0]).toMatchObject({ files: 1, active: true });
    expect(await db.auditEvent.count({ where: { kind: "UPLOAD_LINK" } })).toBe(1);
  });

  it("refuses an unknown, expired or revoked token alike", async () => {
    // The checks below run on a simulated September 2026 clock; the firm's open grant must already cover it (ADR 0017).
    await db.accessGrant.updateMany({ where: { firmId: g.firm.id }, data: { startsAt: new Date("2026-01-01T00:00:00Z") } });
    const { token } = await createUploadLink(db, { firmId: g.firm.id, clientId: g.client.id, days: 7, now: new Date("2026-09-01T00:00:00Z") });
    expect(await resolveUploadLink(db, token, new Date("2026-09-07T23:00:00Z"))).not.toBeNull();
    expect(await resolveUploadLink(db, token, new Date("2026-09-08T00:00:01Z"))).toBeNull();
    expect(await resolveUploadLink(db, "x".repeat(43))).toBeNull();
    expect(await resolveUploadLink(db, "../../etc")).toBeNull();
    const fresh = await createUploadLink(db, { firmId: g.firm.id, clientId: g.client.id, days: 30 });
    await revokeUploadLink(db, { firmId: g.firm.id, clientId: g.client.id, linkId: fresh.link.id });
    expect(await resolveUploadLink(db, fresh.token)).toBeNull();
    await expect(beginLinkUpload(db, fresh.token, "a.csv", 10)).rejects.toThrow(/tidak berlaku lagi/);
    // Another firm cannot revoke it, and a link cannot be made for another firm's client.
    await expect(revokeUploadLink(db, { firmId: "other", clientId: g.client.id, linkId: fresh.link.id })).rejects.toThrow(/tidak ditemukan/);
    await expect(createUploadLink(db, { firmId: "other", clientId: g.client.id, days: 14 })).rejects.toThrow(/Klien tidak ditemukan/);
    await expect(createUploadLink(db, { firmId: g.firm.id, clientId: g.client.id, days: 3 })).rejects.toThrow(/7, 14 atau 30/);
  });

  it("refuses an upload into another inbox, wrong types, content that does not match, and more than the file cap", async () => {
    const { link, token } = await createUploadLink(db, { firmId: g.firm.id, clientId: g.client.id, days: 14 });
    const other = await createIntake(db, g.firm.id, g.client.id);
    const foreign = await beginUpload(db, g.firm.id, other.id, "x.csv", 3);
    await expect(appendLinkUpload(db, token, foreign.id, 0, Buffer.from("a;b"))).rejects.toThrow(/Unggahan tidak ditemukan/);
    await expect(finishLinkUpload(db, token, foreign.id)).rejects.toThrow(/Unggahan tidak ditemukan/);
    await expect(beginLinkUpload(db, token, "foto.jpg", 10)).rejects.toThrow(/PDF, CSV, XLS atau XLSX/);
    await expect(beginLinkUpload(db, token, "besar.pdf", 11 * 1024 * 1024)).rejects.toThrow(/maksimal 10 MiB/);
    await expect(send(token, "palsu.pdf", Buffer.from("bukan pdf"))).rejects.toThrow(/tidak sesuai jenis filenya/);
    expect(await db.evidenceUpload.count({ where: { intakeId: link.intakeId } })).toBe(0);
    for (let i = 0; i < LINK_FILE_LIMIT; i++) await db.evidenceDocument.create({ data: { firmId: g.firm.id, intakeId: link.intakeId, sourceKey: `k${i}`, name: `f${i}.csv`, path: `f${i}.csv`, mimeType: "" } });
    await expect(beginLinkUpload(db, token, "a.csv", 10)).rejects.toThrow(/sudah menerima 50 file/);
  });

  it("goes with its client when the client is deleted", async () => {
    const { token } = await createUploadLink(db, { firmId: g.firm.id, clientId: g.client.id, days: 14 });
    await send(token, "a.csv", CSV);
    await deleteClient(db, { firmId: g.firm.id, clientId: g.client.id, confirmName: "Grup Uji" });
    expect(await db.uploadLink.count()).toBe(0);
    expect(await resolveUploadLink(db, token)).toBeNull();
  });

  it("checks a file's first bytes against its extension", () => {
    expect(contentMatches("a.pdf", Buffer.from("%PDF-1.7"))).toBe(true);
    expect(contentMatches("a.PDF", Buffer.from("PK\x03\x04"))).toBe(false);
    expect(contentMatches("a.xlsx", Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(contentMatches("a.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1]))).toBe(true);
    expect(contentMatches("a.csv", Buffer.from("a;b\n1;2"))).toBe(true);
    expect(contentMatches("a.csv", Buffer.from([0x4d, 0x5a, 0x00, 0x01]))).toBe(false);
    expect(contentMatches("a.exe", Buffer.from("MZ"))).toBe(false);
  });
});
