import type { Db } from "@/lib/db";
import { createClient, createFirm } from "@/lib/setup";
import { importStatement } from "@/lib/import/pipeline";
import { reviewTransaction } from "@/lib/review";
import { postOpening, type OpeningLineInput } from "@/lib/opening";
import { dateOnly } from "@/lib/format";
import { renderStatement } from "@/lib/demo/writers";
import { statementFiles, type ClientScenario, type DemoLine, type Truth } from "@/lib/demo/scenario";

/**
 * Golden dataset (use-case feedback UC-K1 / UC-K5): a Belifi-pattern group — a trading PT with two bank accounts and its owner with
 * one — over three months, generated deterministically and run through the real pipeline. `goldenKey()` computes the key numbers
 * from the generator's truth with plain sums by account class (no lib/reports, no lib/ledger), and the numbers are committed as
 * literals in tests/golden/belifi-pattern.json: the app, the calculator and the file must agree to the rupiah.
 * Synthetic only — names, account numbers and amounts are invented; only the shape follows the real folder.
 */
export const GOLDEN_MONTHS = [4, 5, 6].map((m) => ({ year: 2026, month: m }));
export const GOLDEN_OPENING_DATE = dateOnly(2026, 3, 31);
export const GOLDEN_END = dateOnly(2026, 6, 30);
/** Bank GL codes in creation order (PT BCA, PT Mandiri, owner BCA), as `createClient` numbers them. */
export const GOLDEN_BANK_CODES = { "pt-bca": "1101", "pt-mdr": "1102", "own-bca": "1103" } as const;
/**
 * Petty cash the old Neraca holds outside the banks: Kas Rp 1.000.000.000 there, the statements show Rp 940.000.000 (UC-B4).
 * Typed without it, Saldo Awal is short by exactly this amount.
 */
export const GOLDEN_PETTY_CASH = 60_000_000n;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function goldenScenario(): ClientScenario {
  const rand = mulberry32(20261002);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  /** Rupiah in [lo, hi] juta, to the thousand: amounts of unrelated lines never coincide by construction of the guard below. */
  const jt = (lo: number, hi: number) => BigInt(Math.round(between(lo, hi) * 1000)) * 1000n;
  const day = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));
  const ref = () => `${Math.floor(between(10000, 99999))}`;
  const d = (y: number, m: number, dd: number) => dateOnly(y, m, Math.min(dd, new Date(Date.UTC(y, m, 0)).getUTCDate()));
  const bca = (dir: "DB" | "CR", m: number, dd: number, who: string) => `TRSF E-BANKING ${dir} ${String(dd).padStart(2, "0")}${String(m).padStart(2, "0")}/FTSCY/WS9${ref()} ${who}`;
  const T = (accountCode: string, taxTag: Truth["taxTag"] = null): Truth => ({ accountCode, taxTag });

  const PT = "PT GEMILANG MAHAKARYA NUSA";
  const OWNER = "RANI KUSUMAWARDANI";
  const resellers = ["DEWI ANGGRAINI", "HENDRA SAPUTRA", "MEGA LESTARI", "YOGI PRATAMA", "FITRI HANDAYANI", "BAGUS WIRAWAN"];
  const suppliers = ["CV SUMBER BAHAN MAKMUR", "PT KARYA PLASTIK INDO", "UD SENTOSA JAYA ABADI"];
  const lines: DemoLine[] = [];
  const add = (bankKey: string, date: Date, description: string, amount: bigint, truth: Truth) => lines.push({ bankKey, date, description, amount, truth });

  for (const { year: y, month: m } of GOLDEN_MONTHS) {
    // PT BCA: reseller sales (named people, the "6101 basket" pattern), supplier purchases, payroll, rent, utilities, ads, tax, bank items.
    for (const r of resellers) for (let w = 0; w < 4; w++) { const dd = day(1 + w * 7, 6 + w * 7); add("pt-bca", d(y, m, dd), bca("CR", m, dd, r), jt(9, 22), T("4100")); }
    for (const s of suppliers) for (let i = 0; i < 3; i++) { const dd = day(2 + i * 9, 7 + i * 9); add("pt-bca", d(y, m, dd), bca("DB", m, dd, s), -jt(14, 26), T("5100")); }
    for (let i = 0; i < 4; i++) { const dd = day(3 + i * 6, 6 + i * 6); add("pt-bca", d(y, m, dd), bca("DB", m, dd, "CV KEMASAN PRIMA BOX"), -jt(2, 4), T("5100")); }
    add("pt-bca", d(y, m, 25), "PAYROLL KARYAWAN BULANAN", -jt(58, 62), T("6100"));
    add("pt-bca", d(y, m, 10), bca("DB", m, 10, "BPJS KETENAGAKERJAAN"), -jt(2.5, 3.2), T("6110"));
    add("pt-bca", d(y, m, 5), bca("DB", m, 5, "HJ MARYAM SEWA GUDANG"), -25_000_000n - BigInt(m) * 1000n, T("6120"));
    add("pt-bca", d(y, m, 12), "PEMBAYARAN PLN POSTPAID KANTOR", -jt(3, 5), T("6130"));
    add("pt-bca", d(y, m, 14), "TELKOM INDIHOME BISNIS", -jt(0.8, 1.2), T("6130"));
    add("pt-bca", d(y, m, 18), "META PLATFORMS IRELAND ADS", -jt(4, 8), T("6150"));
    add("pt-bca", d(y, m, 15), "SETORAN PAJAK PPH 21 DJP", -6_000_000n, T("2140", "PPH_21"));
    add("pt-bca", d(y, m, 28), "BIAYA ADM", -30_000n, T("7100"));
    add("pt-bca", d(y, m, 28), "BUNGA JASA GIRO", 640_000n + BigInt(m) * 1000n, T("4900"));
    // PT Mandiri: marketplace settlements, couriers, fuel, fee.
    for (let i = 0; i < 10; i++) { const dd = day(1 + i * 3, 3 + i * 3); add("pt-mdr", d(y, m, dd), `TRANSFER DARI SHOPEE INTERNATIONAL SETTLEMENT ${ref()}`, jt(5, 11), T("4100")); }
    for (let i = 0; i < 4; i++) { const dd = day(4 + i * 7, 8 + i * 7); add("pt-mdr", d(y, m, dd), `TRANSFER KE JNE EXPRESS ONGKIR ${ref()}`, -jt(1.5, 2.5), T("6140")); }
    for (let i = 0; i < 2; i++) { const dd = day(9 + i * 10, 12 + i * 10); add("pt-mdr", d(y, m, dd), `DEBIT SPBU BENSIN OPERASIONAL ${ref()}`, -jt(0.6, 1.1), T("6140")); }
    add("pt-mdr", d(y, m, 28), "BIAYA ADM BULANAN", -25_000n, T("7100"));
    // Own-account sweeps Mandiri → BCA (1199 nets to 0) and the PT lending to its owner (1190 in both books).
    for (const dd of [13, 26]) {
      const amt = jt(28, 34);
      add("pt-mdr", d(y, m, dd), `PINDAH BUKU KE BCA ${PT}`, -amt, T("1199"));
      add("pt-bca", d(y, m, dd), bca("CR", m, dd, `PINDAH BUKU DARI MANDIRI ${PT}`), amt, T("1199"));
    }
    {
      const dd = day(20, 22);
      const amt = jt(15, 20);
      add("pt-bca", d(y, m, dd), bca("DB", m, dd, `${OWNER} PINJAMAN PEMILIK`), -amt, T("1190"));
      add("own-bca", d(y, m, dd), bca("CR", m, dd, PT), amt, T("1190"));
    }
    // Owner: personal spending (prive) and interest.
    for (const [who, lo, hi] of [["TOKOPEDIA", 0.4, 2.5], ["INDOMARET", 0.2, 0.9], ["PERTAMINA", 0.3, 0.8], ["RESTO SEDERHANA", 0.3, 1.2]] as const) {
      const n = who === "TOKOPEDIA" ? 5 : 3;
      for (let i = 0; i < n; i++) add("own-bca", d(y, m, day(2 + i * 5, 5 + i * 5)), `DEBIT ${who} ${ref()}`, -jt(lo, hi), T("3300"));
    }
    add("own-bca", d(y, m, 28), "BUNGA", 41_000n + BigInt(m) * 100n, T("4900"));
  }

  // The false-match trap (UC-B2, the real case): supplier withdrawals of Rp 100 jt and Rp 300 jt on the day a customer's credit of the
  // same amount lands on the other account, both with transfer words. They are payments and receipts, never one transfer.
  const traps = [
    { out: { bankKey: "pt-bca", description: bca("DB", 5, 12, "PT BAJA SUPPLIER PRIMA"), amount: -100_000_000n }, in: { bankKey: "pt-mdr", description: "TRANSFER DARI CV PELANGGAN SETIA", amount: 100_000_000n }, date: d(2026, 5, 12) },
    { out: { bankKey: "pt-bca", description: bca("DB", 6, 19, "UD BESI KUAT SENTOSA"), amount: -300_000_000n }, in: { bankKey: "pt-mdr", description: "TRANSFER DARI PT GROSIR NUSA RAYA", amount: 300_000_000n }, date: d(2026, 6, 19) },
  ];
  for (const t of traps) {
    add(t.out.bankKey, t.date, t.out.description, t.out.amount, T("5100"));
    add(t.in.bankKey, t.date, t.in.description, t.in.amount, T("4100"));
  }
  const trapped = new Set(traps.flatMap((t) => [t.out.description, t.in.description]));

  // Equal opposite amounts on two accounts within a few days pair as a transfer (rule 13). Only the planted transfers and the trap may
  // do so here: anything else would be an accident of the generator.
  const loose = lines.filter((l) => l.truth.accountCode !== "1199" && l.truth.accountCode !== "1190" && !trapped.has(l.description));
  for (const a of loose) for (const b of lines) {
    if (a !== b && a.bankKey !== b.bankKey && a.amount === -b.amount && Math.abs(+a.date - +b.date) <= 5 * 86_400_000) throw new Error(`Golden: ${a.description} dan ${b.description} bisa terpasangkan sebagai transfer`);
  }

  return {
    key: "golden",
    spec: {
      name: "Grup Gemilang (uji emas)",
      industry: "perdagangan online produk rumah tangga",
      entities: [
        { name: "PT Gemilang Mahakarya Nusa", shortName: "PT Gemilang", kind: "PT", banks: [{ bank: "BCA", number: "6120334455", label: "BCA Giro" }, { bank: "MANDIRI", number: "1270011223344", label: "Mandiri Giro" }] },
        { name: "Rani Kusumawardani", shortName: "Rani (Pemilik)", kind: "PERORANGAN", banks: [{ bank: "BCA", number: "7340556677", label: "BCA Tahapan" }] },
      ],
    },
    banks: {
      "pt-bca": { entity: 0, bank: 0, opening: 610_000_000n },
      "pt-mdr": { entity: 0, bank: 1, opening: 330_000_000n },
      "own-bca": { entity: 1, bank: 0, opening: 125_000_000n },
    },
    // The old Neraca per 31 March 2026 besides the banks (signed: debit +, credit −). It balances: Saldo Laba is the Neraca's own figure.
    openings: [
      [
        { code: "1110", amount: GOLDEN_PETTY_CASH },
        { code: "1130", amount: 385_000_000n },
        { code: "1160", amount: 240_000_000n },
        { code: "1210", amount: 650_000_000n },
        { code: "1219", amount: -130_000_000n },
        { code: "2110", amount: -175_000_000n },
        { code: "2140", amount: -18_000_000n },
        { code: "3100", amount: -1_000_000_000n },
        { code: "3200", amount: -952_000_000n },
      ],
      [{ code: "3100", amount: -125_000_000n }],
    ],
    lines,
    closedThrough: { year: 2026, month: 3 },
  };
}

export type GoldenKey = Record<string, string>;

/**
 * The key numbers from the generator's truth alone: balances are signed sums by account code; the class of the code's first digit
 * says what it is (1 asset, 2 liability, 3 equity, 4–8 profit or loss). 1190 is a receivable when it holds a debit and a payable
 * when it holds a credit; across the group it nets to zero. Amounts are whole Rupiah as strings.
 */
export function goldenKey(sc: ClientScenario): GoldenKey {
  const nets = sc.spec.entities.map(() => new Map<string, bigint>());
  const add = (e: number, code: string, v: bigint) => nets[e].set(code, (nets[e].get(code) ?? 0n) + v);
  for (const [key, b] of Object.entries(sc.banks)) add(b.entity, GOLDEN_BANK_CODES[key as keyof typeof GOLDEN_BANK_CODES], b.opening);
  sc.openings.forEach((ls, e) => ls.forEach((o) => add(e, o.code, o.amount)));
  for (const l of sc.lines) {
    const e = sc.banks[l.bankKey].entity;
    add(e, GOLDEN_BANK_CODES[l.bankKey as keyof typeof GOLDEN_BANK_CODES], l.amount);
    add(e, l.truth.accountCode, -l.amount);
  }
  const cls = (code: string) => Number(code[0]);
  const total = (m: Map<string, bigint>, pick: (code: string, v: bigint) => boolean) => [...m].filter(([c, v]) => pick(c, v)).reduce((s, [, v]) => s + v, 0n);
  const figures = (m: Map<string, bigint>) => {
    const assets = total(m, (c, v) => cls(c) === 1 && !(c === "1190" && v < 0n));
    const liabilities = -total(m, (c, v) => cls(c) === 2 || (c === "1190" && v < 0n));
    const profit = -total(m, (c) => cls(c) >= 4);
    const equity = -total(m, (c) => cls(c) === 3) + profit;
    const revenue = -total(m, (c) => c.startsWith("41"));
    return { assets, liabilities, equity, profit, revenue };
  };
  const [pt, owner] = nets;
  const group = new Map<string, bigint>();
  for (const m of nets) for (const [c, v] of m) group.set(c, (group.get(c) ?? 0n) + v);
  const p = figures(pt), o = figures(owner), g = figures(group);
  const s = (v: bigint | undefined) => (v ?? 0n).toString();
  return {
    "pt.totalAssets": s(p.assets),
    "pt.totalLiabilities": s(p.liabilities),
    "pt.totalEquity": s(p.equity),
    "pt.revenue": s(p.revenue),
    "pt.netProfit": s(p.profit),
    "pt.cash.bca": s(pt.get("1101")),
    "pt.cash.mandiri": s(pt.get("1102")),
    "pt.cash.petty": s(pt.get("1110")),
    "pt.1199": s(pt.get("1199")),
    "pt.1190": s(pt.get("1190")),
    "pt.retainedOpening": s(-(pt.get("3200") ?? 0n)),
    "owner.totalAssets": s(o.assets),
    "owner.totalLiabilities": s(o.liabilities),
    "owner.totalEquity": s(o.equity),
    "owner.netProfit": s(o.profit),
    "owner.cash.bca": s(owner.get("1103")),
    "owner.prive": s(owner.get("3300")),
    "owner.1190": s(owner.get("1190")),
    "group.totalAssets": s(g.assets),
    "group.netProfit": s(g.profit),
  };
}

/** Saldo Awal as the accountant types it from the old Neraca: the banks prefilled from the statements, then the other lines. */
export function goldenOpeningLines(sc: ClientScenario, entity: number, opts: { omitPettyCash?: boolean } = {}): OpeningLineInput[] {
  const banks = Object.entries(sc.banks).filter(([, b]) => b.entity === entity).map(([key, b]) => ({ code: GOLDEN_BANK_CODES[key as keyof typeof GOLDEN_BANK_CODES], amount: b.opening }));
  const others = sc.openings[entity].filter((o) => !(opts.omitPettyCash && o.code === "1110"));
  const plain = (v: bigint) => (v < 0n ? -v : v).toString();
  return [...banks, ...others].filter((o) => o.amount !== 0n).map((o) => ({ accountCode: o.code, debit: o.amount > 0n ? plain(o.amount) : "", credit: o.amount < 0n ? plain(o.amount) : "" }));
}

/** Decides every line still in Review with the generator's truth, as the accountant would (Memory learns). */
export async function reviewWithTruth(db: Db, sc: ClientScenario, clientId: string) {
  const keyOf = (number: string, date: Date, amount: bigint, description: string) => `${number}|${date.toISOString().slice(0, 10)}|${amount}|${description}`;
  const truth = new Map<string, Truth>();
  for (const l of sc.lines) {
    const b = sc.banks[l.bankKey];
    truth.set(keyOf(sc.spec.entities[b.entity].banks[b.bank].number, l.date, l.amount, l.description), l.truth);
  }
  const pending = await db.bankTransaction.findMany({ where: { bankAccount: { entity: { clientId } }, status: "NEEDS_REVIEW" }, include: { bankAccount: true } });
  for (const t of pending) {
    const tr = truth.get(keyOf(t.bankAccount.number, t.date, t.amount, t.description));
    if (!tr) throw new Error(`Golden: tidak ada truth untuk ${t.description}`);
    await reviewTransaction(db, { bankTxId: t.id, accountCode: tr.accountCode, taxTag: tr.taxTag, learn: true });
  }
}

/**
 * Builds the golden client through the real path: Saldo Awal typed through `postOpening`, every statement imported month by month
 * through `importStatement` (no AI), every line still in Review decided with the truth (Memory learns, as the accountant's work would).
 */
export async function seedGolden(db: Db, sc: ClientScenario, opts: { omitPettyCash?: boolean } = {}) {
  const firm = await db.$transaction((tx) => createFirm(tx, "KJA Uji Emas"));
  const { client, entities } = await db.$transaction((tx) => createClient(tx, firm.id, sc.spec));
  for (let i = 0; i < entities.length; i++) {
    await postOpening(db, { clientId: client.id, entityId: entities[i].entity.id, date: GOLDEN_OPENING_DATE, lines: goldenOpeningLines(sc, i, i === 0 ? opts : {}) });
  }
  const files = statementFiles(sc, GOLDEN_MONTHS);
  const imported: { bankAccountId: string; fileName: string; data: Buffer }[] = [];
  for (const { year, month } of GOLDEN_MONTHS) {
    for (const f of files.filter((x) => x.year === year && x.month === month)) {
      const b = sc.banks[f.bankKey];
      const { fileName, data } = await renderStatement(f);
      const bankAccountId = entities[b.entity].banks[b.bank].id;
      await importStatement(db, { bankAccountId, fileName, data, provider: null });
      imported.push({ bankAccountId, fileName, data });
    }
    await reviewWithTruth(db, sc, client.id);
  }
  return { firm, client, entities, imported };
}
