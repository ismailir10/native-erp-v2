import type { Db } from "@/lib/db";
import { dateOnly, formatDate, formatPeriod, periodBounds } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { balanceSheet, incomeStatement, type FsItem, type Scope } from "@/lib/reports/ledger";
import { MixedScopeError, otherComprehensiveIncome } from "@/lib/reports/statements";
import { isMixed, scopeEntities } from "@/lib/reports/fx";
import { assetRegister } from "@/lib/assets/register";
import { BUCKETS, BUCKET_LABEL, invoicesAt } from "@/lib/receivables/aging";
import { ckpn } from "@/lib/receivables/ckpn";
import { leaseSchedule, positionAt } from "@/lib/leases/schedule";
import { terms } from "@/lib/leases/register";
import { valuation } from "@/lib/benefits/valuation";
import { packApplies, taxPack } from "@/lib/tax/pack";

/**
 * CALK draft and the directors' statement (accounting-rules 12): every figure comes from the same functions as its page — the statements,
 * the registers, the valuation and the tax pack — so a note always equals its statement. The text is a starting point the accountant
 * edits in the downloaded workbook; Buku doesn't store notes.
 */

export type NoteCell = string | bigint | null;
export type NoteTable = { columns: string[]; rows: NoteCell[][]; total?: NoteCell[] };
export type Note = { number: string; title: string; paragraphs: string[]; tables: NoteTable[] };
export type Notes = { title: string; entities: string; asOf: Date; comparativeLabel: string; notes: Note[]; directors: string[] };

const pct = (bp: number) => `${(bp / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;

export async function financialNotes(db: Db, scope: Scope, year: number, month: number): Promise<Notes> {
  const entities = await db.entity.findMany({ where: { id: { in: scope.entityIds } }, orderBy: { name: "asc" } });
  if (isMixed(await scopeEntities(db, scope.entityIds))) throw new MixedScopeError();
  const client = await db.client.findUniqueOrThrow({ where: { id: scope.clientId }, select: { name: true } });
  const currency = entities[0]?.functionalCurrency ?? "IDR";
  const asOf = periodBounds(year, month).end;
  const lastYearEnd = dateOnly(year - 1, 12, 31);
  const priorTo = periodBounds(year - 1, month).end;
  const [bs, bsPrior, is, isPrior, oci] = await Promise.all([
    balanceSheet(db, scope, asOf),
    balanceSheet(db, scope, lastYearEnd),
    incomeStatement(db, scope, dateOnly(year, 1, 1), asOf),
    incomeStatement(db, scope, dateOnly(year - 1, 1, 1), priorTo),
    otherComprehensiveIncome(db, scope, dateOnly(year, 1, 1), asOf),
  ]);
  const cur = formatPeriod(year, month);
  const bsCols = ["Akun", formatDate(asOf), formatDate(lastYearEnd)];
  const plCols = ["Akun", `1 Jan – ${formatDate(asOf)}`, `1 Jan – ${formatDate(priorTo)}`];
  const names = entities.map((e) => e.name).join(", ");
  const notes: Note[] = [];
  let n = 0;
  const add = (title: string, paragraphs: string[] = [], tables: NoteTable[] = []) => {
    const note = { number: String(++n), title, paragraphs, tables };
    notes.push(note);
    return note;
  };

  // 1. Umum
  add("Umum", [
    entities.length > 1
      ? `${names}, entitas-entitas dalam grup ${client.name}, menyajikan laporan keuangan gabungan untuk periode 1 Januari – ${formatDate(asOf)}.`
      : `${names} ("Entitas") menyajikan laporan keuangan untuk periode 1 Januari – ${formatDate(asOf)}.`,
    ...entities.filter((e) => e.npwp).map((e) => `${e.name}: NPWP ${e.npwp}.`),
    entities.length > 1 ? "Laporan gabungan ini adalah pandangan manajemen atas entitas-entitas dalam grup, bukan laporan konsolidasian menurut SAK." : "",
  ].filter(Boolean));

  // 2. Kebijakan akuntansi — only the policies of what the books contain.
  const has = async (where: Promise<number>) => (await where) > 0;
  const ids = { in: scope.entityIds };
  const [assets, ckpnSet, leases, benefits] = await Promise.all([
    has(db.fixedAsset.count({ where: { entityId: ids } })),
    has(db.ckpnSetting.count({ where: { entityId: ids } })),
    has(db.lease.count({ where: { entityId: ids, cancelEntryId: null } })),
    has(db.benefitSetting.count({ where: { entityId: ids } })),
  ]);
  add("Ikhtisar kebijakan akuntansi", [
    `Dasar penyusunan. Laporan keuangan disusun berdasarkan Standar Akuntansi Keuangan Entitas Privat (SAK EP) dengan dasar akrual dan konsep biaya historis, dalam ${currency === "IDR" ? "Rupiah" : currency}. Laporan arus kas disusun dengan metode tidak langsung.`,
    "Kas dan setara kas meliputi kas dan rekening bank yang dapat digunakan tanpa pembatasan.",
    `Piutang usaha dicatat sebesar nilai tagihan${ckpnSet ? "; cadangan kerugian penurunan nilai diukur dengan pendekatan sederhana (kerugian kredit ekspektasian sepanjang umur) memakai matriks provisi dari umur piutang (PSAK 109)" : ""}.`,
    assets ? "Aset tetap dicatat sebesar biaya perolehan dikurangi akumulasi penyusutan, disusutkan dengan metode garis lurus selama umur manfaatnya; tanah tidak disusutkan." : "",
    leases ? "Sewa. Sebagai penyewa, entitas mengakui aset hak guna dan liabilitas sewa sebesar nilai kini pembayaran sewa yang didiskonto dengan suku bunga pinjaman inkremental; aset hak guna disusutkan garis lurus selama masa sewa, bunga dibebankan dengan metode suku bunga efektif. Sewa jangka pendek (≤ 12 bulan) dibebankan langsung." : "",
    benefits ? "Imbalan kerja. Liabilitas imbalan pascakerja sesuai PP 35/2021 dihitung dengan metode Projected Unit Credit; biaya jasa dan bunga diakui di laba rugi, pengukuran kembali di penghasilan komprehensif lain." : "",
    "Pajak penghasilan kini dihitung dari laba fiskal; pajak tangguhan diakui atas beda temporer antara nilai tercatat dan dasar pengenaan pajak aset dan liabilitas dengan tarif yang berlaku.",
    "Pendapatan diakui saat barang diserahkan atau jasa diberikan; beban diakui saat terjadi.",
  ].filter(Boolean).map((p, i) => `${String.fromCharCode(97 + i)}. ${p}`));

  // 3+. One note per Neraca line, then per Laba Rugi line: accounts, current vs comparative.
  const lineNote = (label: string, current: FsItem | undefined, prior: FsItem | undefined, cols: string[]) => {
    const codes = [...new Set([...(current?.accounts ?? []), ...(prior?.accounts ?? [])].map((a) => a.code))];
    const rows = codes.map((code) => {
      const name = [...(current?.accounts ?? []), ...(prior?.accounts ?? [])].find((x) => x.code === code)?.name ?? "";
      return [`${code} ${name}`, current?.accounts.find((x) => x.code === code)?.amount ?? 0n, prior?.accounts.find((x) => x.code === code)?.amount ?? 0n];
    });
    return add(label, [], [{ columns: cols, rows, total: ["Jumlah", current?.amount ?? 0n, prior?.amount ?? 0n] }]);
  };
  const bsLines = (pick: (b: typeof bs) => FsItem[]) => {
    const keys = [...new Set([...pick(bs), ...pick(bsPrior)].map((i) => i.fsLine))];
    return keys.map((k) => ({ k, cur: pick(bs).find((i) => i.fsLine === k), old: pick(bsPrior).find((i) => i.fsLine === k) }));
  };
  const lineByKey = new Map<string, Note>();
  for (const { k, cur: c, old } of [...bsLines((b) => b.currentAssets), ...bsLines((b) => b.nonCurrentAssets), ...bsLines((b) => b.liabilities), ...bsLines((b) => b.equity)]) {
    if (k === "LABA_BERJALAN") continue;
    lineByKey.set(k, lineNote((c ?? old)!.label.replace(/^./, (x) => x.toUpperCase()), c, old, bsCols));
  }
  const plKeys = (pick: (i: typeof is) => FsItem[]) => [...new Set([...pick(is), ...pick(isPrior)].map((i) => i.fsLine))].map((k) => ({ k, cur: pick(is).find((i) => i.fsLine === k), old: pick(isPrior).find((i) => i.fsLine === k) }));
  for (const { k, cur: c, old } of [...plKeys((i) => i.revenue), ...plKeys((i) => i.cogs), ...plKeys((i) => i.opex), ...plKeys((i) => i.other), ...plKeys((i) => i.tax)]) {
    lineByKey.set(`PL:${k}`, lineNote((c ?? old)!.label.replace(/^./, (x) => x.toUpperCase()), c, old, plCols));
  }

  // Detail from the registers, attached to their line.
  const reg = await assetRegister(db, scope.clientId, year, month, scope.entityIds);
  const register = reg.filter((r) => r.cost !== 0n);
  if (register.length) {
    const note = lineByKey.get("ASET_TETAP") ?? add("Aset tetap");
    note.paragraphs.push(`Rincian dari daftar aset tetap per ${formatDate(asOf)}. Penyusutan tahun berjalan ${formatMoney(register.reduce((t, r) => t + r.bookYtd, 0n), currency)}.`);
    note.tables.push({
      columns: ["Aset", "Harga perolehan", "Akumulasi penyusutan", "Nilai buku"],
      rows: register.map((r) => [`${r.name} (${r.assetAccount.code})`, r.cost, r.accumulated, r.bookValue]),
      total: ["Jumlah", register.reduce((t, r) => t + r.cost, 0n), register.reduce((t, r) => t + r.accumulated, 0n), register.reduce((t, r) => t + r.bookValue, 0n)],
    });
  }
  const items = (await invoicesAt(db, scope.clientId, "SALES", asOf, scope.entityIds)).filter((i) => i.open > 0n);
  if (items.length) {
    const note = lineByKey.get("PIUTANG_USAHA") ?? add("Piutang usaha");
    const by = BUCKETS.map((b) => items.filter((i) => i.bucket === b).reduce((t, i) => t + i.open, 0n));
    note.paragraphs.push(`Umur piutang usaha per ${formatDate(asOf)} dari daftar faktur.`);
    note.tables.push({ columns: ["Umur", "Jumlah"], rows: BUCKETS.map((b, i) => [BUCKET_LABEL[b], by[i]]), total: ["Jumlah", by.reduce((t, v) => t + v, 0n)] });
    for (const e of entities) {
      if (!(await db.ckpnSetting.findUnique({ where: { entityId: e.id } }))) continue;
      const c = await ckpn(db, scope.clientId, e.id, year, month);
      if (c.total === null) continue;
      note.paragraphs.push(`${entities.length > 1 ? `${e.shortName}: ` : ""}cadangan kerugian penurunan nilai piutang ${formatMoney(c.total, currency)} (matriks provisi, metode ${c.setting.method === "ROLL_RATE" ? "roll rate" : "tarif manual"}, faktor forward-looking ${pct(c.setting.forwardBp)}).`);
      note.tables.push({ columns: ["Umur", "Saldo", "Tarif kerugian", "CKPN"], rows: c.rows.map((r) => [BUCKET_LABEL[r.bucket], r.open, r.rate === null ? "–" : `${(Number(r.rate) / 10_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`, r.amount]), total: ["Jumlah", c.rows.reduce((t, r) => t + r.open, 0n), null, c.total] });
    }
  }
  const leaseRows = await db.lease.findMany({ where: { clientId: scope.clientId, entityId: ids, cancelEntryId: null }, orderBy: { name: "asc" } });
  const leasePos = leaseRows.map((l) => ({ l, p: positionAt(terms(l), leaseSchedule(terms(l)), year, month) })).filter((x) => x.p.started);
  if (leasePos.length) {
    add("Sewa", [`Aset hak guna dan liabilitas sewa per ${formatDate(asOf)} dari daftar sewa. Beban bunga sewa tahun berjalan ${formatMoney(leasePos.reduce((t, x) => t + x.p.year.interest, 0n), currency)}; penyusutan aset hak guna ${formatMoney(leasePos.reduce((t, x) => t + x.p.year.depreciation, 0n), currency)}.`], [
      {
        columns: ["Sewa", "Aset hak guna", "Akumulasi penyusutan", "Liabilitas jangka pendek", "Liabilitas jangka panjang"],
        rows: leasePos.map(({ l, p }) => [`${l.name} · ${l.lessor}`, p.rou, p.accumulated, p.current, p.nonCurrent]),
        total: ["Jumlah", ...(["rou", "accumulated", "current", "nonCurrent"] as const).map((k) => leasePos.reduce((t, x) => t + x.p[k], 0n))],
      },
    ]);
  }
  for (const e of entities) {
    const setting = await db.benefitSetting.findUnique({ where: { entityId: e.id } });
    if (!setting) continue;
    const v = await valuation(db, scope.clientId, e.id, year, month);
    if (v.blocker) continue;
    add(`Liabilitas imbalan kerja${entities.length > 1 ? ` · ${e.shortName}` : ""}`, [
      `Dihitung dengan metode Projected Unit Credit untuk ${v.employees.length} karyawan per ${formatDate(asOf)}, manfaat sesuai PP 35/2021. Asumsi: tingkat diskonto ${pct(setting.discountBp)}, kenaikan gaji ${pct(setting.salaryBp)}, usia pensiun normal ${setting.retirementAge} tahun, tabel mortalita ${v.tableName}, tingkat cacat ${pct(setting.disabilityBp)} dari mortalita, pengunduran diri ${pct(setting.resignBp)} sampai usia ${setting.resignFlatUntil} menurun ke 0% pada usia ${setting.resignZeroAge}.`,
    ], [
      { columns: ["Uraian", "Jumlah"], rows: [["Liabilitas imbalan kerja", v.dbo], ["Biaya jasa kini tahun depan", v.serviceCost], ["Biaya bunga tahun depan", v.interestCost], ["Beban imbalan kerja tahun berjalan (6105)", v.expenseTarget]] },
      ...(v.sensitivity ? [{ columns: ["Sensitivitas", "Liabilitas"], rows: [["Diskonto +1%", v.sensitivity.discountUp], ["Diskonto −1%", v.sensitivity.discountDown], ["Kenaikan gaji +1%", v.sensitivity.salaryUp], ["Kenaikan gaji −1%", v.sensitivity.salaryDown]] as NoteCell[][] }] : []),
    ]);
  }
  if (oci.items.length) {
    add("Penghasilan komprehensif lain", ["Pos yang tidak akan direklasifikasi ke laba rugi."], [{ columns: ["Pos", "Jumlah"], rows: oci.items.map((i) => [i.label, i.amount]), total: ["Jumlah", oci.total] }]);
  }
  for (const e of entities.filter((x) => packApplies(x))) {
    const p = await taxPack(db, scope.clientId, e.id, year, month);
    if (!p || p.regime !== "NORMAL") continue;
    add(`Pajak penghasilan${entities.length > 1 ? ` · ${e.shortName}` : ""}`, [`Rekonsiliasi laba komersial ke laba fiskal ${year} s.d. ${cur} (estimasi, bukan SPT).`], [
      {
        columns: ["Uraian", "Jumlah"],
        rows: [
          ["Laba sebelum pajak", p.profitBeforeTax],
          ...p.corrections.map((c): NoteCell[] => [`${c.direction === "POSITIVE" ? "(+)" : "(−)"} ${c.label}`, c.direction === "POSITIVE" ? c.amount : -c.amount]),
          ["Laba (rugi) fiskal", p.fiscalProfit],
          ...(p.compensation > 0n ? [["Kompensasi kerugian", -p.compensation] as NoteCell[]] : []),
          ["Penghasilan kena pajak", p.tax.pkp],
          ["Pajak penghasilan kini", p.tax.due],
          ...(p.deferred ? [[p.deferred.amount >= 0n ? "Aset pajak tangguhan" : "Liabilitas pajak tangguhan", p.deferred.amount < 0n ? -p.deferred.amount : p.deferred.amount] as NoteCell[]] : []),
        ],
      },
    ]);
  }

  const title = entities.length === 1 ? entities[0].name : client.name;
  return {
    title,
    entities: names,
    asOf,
    comparativeLabel: formatDate(lastYearEnd),
    notes,
    directors: directorsStatement(title, asOf),
  };
}

/** The directors' statement of responsibility (a template: name and signature are left blank). */
export function directorsStatement(entity: string, asOf: Date): string[] {
  return [
    "SURAT PERNYATAAN DIREKSI",
    `TENTANG TANGGUNG JAWAB ATAS LAPORAN KEUANGAN ${entity.toUpperCase()}`,
    `UNTUK PERIODE YANG BERAKHIR ${formatDate(asOf).toUpperCase()}`,
    "Kami yang bertanda tangan di bawah ini:",
    "Nama: ____________________    Jabatan: Direktur",
    "menyatakan bahwa:",
    `1. Kami bertanggung jawab atas penyusunan dan penyajian laporan keuangan ${entity};`,
    "2. Laporan keuangan telah disusun dan disajikan sesuai dengan Standar Akuntansi Keuangan Entitas Privat;",
    "3. a. Semua informasi dalam laporan keuangan telah dimuat secara lengkap dan benar;",
    "   b. Laporan keuangan tidak mengandung informasi atau fakta material yang tidak benar, dan tidak menghilangkan informasi atau fakta material;",
    `4. Kami bertanggung jawab atas sistem pengendalian intern dalam ${entity}.`,
    "Demikian pernyataan ini dibuat dengan sebenarnya.",
    "____________________, ____________________",
    "Direktur",
  ];
}
