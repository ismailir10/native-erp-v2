import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { financialNotes } from "@/lib/reports/notes";
import { financialStatementsWorkbook } from "@/lib/reports/workbook";
import { createLease } from "@/lib/receivables/../leases/register";
import { createInvoice } from "@/lib/receivables/invoices";
import { saveCkpnSetting } from "@/lib/receivables/ckpn";
import { dateOnly } from "@/lib/format";
import type { ReportingFramework } from "@/lib/generated/prisma/enums";

type G = Awaited<ReturnType<typeof makeGroup>>;
const J = 1_000_000n;

/** PT Uji with a lease, a CKPN setting, an open sales invoice, a benefits setting and a remeasurement (OCI) — every policy the notes can describe. */
async function fixture(g: G) {
  const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
  const post = (y: number, m: number, memo: string, lines: [string, bigint][]) =>
    db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(y, m, 1), kind: "ADJUSTMENT", memo, lines: await Promise.all(lines.map(async ([code, v]) => (v > 0n ? { accountId: await id(code), debit: v } : { accountId: await id(code), credit: -v }))) }));
  await post(2026, 1, "Setoran modal", [["1120", 500n * J], ["3100", -500n * J]]);
  await post(2026, 2, "Remeasurement", [["3920", 2n * J], ["2310", -2n * J]]);
  await db.benefitSetting.create({ data: { firmId: g.firm.id, entityId: g.pt.entity.id, discountBp: 700, salaryBp: 500 } });
  await createLease(db, { clientId: g.client.id, entityId: g.pt.entity.id, name: "Kantor", lessor: "PT Graha", start: "2026-06", months: 24, payment: "10.000.000", intervalMonths: 1, timing: "ARREARS", rate: "12" });
  await createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "SALES", contactName: "Toko Jaya", number: "INV-1", issueDate: "2026-05-05", dueDate: "2026-05-20", dpp: "10000000", counterCode: "4100" });
  await saveCkpnSetting(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 1, method: "MANUAL", historyMonths: 3, forward: "100", lastBucket: "100", manual: ["1", "1", "1", "1"] });
}
const setFramework = (g: G, reportingFramework: ReportingFramework, kind?: "PT" | "CV" | "PERORANGAN") =>
  db.entity.update({ where: { id: g.pt.entity.id }, data: { reportingFramework, ...(kind ? { kind } : {}) } });
const notesOf = async (g: G) => financialNotes(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, 2026, 8);
const text = (n: Awaited<ReturnType<typeof notesOf>>["notes"][number]) => n.paragraphs.join("\n");

describe("notes follow the entity's reporting framework", () => {
  beforeEach(resetDb);

  it("existing entities default to SAK EP and their text is the one the notes always had", async () => {
    const g = await makeGroup();
    expect((await db.entity.findUniqueOrThrow({ where: { id: g.pt.entity.id } })).reportingFramework).toBe("SAK_EP");
    expect((await db.entity.findUniqueOrThrow({ where: { id: g.owner.entity.id } })).reportingFramework).toBe("SAK_EP");
    await fixture(g);
    const n = await notesOf(g);
    const policy = text(n.notes[1]);
    expect(policy).toContain("(SAK EP) dengan dasar akrual dan konsep biaya historis, dalam Rupiah. Laporan arus kas disusun dengan metode tidak langsung.");
    expect(policy).toMatch(/matriks provisi dari umur piutang \(PSAK 109\)/);
    expect(policy).toMatch(/aset hak guna dan liabilitas sewa/);
    expect(policy).toMatch(/pajak tangguhan diakui atas beda temporer/);
    expect(n.notes.find((x) => x.title === "Penghasilan komprehensif lain")).toBeTruthy();
    expect(n.directors[0]).toBe("SURAT PERNYATAAN DIREKSI");
    expect(n.directors).toContain("2. Laporan keuangan telah disusun dan disajikan sesuai dengan Standar Akuntansi Keuangan Entitas Privat;");
  });

  it("SAK Umum names the general standard and keeps the full-PSAK policies", async () => {
    const g = await makeGroup();
    await fixture(g);
    await setFramework(g, "SAK_UMUM");
    const n = await notesOf(g);
    const policy = text(n.notes[1]);
    expect(policy).toContain("Standar Akuntansi Keuangan yang berlaku umum di Indonesia (PSAK)");
    expect(policy).not.toContain("(SAK EP)");
    expect(policy).toMatch(/PSAK 109/);
    expect(policy).toMatch(/aset hak guna/);
    expect(n.directors.join("\n")).toMatch(/berlaku umum di Indonesia/);
  });

  it("SAK EMKM drops expected-loss, right-of-use, deferred-tax and OCI wording, and says what EMKM does not require", async () => {
    const g = await makeGroup();
    await fixture(g);
    await setFramework(g, "SAK_EMKM");
    const n = await notesOf(g);
    const policy = text(n.notes[1]);
    expect(policy).toContain("Entitas Mikro, Kecil, dan Menengah (SAK EMKM)");
    expect(policy).toMatch(/Laporan Posisi Keuangan, Laporan Laba Rugi dan Catatan atas Laporan Keuangan/);
    expect(policy).toMatch(/arus kas dan perubahan ekuitas tidak diwajibkan/i);
    expect(policy).toMatch(/penyisihan piutang tidak tertagih/i);
    for (const banned of [/PSAK/, /ekspektasian/, /forward-looking/i, /matriks provisi/i, /hak guna/i, /tangguhan/i, /komprehensif/i, /SAK EP\b/]) expect(policy).not.toMatch(banned);
    // The receivable's provision note and the lease note use plain wording; their amounts are the same.
    const receivable = n.notes.find((x) => x.title === "Piutang usaha")!;
    expect(receivable.paragraphs.join("\n")).toMatch(/penyisihan piutang tidak tertagih/);
    expect(receivable.paragraphs.join("\n")).not.toMatch(/forward-looking|matriks provisi|kerugian penurunan nilai/);
    const lease = n.notes.find((x) => x.title === "Sewa")!;
    expect(text(lease)).not.toMatch(/hak guna/i);
    expect(text(lease)).toMatch(/SAK EMKM tidak mengatur/);
    expect(lease.tables[0].columns).not.toContain("Aset hak guna");
    // Other comprehensive income is a plain equity movement, and no deferred-tax estimate is offered.
    expect(n.notes.find((x) => x.title === "Penghasilan komprehensif lain")).toBeUndefined();
    expect(n.notes.find((x) => /^Pos ekuitas lain/.test(x.title))).toBeTruthy();
    expect(n.directors.join("\n")).toMatch(/Entitas Mikro, Kecil, dan Menengah \(SAK EMKM\)/);
  });

  it("changes no figure: every note table is the same under all three frameworks", async () => {
    const g = await makeGroup();
    await fixture(g);
    const isEstimate = (r: unknown[]) => String(r[0]).startsWith("Estimasi pajak tangguhan");
    const tables = async () => (await notesOf(g)).notes.filter((x) => !["Sewa", "Piutang usaha", "Penghasilan komprehensif lain"].includes(x.title) && !/^Pos ekuitas lain/.test(x.title)).map((x) => x.tables.map((t) => t.rows.filter((r) => !isEstimate(r)).map((r) => r.slice(1)).concat(t.total ? [t.total.slice(1)] : [])));
    const estimate = async () => (await notesOf(g)).notes.flatMap((x) => x.tables.flatMap((t) => t.rows)).filter(isEstimate);
    const ep = await tables();
    expect(await estimate()).toHaveLength(1); // the deferred-tax estimate not yet journalled: an estimate, on no statement

    for (const fw of ["SAK_EMKM", "SAK_UMUM"] as const) {
      await setFramework(g, fw);
      expect(await tables()).toEqual(ep);
      expect(await estimate()).toHaveLength(fw === "SAK_EMKM" ? 0 : 1); // EMKM has no deferred tax to estimate
    }
  });

  it("names the signatory by entity type", async () => {
    const g = await makeGroup();
    for (const [kind, first, last] of [["PT", "SURAT PERNYATAAN DIREKSI", "Direktur"], ["CV", "SURAT PERNYATAAN PEMILIK/PENGURUS", "Pemilik/Pengurus"], ["PERORANGAN", "SURAT PERNYATAAN PEMILIK/PENGURUS", "Pemilik/Pengurus"]] as const) {
      await setFramework(g, "SAK_EP", kind);
      const d = (await notesOf(g)).directors;
      expect([d[0], d.at(-1)]).toEqual([first, last]);
    }
  });

  it("the Excel set uses the same names and signatory sheet", async () => {
    const g = await makeGroup();
    await fixture(g);
    const scope = { clientId: g.client.id, entityIds: [g.pt.entity.id] };
    const sheets = async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await financialStatementsWorkbook(db, scope, 2026, 8, { firm: "KJA Uji", title: "PT Uji" })) as unknown as ArrayBuffer);
      return wb;
    };
    let wb = await sheets();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Neraca", "Laba Rugi", "Perubahan Ekuitas", "Arus Kas", "CALK", "Pernyataan Direksi"]);
    expect(String(wb.getWorksheet("Laba Rugi")!.getRow(1).getCell(1).value)).toBe("PT Uji");
    await setFramework(g, "SAK_EMKM", "CV");
    wb = await sheets();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Neraca", "Laba Rugi", "Perubahan Ekuitas", "Arus Kas", "CALK", "Pernyataan Pengurus"]);
    const cells: string[] = [];
    wb.getWorksheet("Laba Rugi")!.eachRow((r) => cells.push(String(r.getCell(1).value ?? "")));
    expect(cells.join("|")).toContain("Laporan Laba Rugi");
    expect(cells.join("|")).not.toMatch(/komprehensif/i);
    const cash: string[] = [];
    wb.getWorksheet("Arus Kas")!.eachRow((r) => cash.push(String(r.getCell(1).value ?? "")));
    expect(cash.join("|")).toContain("informasi tambahan");
  });
});
