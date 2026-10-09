import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { createMappedDraft, importOcrDraft } from "@/lib/ocr/draft";
import { importStatement } from "@/lib/import/pipeline";
import { readGrid } from "@/lib/import/grid";
import { suggestMapping } from "@/lib/import/mapped";
import { forgetLayout } from "@/lib/import/layouts";
import { UnreadableFileError } from "@/lib/import/types";
import { createClient, createFirm } from "@/lib/setup";
import { unknownCsv, unknownXlsx } from "../unknown-layout";

type Group = Awaited<ReturnType<typeof makeGroup>>;

/** August's unknown-layout CSV mapped and imported into the PT's BCA account: the firm now remembers the layout. */
async function mapAugust(g: Group) {
  const data = unknownCsv(8);
  const draft = await createMappedDraft(db, { firmId: g.firm.id, clientId: g.client.id, bankAccountId: g.pt.banks[0].id, fileName: "kas-agustus.csv", data, mapping: { ...suggestMapping(await readGrid(data)), description: [2] } });
  await importOcrDraft(db, { firmId: g.firm.id, clientId: g.client.id, draftId: draft.id, provider: null });
  return db.statementLayout.findFirstOrThrow();
}

describe("a remembered Atur kolom layout", () => {
  beforeEach(resetDb);

  it("reads next month's file of that layout straight away, through the normal import, and says so", async () => {
    const g = await makeGroup();
    const layout = await mapAugust(g);
    expect(layout.lastUsedAt).not.toBeNull();
    const before = layout.lastUsedAt!;

    const summary = await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "kas-september.csv", data: unknownCsv(9), provider: null });
    expect(summary.rows).toBe(5);
    expect(summary.continuityOk).toBe(true);
    expect(summary.layout).toEqual({ id: layout.id, label: "kas-agustus.csv" });
    expect(summary.notes[0]).toBe('Dibaca dengan pemetaan kolom tersimpan (dari "kas-agustus.csv").');
    expect(summary.months).toEqual(["September 2026"]);
    const tx = await db.bankTransaction.findFirstOrThrow({ where: { bankAccountId: g.pt.banks[0].id, date: new Date("2026-09-01T00:00:00Z") } });
    expect(tx.description).toBe("TRSF E-BANKING CR 0108/FTSCY/WS95031 PT MITRA UNGGAS FIKTIF");
    expect(+(await db.statementLayout.findUniqueOrThrow({ where: { id: layout.id } })).lastUsedAt!).toBeGreaterThanOrEqual(+before);
  });

  it("serves every client of the firm, and no other firm", async () => {
    const g = await makeGroup();
    await mapAugust(g);
    const other = await db.$transaction((tx) => createClient(tx, g.firm.id, { name: "Klien Lain", industry: "retail", entities: [{ name: "PT Lain", shortName: "PT Lain", kind: "PT", banks: [{ bank: "BNI", number: "4444444444", label: "BNI Giro" }] }] }));
    const same = await importStatement(db, { bankAccountId: other.entities[0].banks[0].id, fileName: "kas.csv", data: unknownCsv(8), provider: null });
    expect(same.layout?.label).toBe("kas-agustus.csv");

    const firm2 = await createFirm(db, "KJA Lain");
    const foreign = await db.$transaction((tx) => createClient(tx, firm2.id, { name: "Klien KJA Lain", industry: "retail", entities: [{ name: "PT Asing", shortName: "PT Asing", kind: "PT", banks: [{ bank: "BCA", number: "5555555555", label: "BCA" }] }] }));
    await expect(importStatement(db, { bankAccountId: foreign.entities[0].banks[0].id, fileName: "kas.csv", data: unknownCsv(8), provider: null })).rejects.toThrow(UnreadableFileError);
  });

  it("is never used for a file a reader knows", async () => {
    const g = await makeGroup();
    await mapAugust(g);
    const known = Buffer.from(["Tanggal;Keterangan;Debet;Kredit;Saldo", "01/09/2026;SALDO AWAL;;;10.000.000", "02/09/2026;SETOR TUNAI;;1.000.000;11.000.000", ""].join("\n"));
    const summary = await importStatement(db, { bankAccountId: g.pt.banks[1].id, fileName: "mutasi.csv", data: known, provider: null });
    expect(summary.layout).toBeNull();
  });

  it("refuses, naming the layout, a file whose header matches but whose rows it can't read", async () => {
    const g = await makeGroup();
    await mapAugust(g);
    const broken = Buffer.from(["Value Dt;Ref;Particulars;Withdrawn;Lodged;Position", "01/09/2026;R1;SETOR;TUNAI;;100", ""].join("\n"));
    const err = await importStatement(db, { bankAccountId: g.pt.banks[1].id, fileName: "x.csv", data: broken, provider: null }).catch((e) => e);
    // Still a file the accountant can map again: the import page offers Atur kolom.
    expect(err).toBeInstanceOf(UnreadableFileError);
    expect(err.message).toBe('File ini cocok dengan pemetaan kolom tersimpan ("kas-agustus.csv"), tetapi tidak terbaca: Baris 2: kolom Debet berisi "TUNAI", bukan angka. Periksa pemetaan kolomnya.');
  });

  it("is forgotten on request: the next file is refused again, the import read with it stays", async () => {
    const g = await makeGroup();
    const layout = await mapAugust(g);
    const firm2 = await createFirm(db, "KJA Lain");
    expect(await forgetLayout(db, firm2.id, layout.id)).toBe(false);
    expect(await forgetLayout(db, g.firm.id, layout.id)).toBe(true);
    expect(await db.statementLayout.count()).toBe(0);
    expect(await db.statementImport.count()).toBe(1);
    await expect(importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "kas-september.csv", data: unknownCsv(9), provider: null })).rejects.toThrow(UnreadableFileError);
  });

  it("refuses an unknown layout with the reader's own message, as a file the import page can offer to map", async () => {
    const g = await makeGroup();
    const err = await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "kas.xlsx", data: await unknownXlsx(), provider: null }).catch((e) => e);
    expect(err).toBeInstanceOf(UnreadableFileError);
    expect(err.message).toBe("Kolom tanggal & keterangan tidak ditemukan. Pastikan baris judul kolom ada.");
  });
});
