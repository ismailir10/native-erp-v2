import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../helpers";
import { confirmSelection, prepareImport } from "@/lib/evidence/review";
import { createIntake, hash, json } from "@/lib/evidence/store";
import { extractEvidence } from "@/lib/evidence/extract";
import { importSourceAccounts, postImport } from "@/lib/ledger-import/post";
import { acceptMappings, suggestMappings } from "@/lib/ledger-import/mapping";
import { createClient, createFirm } from "@/lib/setup";
import { GROUP_ENTITIES, groupWorkbook, POSTABLE } from "../evidence-workbook-fixture";

beforeEach(resetDb);

async function setup(entities: readonly { shortName: string; name: string; currency: string }[] = GROUP_ENTITIES) {
  const { firm, client, ids } = await db.$transaction(async (tx) => {
    const firm = await createFirm(tx, "KJA Uji");
    const { client, entities: made } = await createClient(tx, firm.id, { name: "Grup Unggas", industry: "peternakan", entities: entities.map((e) => ({ name: e.name, shortName: e.shortName, kind: "PT" as const, functionalCurrency: e.currency, banks: [] })) });
    return { firm, client, ids: Object.fromEntries(made.map((m) => [m.entity.shortName, m.entity.id])) };
  });
  return { firm, client, ids, intake: await addSource(firm.id, client.id) };
}
/** One intake holding the workbook, extracted exactly as the Drive job does. */
async function addSource(firmId: string, clientId: string) {
  const intake = await createIntake(db, firmId, clientId);
  const bytes = await groupWorkbook();
  const { units, issues } = await extractEvidence("group.xlsx", bytes);
  const doc = await db.evidenceDocument.create({ data: { firmId, intakeId: intake.id, sourceKey: crypto.randomUUID(), name: "group.xlsx", path: "Drive/group.xlsx", mimeType: "", status: "READY" } });
  const version = await db.evidenceVersion.create({ data: { firmId, documentId: doc.id, hash: hash(bytes), data: new Uint8Array(bytes), name: doc.name, size: bytes.length, extracted: true, units: json(units), issues: json(issues) } });
  await db.evidenceDocument.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  return { ...intake, versionId: version.id };
}
type G = Awaited<ReturnType<typeof setup>>;
const confirm = (g: G, unit: string, input: Record<string, string | undefined>, intake = g.intake) => confirmSelection(db, g.firm.id, intake.id, intake.versionId, unit, { role: "SOURCE", ...input });
const neraca = (g: G, date = "2025-12-31") => confirm(g, POSTABLE.neraca, { entityId: g.ids.HOLDCO, periodStart: date, periodEnd: date, currency: "SGD" });
const holdco = (g: G) => confirm(g, POSTABLE.holdco, { entityId: g.ids.HOLDCO, periodStart: "2026-01-01", periodEnd: "2026-01-31", currency: "SGD" });
const opco = (g: G, intake = g.intake) => confirm(g, POSTABLE.opco, { periodStart: "2026-01-01", periodEnd: "2026-01-31", currency: "IDR" }, intake);

async function stageAndPost(g: G, unit: string) {
  const { importId } = await prepareImport(db, g.firm.id, g.intake.id, g.intake.versionId, unit);
  await suggestMappings(db, { firmId: g.firm.id, clientId: g.client.id, provider: null, useAi: false });
  const src = await importSourceAccounts(db, importId!);
  await acceptMappings(db, g.client.id, src.map((s) => ({ sourceAccountId: s.id, accountCode: s.suggestedCode ?? "6190", method: s.suggestedCode ? s.suggestedBy! : ("MANUAL" as const) })));
  await postImport(db, g.client.id, importId!);
  return importId!;
}

describe("Drive evidence → ledger handoff for a group workbook", () => {
  it("posts the opening neraca, a single-entity GL and a 4-entity GL, each entry traceable to its sheet row", async () => {
    const g = await setup();
    await neraca(g);
    await holdco(g);
    await opco(g);
    const imports = [await stageAndPost(g, POSTABLE.neraca), await stageAndPost(g, POSTABLE.holdco), await stageAndPost(g, POSTABLE.opco)];

    const entries = await db.journalEntry.findMany({ include: { entity: true } });
    const opening = entries.filter((e) => e.kind === "OPENING");
    expect(opening).toHaveLength(1);
    expect(opening[0]).toMatchObject({ ledgerImportId: imports[0] });
    expect(opening[0].date.toISOString().slice(0, 10)).toBe("2025-12-31");
    expect(opening[0].entity.shortName).toBe("HOLDCO");
    const opcoEntries = entries.filter((e) => e.ledgerImportId === imports[2]);
    expect(new Set(opcoEntries.map((e) => e.entity.shortName))).toEqual(new Set(["OPA", "OPB", "OPC", "OPD"]));
    expect(entries.filter((e) => e.ledgerImportId === imports[1]).every((e) => e.entity.shortName === "HOLDCO")).toBe(true);
    for (const e of entries) expect(e.sourceRef).toMatch(/^(04_HC_FOUNDATION|10_HC_GL_MASTER|20_OPCO_GL_MASTER)!\d+/);
    const lines = await db.journalLine.findMany({ where: { entry: { ledgerImportId: imports[2] } } });
    expect(lines.reduce((s, l) => s + l.debit, 0n)).toBe(10_000_000n);
    expect(await db.ledgerImport.count({ where: { status: "POSTED", evidenceVersionId: g.intake.versionId } })).toBe(3);
  });

  it("takes the neraca date from the accountant, never from prose, and it is one date", async () => {
    const g = await setup();
    await expect(confirm(g, POSTABLE.neraca, { entityId: g.ids.HOLDCO, periodStart: "2025-12-31", periodEnd: "2026-01-01", currency: "SGD" })).rejects.toThrow("satu tanggal");
    await neraca(g, "2025-12-30");
    await stageAndPost(g, POSTABLE.neraca);
    expect((await db.journalEntry.findFirstOrThrow({ where: { kind: "OPENING" } })).date.toISOString().slice(0, 10)).toBe("2025-12-30");
  });

  it("asks for the entity column when a chosen entity is one of several, and lists labels the client lacks", async () => {
    const g = await setup();
    await expect(confirm(g, POSTABLE.opco, { entityId: g.ids.OPA, periodStart: "2026-01-01", periodEnd: "2026-01-31", currency: "IDR" })).rejects.toThrow("Sesuai kolom Entitas di file");
    await expect(confirm(g, POSTABLE.opco, { periodStart: "2026-01-01", periodEnd: "2026-01-31", currency: "SGD" })).rejects.toThrow("Mata uang sumber");

    const partial = await setup(GROUP_ENTITIES.filter((e) => e.shortName !== "OPC" && e.shortName !== "OPD"));
    await expect(opco(partial)).rejects.toThrow("Entitas OPC, OPD di file belum ada di klien");
  });

  it("checks overlap per entity named in the column, across intakes", async () => {
    const g = await setup();
    await opco(g);
    const second = await addSource(g.firm.id, g.client.id);
    await expect(opco(g, second)).rejects.toThrow("beririsan");
    // An explicit single-entity source for one of the column's entities overlaps too.
    await expect(confirm(g, POSTABLE.neraca, { entityId: g.ids.OPB, periodStart: "2026-01-10", periodEnd: "2026-01-10", currency: "IDR" }, second)).rejects.toThrow("beririsan");
    await confirm(g, POSTABLE.neraca, { entityId: g.ids.OPB, periodStart: "2025-12-31", periodEnd: "2025-12-31", currency: "IDR" }, second);
    // HoldCo is not in the column: its own GL is independent.
    await holdco(g);
  });

  it("never sends a postable table down the bank path", async () => {
    const g = await setup();
    await holdco(g);
    const staged = await prepareImport(db, g.firm.id, g.intake.id, g.intake.versionId, POSTABLE.holdco);
    expect(staged).toMatchObject({ kind: "LEDGER" });
    expect(await db.statementImport.count()).toBe(0);
    expect(await db.ledgerImport.count()).toBe(1);
  });
});
