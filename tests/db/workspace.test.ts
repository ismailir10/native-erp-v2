import { beforeEach, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { askWorkspace, getWorkspaceOverview, resolveWorkspaceScope } from "@/lib/workspace";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";
import { createIntake } from "@/lib/evidence/store";

beforeEach(resetDb);

async function sale(g: Awaited<ReturnType<typeof makeGroup>>, entityId: string, amount: bigint) {
  const bank = (await db.bankAccount.findFirstOrThrow({ where: { entityId } })).accountId;
  const revenue = await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code: "4100" } } });
  return db.$transaction(tx => postJournal(tx, { entityId, date: dateOnly(2026, 8, 12), kind: "ADJUSTMENT", memo: "Synthetic sale", lines: [{ accountId: bank, debit: amount }, { accountId: revenue.id, credit: amount }] }));
}

it("rejects foreign client/entity ids and resolves only the session firm's picker", async () => {
  const g = await makeGroup(), foreign = await makeGroup();
  for (const scope of [`client:${foreign.client.id}`, `entity:${foreign.pt.entity.id}`, "bad", "entity:"]) {
    await expect(resolveWorkspaceScope(db, g.firm.id, { scope, period: "2026-08" })).rejects.toThrow(/Cakupan/);
  }
  const scope = await resolveWorkspaceScope(db, g.firm.id, { scope: `entity:${g.pt.entity.id}`, period: "2026-08" });
  expect(scope.entityIds).toEqual([g.pt.entity.id]);
  expect(scope.clientIds).toEqual([g.client.id]);
  expect(scope.clients.map(c => c.id)).toEqual([g.client.id]);
});

it("derives exact per-company figures without mixing currencies or inventing data", async () => {
  const g = await makeGroup();
  await db.entity.update({ where: { id: g.owner.entity.id }, data: { functionalCurrency: "USD" } });
  await sale(g, g.pt.entity.id, 9_007_199_254_740_993n);
  await sale(g, g.owner.entity.id, 2500n);
  const data = await getWorkspaceOverview(db, g.firm.id, { period: "2026-08" });
  expect(data.entities.find(e => e.id === g.pt.entity.id)).toMatchObject({ revenue: "9007199254740993", profit: "9007199254740993", cash: "9007199254740993", currency: "IDR", hasActivity: true });
  expect(data.entities.find(e => e.id === g.owner.entity.id)).toMatchObject({ revenue: "2500", currency: "USD" });
  const empty = await getWorkspaceOverview(db, g.firm.id, { scope: `entity:${g.pt.entity.id}`, period: "2026-09" });
  expect(empty.entities[0]).toMatchObject({ revenue: null, profit: null, hasActivity: false, hasBooks: true, cash: "9007199254740993" });
  expect(empty.clients[0].state).toBe("EMPTY");
  const before = await getWorkspaceOverview(db, g.firm.id, { scope: `entity:${g.pt.entity.id}`, period: "2026-07" });
  expect(before.entities[0]).toMatchObject({ cash: null, hasBooks: false });
});

it("snapshot answers retain original entity and period; citations point to matching books", async () => {
  const g = await makeGroup();
  await sale(g, g.pt.entity.id, 1500n);
  await sale(g, g.owner.entity.id, 100n);
  const input = { scope: `entity:${g.pt.entity.id}`, period: "2026-08", question: "Berapa laba bulan ini?" };
  const answer = await askWorkspace(db, g.firm.id, input);
  input.scope = `entity:${g.owner.entity.id}`;
  input.period = "2026-09";
  expect(answer.scope).toMatchObject({ key: `entity:${g.pt.entity.id}`, period: "2026-08" });
  expect(answer.rows).toHaveLength(1);
  expect(answer.rows[0].label).toContain(g.pt.entity.name);
  expect(answer.rows[0].value).toContain("1.500");
  const source = new URL(answer.citations[0].href, "https://buku.example");
  expect(source.searchParams.get("entity")).toBe(g.pt.entity.id);
  expect(source.searchParams.get("period")).toBe("2026-08");
  const account = await askWorkspace(db, g.firm.id, { scope: `entity:${g.pt.entity.id}`, period: "2026-08", question: "Berapa saldo akun 4100?" });
  expect(account.rows[0].value).toContain("1.500 Kredit");
  expect(account.citations[0].href).toContain("/ledger/4100?");
  const close = await askWorkspace(db, g.firm.id, { ...input, question: "Siap tutup buku?" });
  expect(close.text).toContain("seluruh grup/klien");
  expect(close.limitations.join(" ")).toContain("klien induk");
  const unsupported = await askWorkspace(db, g.firm.id, { ...input, question: "Buat undangan baru" });
  expect(unsupported.text).toContain("belum didukung");
  expect(unsupported.rows).toEqual([]);
});

it("returns only confirmed entity/period source passages with inspectable version citations", async () => {
  const g = await makeGroup(), foreign = await makeGroup();
  async function evidence(firmId: string, clientId: string, entityId: string, name: string) {
    const intake = await createIntake(db, firmId, clientId);
    const document = await db.evidenceDocument.create({ data: { firmId, intakeId: intake.id, sourceKey: name, name, path: name, mimeType: "text/plain", status: "READY" } });
    const version = await db.evidenceVersion.create({ data: { firmId, documentId: document.id, hash: name, name, size: 2, data: Buffer.from("ok"), extracted: true } });
    await db.evidenceDocument.update({ where: { id: document.id }, data: { currentVersionId: version.id } });
    await db.evidencePassage.create({ data: { firmId, versionId: version.id, unitKey: "page1", locator: "Halaman 1", text: `${name}: persediaan 123.000 menurut laporan sumber` } });
    await db.evidenceSelection.create({ data: { firmId, intakeId: intake.id, versionId: version.id, unitKey: "page1", role: "REFERENCE", entityId, confirmed: true, periodStart: "2026-08-01", periodEnd: "2026-08-31" } });
    return version;
  }
  const included = await evidence(g.firm.id, g.client.id, g.pt.entity.id, "Laporan PT");
  await evidence(g.firm.id, g.client.id, g.owner.entity.id, "Laporan pemilik");
  await evidence(foreign.firm.id, foreign.client.id, foreign.pt.entity.id, "Laporan asing");
  const input = { scope: `entity:${g.pt.entity.id}`, period: "2026-08", question: "Cari dokumen persediaan" };
  const answer = await askWorkspace(db, g.firm.id, input);
  expect(answer.rows).toHaveLength(1);
  expect(answer.rows[0].value).toContain("Laporan PT");
  expect(answer.text).toContain("belum merupakan saldo buku");
  expect(answer.citations[0].href).toContain(`/documents/source/${included.id}`);
  expect(answer.citations[0].href).toContain("at=Halaman+1");
  expect((await askWorkspace(db, g.firm.id, { ...input, period: "2026-09" })).rows).toEqual([]);
  expect(await db.journalEntry.count()).toBe(0);
  expect(await db.aiUsage.count()).toBe(0);
});

it("includes undated company context with an explicit non-historical label", async () => {
  const g = await makeGroup(), intake = await createIntake(db, g.firm.id, g.client.id);
  const document = await db.evidenceDocument.create({ data: { firmId: g.firm.id, intakeId: intake.id, sourceKey: "profile", name: "Profil", path: "Profil", mimeType: "text/plain", status: "READY" } });
  const version = await db.evidenceVersion.create({ data: { firmId: g.firm.id, documentId: document.id, hash: "profile", name: "Profil", size: 2, data: Buffer.from("ok") } });
  await db.evidenceDocument.update({ where: { id: document.id }, data: { currentVersionId: version.id } });
  await db.evidenceFact.create({ data: { firmId: g.firm.id, intakeId: intake.id, versionId: version.id, unitKey: "profile", locator: "Halaman 1", key: "industry", value: "Distribusi pangan", status: "CONFIRMED" } });
  await db.evidenceSelection.create({ data: { firmId: g.firm.id, intakeId: intake.id, versionId: version.id, unitKey: "profile", role: "CONTEXT", entityId: g.pt.entity.id, confirmed: true } });
  const answer = await askWorkspace(db, g.firm.id, { scope: `entity:${g.pt.entity.id}`, period: "2026-08", question: "Apa profil perusahaan ini?" });
  expect(answer.rows[0].value).toContain("Distribusi pangan");
  expect(answer.scope.period).toBe("2026-08");
  expect(answer.limitations.join(" ")).toContain("bukan posisi historis");
  expect(answer.citations[0].href).toContain(`answer=${answer.id}`);
  expect(answer.citations[0].href).toContain("#cited-source");
  const empty = await getWorkspaceOverview(db, g.firm.id, { period: "2026-08" });
  expect(empty.tasks.some(task => task.id === `statement:${g.client.id}` && task.href.includes("/import?"))).toBe(true);
});
