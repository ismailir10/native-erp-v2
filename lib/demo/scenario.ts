import type { TaxTag } from "@/lib/generated/prisma/enums";
import type { ClientSpec } from "@/lib/setup";
import { dateOnly } from "@/lib/format";
import { merchantKey } from "@/lib/import/normalize";
import type { StatementFile } from "@/lib/demo/writers";

/**
 * Deterministic demo scenario — chickin-shaped (poultry agritech PT + owner) plus two lighter
 * clients. Everything is synthetic. The generator knows the TRUE account of every line, which
 * `npm run verify:books` compares against what the app computed (layer-2 verification).
 * How to add a scenario: .claude/skills/demo-data/SKILL.md
 */

export const DEMO_MONTHS = [3, 4, 5, 6, 7, 8].map((m) => ({ year: 2026, month: m }));
export const CURRENT = { year: 2026, month: 8 };

export type Truth = { accountCode: string; taxTag: TaxTag | null };
export type AiAnswer = { accountCode: string; confidence: number; taxTag: TaxTag | null; reason: string };
export type DemoLine = {
  bankKey: string;
  date: Date;
  description: string;
  amount: bigint;
  truth: Truth;
  /** Left open in the review queue after seeding (the demo's "to do" list). */
  open?: boolean;
  /** What the (simulated) AI answers for this merchant — may be wrong on purpose. */
  ai?: AiAnswer;
};
export type OpeningLine = { code: string; amount: bigint }; // signed: debit +, credit −
export type ClientScenario = {
  key: string;
  spec: ClientSpec;
  banks: Record<string, { entity: number; bank: number; opening: bigint }>;
  openings: OpeningLine[][]; // per entity, excluding bank balances (added automatically)
  lines: DemoLine[];
  /** Months ≤ this are reviewed + locked by the seed. */
  closedThrough: { year: number; month: number };
  /** Statement held back from the seed and written to public/demo for the live upload. */
  liveUpload?: { bankKey: string; year: number; month: number };
};

// ---------- deterministic PRNG ----------
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260924);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
/** Rupiah amount in [lo, hi] juta, rounded to `step`. */
const jt = (lo: number, hi: number, step = 50_000) => BigInt(Math.round((between(lo, hi) * 1_000_000) / step) * step);
const day = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const ref = () => `${Math.floor(between(10000, 99999))}`;
const d = (y: number, m: number, dd: number) => dateOnly(y, m, Math.min(dd, new Date(Date.UTC(y, m, 0)).getUTCDate()));
const bcaDesc = (dir: "DB" | "CR", y: number, m: number, dd: number, who: string) =>
  `TRSF E-BANKING ${dir} ${String(dd).padStart(2, "0")}${String(m).padStart(2, "0")}/FTSCY/WS9${ref()} ${who}`;

const T = (accountCode: string, taxTag: TaxTag | null = null): Truth => ({ accountCode, taxTag });
const AI = (accountCode: string, reason: string, confidence = 0.86, taxTag: TaxTag | null = null): AiAnswer => ({ accountCode, reason, confidence, taxTag });

// =====================================================================================
// 1) Grup Ayam Nusantara — PT (BCA + Mandiri) + owner Budi Santoso (BCA + BRI)
// =====================================================================================
function grupAyam(): ClientScenario {
  const PT = "PT AYAM NUSANTARA DIGITAL";
  const OWNER = "BUDI SANTOSO";
  const lines: DemoLine[] = [];
  const peternak = ["H. SLAMET RIYADI", "SITI AMINAH", "KOPERASI TERNAK MAJU", "AGUS PRASETYO", "DEDI KURNIAWAN", "RATNA SARI"];

  for (const { year: y, month: m } of DEMO_MONTHS) {
    const aug = m === 8;
    // --- PT BCA: sales to offtakers (rule "MITRA UNGGAS"; "PASAR AYAM MODERN" learnt via AI → memory)
    for (let i = 0; i < 4; i++) {
      const dd = day(3 + i * 7, 6 + i * 7);
      lines.push({ bankKey: "pt-bca", date: d(y, m, dd), description: bcaDesc("CR", y, m, dd, "PT MITRA UNGGAS SENTOSA"), amount: jt(280, 400), truth: T("4100", "PPN_KELUARAN") });
    }
    for (let i = 0; i < 2; i++) {
      const dd = day(8 + i * 10, 12 + i * 10);
      lines.push({
        bankKey: "pt-mdr",
        date: d(y, m, dd),
        description: `TRANSFER DARI PT PASAR AYAM MODERN INV-${y}${m}${i}`,
        amount: jt(120, 210),
        truth: T("4100", "PPN_KELUARAN"),
        ai: AI("4100", "Penerimaan dari pembeli ayam (offtaker)", 0.88, "PPN_KELUARAN"),
      });
    }
    // --- purchases: DOC + feed (client rules), vaccines (AI → memory)
    for (let i = 0; i < 3; i++) {
      const dd = day(2 + i * 9, 5 + i * 9);
      lines.push({ bankKey: "pt-bca", date: d(y, m, dd), description: bcaDesc("DB", y, m, dd, "PT PAKAN JAYA ABADI"), amount: -jt(140, 220), truth: T("5100", "PPN_MASUKAN") });
    }
    for (let i = 0; i < 2; i++) {
      const dd = day(1 + i * 14, 4 + i * 14);
      lines.push({ bankKey: "pt-bca", date: d(y, m, dd), description: bcaDesc("DB", y, m, dd, "PT BIBIT UNGGUL INDONESIA DOC"), amount: -jt(90, 150), truth: T("5100", "PPN_MASUKAN") });
    }
    {
      const dd = day(10, 15);
      lines.push({
        bankKey: "pt-bca",
        date: d(y, m, dd),
        description: bcaDesc("DB", y, m, dd, "CV SUMBER VAKSIN"),
        amount: -jt(12, 25),
        truth: T("5100"),
        ai: AI("5100", "Pembelian vaksin/obat ternak untuk produksi", 0.84),
      });
    }
    // --- farmer partner payouts (rule "MITRA PETERNAK")
    for (const name of peternak.slice(0, 4 + (m % 3))) {
      const dd = day(20, 27);
      lines.push({ bankKey: "pt-bca", date: d(y, m, dd), description: bcaDesc("DB", y, m, dd, `PEMBAYARAN MITRA PETERNAK ${name}`), amount: -jt(35, 70), truth: T("5110") });
    }
    // --- opex (firm rules + AI-learnt vendors)
    lines.push({ bankKey: "pt-bca", date: d(y, m, 25), description: "PAYROLL KARYAWAN BULANAN", amount: -jt(165, 175), truth: T("6100") });
    lines.push({ bankKey: "pt-bca", date: d(y, m, 10), description: bcaDesc("DB", y, m, 10, "BPJS KETENAGAKERJAAN"), amount: -jt(9, 10), truth: T("6110") });
    lines.push({ bankKey: "pt-bca", date: d(y, m, 12), description: "PEMBAYARAN PLN POSTPAID GUDANG", amount: -jt(4, 7), truth: T("6130") });
    lines.push({ bankKey: "pt-bca", date: d(y, m, 14), description: "TELKOM INDIHOME BISNIS", amount: -jt(1, 1.5), truth: T("6130") });
    lines.push({
      bankKey: "pt-bca",
      date: d(y, m, 5),
      description: bcaDesc("DB", y, m, 5, "PT GRAHA LOGISTIK CIKARANG SEWA GUDANG"),
      amount: -45_000_000n,
      truth: T("6120"),
      ai: AI("6120", "Sewa gudang bulanan", 0.9),
    });
    for (let i = 0; i < 2; i++) {
      const dd = day(6 + i * 12, 9 + i * 12);
      lines.push({
        bankKey: "pt-mdr",
        date: d(y, m, dd),
        description: `TRANSFER KE PT KIRIM CEPAT NUSANTARA ONGKIR ${ref()}`,
        amount: -jt(8, 16),
        truth: T("6140"),
        ai: AI("6140", "Jasa pengiriman / logistik", 0.87),
      });
    }
    lines.push({ bankKey: "pt-bca", date: d(y, m, 18), description: "META PLATFORMS IRELAND ADS", amount: -jt(6, 12), truth: T("6150"), ai: AI("6150", "Iklan digital", 0.9) });
    // taxes
    lines.push({ bankKey: "pt-bca", date: d(y, m, 15), description: "SETORAN PPN MASA DJP", amount: -jt(40, 60), truth: T("2130", "PPN_KELUARAN") });
    lines.push({ bankKey: "pt-bca", date: d(y, m, 10), description: "SETORAN PAJAK PPH 21 DJP", amount: -jt(7, 9), truth: T("6100", "PPH_21") });
    // bank items
    lines.push({ bankKey: "pt-bca", date: d(y, m, 28), description: "BIAYA ADM", amount: -30_000n, truth: T("7100") });
    lines.push({ bankKey: "pt-bca", date: d(y, m, 28), description: "BUNGA JASA GIRO", amount: 850_000n, truth: T("4900") });
    lines.push({ bankKey: "pt-bca", date: d(y, m, 28), description: "PAJAK BUNGA", amount: -170_000n, truth: T("8200", "PPH_4_2") });
    lines.push({ bankKey: "pt-mdr", date: d(y, m, 28), description: "BIAYA ADM BULANAN", amount: -25_000n, truth: T("7100") });

    // --- transfers: Mandiri sweeps collections to BCA (1199), PT → owner (1190)
    {
      const dd = day(24, 25);
      const amt = jt(250, 300, 1_000_000);
      lines.push({ bankKey: "pt-mdr", date: d(y, m, dd), description: `TRANSFER KE BCA ${PT} PINDAH BUKU`, amount: -amt, truth: T("1199") });
      lines.push({ bankKey: "pt-bca", date: d(y, m, dd), description: bcaDesc("CR", y, m, dd, `PINDAH BUKU DARI MANDIRI ${PT}`), amount: amt, truth: T("1199") });
    }
    {
      const dd = day(26, 27);
      const amt = jt(25, 40, 1_000_000);
      lines.push({ bankKey: "pt-bca", date: d(y, m, dd), description: bcaDesc("DB", y, m, dd, `${OWNER} PINJAMAN PEMILIK`), amount: -amt, truth: T("1190") });
      lines.push({ bankKey: "own-bri", date: d(y, m, dd), description: `TRANSFER DARI ${PT}`, amount: amt, truth: T("1190") });
    }

    // --- owner personal accounts: prive spending (AI-learnt), own-account transfer (1199)
    for (const [who, lo, hi] of [
      ["TOKOPEDIA", 1, 4],
      ["INDOMARET", 0.3, 1.2],
      ["SEKOLAH ISLAM AL AZHAR SPP", 6, 6],
      ["PERTAMINA", 0.5, 1.5],
    ] as const) {
      lines.push({
        bankKey: who === "PERTAMINA" || who === "INDOMARET" ? "own-bri" : "own-bca",
        date: d(y, m, day(3, 26)),
        description: who === "TOKOPEDIA" ? `TRSF E-BANKING DB ${ref()} TOKOPEDIA` : `DEBIT ${who} ${ref()}`,
        amount: -jt(lo, hi, 10_000),
        truth: T("3300"),
        ai: AI("3300", "Pengeluaran pribadi pemilik (prive)", 0.82),
      });
    }
    {
      const dd = day(12, 14);
      const amt = jt(8, 12, 1_000_000);
      lines.push({ bankKey: "own-bca", date: d(y, m, dd), description: bcaDesc("DB", y, m, dd, `${OWNER} KE BRI`), amount: -amt, truth: T("1199") });
      lines.push({ bankKey: "own-bri", date: d(y, m, dd), description: `TRANSFER DARI ${OWNER} BCA`, amount: amt, truth: T("1199") });
    }
    lines.push({ bankKey: "own-bca", date: d(y, m, 28), description: "BUNGA", amount: 45_000n, truth: T("4900") });

    // --- August: new things the accountant hasn't seen → review queue
    if (aug) {
      // Only in the held-back BRI file (live upload): a merchant nobody has coded yet.
      lines.push({
        bankKey: "own-bri",
        date: d(y, m, 24),
        description: `DEBIT APOTEK KIMIA FARMA ${ref()}`,
        amount: -1_350_000n,
        truth: T("3300"),
        open: true,
        ai: AI("3300", "Belanja obat pribadi pemilik (prive)", 0.81),
      });
      lines.push({
        bankKey: "pt-bca",
        date: d(y, m, 19),
        description: bcaDesc("DB", y, m, 19, "PT AGRO TEKNIK MANDIRI MESIN PAKAN OTOMATIS"),
        amount: -185_000_000n,
        truth: T("1210", "PPN_MASUKAN"),
        open: true,
        // Deliberately wrong: AI thinks it's a feed purchase; the accountant capitalises it.
        ai: AI("5100", "Pembelian terkait pakan", 0.62, "PPN_MASUKAN"),
      });
      lines.push({
        bankKey: "pt-bca",
        date: d(y, m, 21),
        description: bcaDesc("DB", y, m, 21, "KANTOR KONSULTAN PAJAK HARAPAN"),
        amount: -15_000_000n,
        truth: T("6170"),
        open: true,
        ai: AI("6170", "Jasa konsultan pajak", 0.91),
      });
      lines.push({
        bankKey: "pt-mdr",
        date: d(y, m, 22),
        description: "TRANSFER DARI CV PETERNAKAN BERKAH JAYA DP AYAM",
        amount: 60_000_000n,
        truth: T("4100", "PPN_KELUARAN"),
        open: true,
        ai: AI("4100", "Uang muka penjualan ayam", 0.78, "PPN_KELUARAN"),
      });
      lines.push({
        bankKey: "own-bca",
        date: d(y, m, 16),
        description: `TRSF E-BANKING DB ${ref()} RS PONDOK INDAH`,
        amount: -7_250_000n,
        truth: T("3300"),
        open: true,
        ai: AI("3300", "Biaya kesehatan pribadi pemilik", 0.8),
      });
    }
  }

  return {
    key: "grup-ayam",
    spec: {
      name: "Grup Ayam Nusantara",
      industry: "agritech peternakan ayam",
      entities: [
        { name: PT, shortName: "PT AND", kind: "PT", npwp: "01.234.567.8-015.000", banks: [{ bank: "BCA", number: "8720145566", label: "BCA Giro" }, { bank: "MANDIRI", number: "1370098765432", label: "Mandiri Giro" }] },
        { name: OWNER, shortName: "Budi (Pemilik)", kind: "PERORANGAN", banks: [{ bank: "BCA", number: "5210887766", label: "BCA Tahapan" }, { bank: "BRI", number: "012301004455509", label: "BRI Simpedes" }] },
      ],
      rules: [
        { pattern: "PAKAN JAYA", direction: "OUT", accountCode: "5100", taxTag: "PPN_MASUKAN", priority: 50 },
        { pattern: "BIBIT UNGGUL", direction: "OUT", accountCode: "5100", taxTag: "PPN_MASUKAN", priority: 50 },
        { pattern: "MITRA PETERNAK", direction: "OUT", accountCode: "5110", taxTag: null, priority: 50 },
        { pattern: "MITRA UNGGAS", direction: "IN", accountCode: "4100", taxTag: "PPN_KELUARAN", priority: 50 },
      ],
    },
    banks: {
      "pt-bca": { entity: 0, bank: 0, opening: 1_450_000_000n },
      "pt-mdr": { entity: 0, bank: 1, opening: 180_000_000n },
      "own-bca": { entity: 1, bank: 0, opening: 210_000_000n },
      "own-bri": { entity: 1, bank: 1, opening: 35_000_000n },
    },
    openings: [
      [
        { code: "1130", amount: 420_000_000n },
        { code: "1160", amount: 260_000_000n },
        { code: "1210", amount: 1_150_000_000n },
        { code: "1219", amount: -310_000_000n },
        { code: "2110", amount: -240_000_000n },
        { code: "2210", amount: -600_000_000n },
        { code: "3100", amount: -2_000_000_000n },
      ],
      [{ code: "3100", amount: 0n }],
    ],
    lines,
    closedThrough: { year: 2026, month: 7 },
    liveUpload: { bankKey: "own-bri", year: 2026, month: 8 },
  };
}

// =====================================================================================
// 2) CV Sinar Retail — minimarket, QRIS-heavy, single entity
// =====================================================================================
function sinarRetail(): ClientScenario {
  const lines: DemoLine[] = [];
  for (const { year: y, month: m } of DEMO_MONTHS) {
    for (let w = 0; w < 4; w++) {
      const dd = 3 + w * 7;
      lines.push({ bankKey: "bca", date: d(y, m, dd), description: `QRIS SETTLEMENT ${ref()} SINAR RETAIL`, amount: jt(48, 70, 10_000), truth: T("4100") });
    }
    for (let i = 0; i < 3; i++) {
      const dd = day(4 + i * 8, 8 + i * 8);
      lines.push({ bankKey: "bca", date: d(y, m, dd), description: bcaDesc("DB", y, m, dd, "PT DISTRIBUSI SEMBAKO NUSANTARA"), amount: -jt(45, 60), truth: T("5100"), ai: AI("5100", "Pembelian barang dagang", 0.9) });
    }
    lines.push({ bankKey: "bca", date: d(y, m, 1), description: bcaDesc("DB", y, m, 1, "HJ ROSMIATI SEWA RUKO"), amount: -12_500_000n, truth: T("6120"), ai: AI("6120", "Sewa ruko toko", 0.88) });
    lines.push({ bankKey: "bca", date: d(y, m, 25), description: "GAJI KARYAWAN TOKO", amount: -jt(21, 23), truth: T("6100") });
    lines.push({ bankKey: "bca", date: d(y, m, 12), description: "PEMBAYARAN PLN PRABAYAR", amount: -jt(2, 3, 10_000), truth: T("6130") });
    lines.push({ bankKey: "bca", date: d(y, m, 28), description: "BIAYA ADM", amount: -15_000n, truth: T("7100") });
    if (m === 8) {
      lines.push({ bankKey: "bca", date: d(y, m, 20), description: bcaDesc("DB", y, m, 20, "TOKO ELEKTRONIK MAKMUR RAK DISPLAY"), amount: -8_400_000n, truth: T("6160"), open: true, ai: AI("6160", "Perlengkapan toko", 0.74) });
      lines.push({ bankKey: "bca", date: d(y, m, 23), description: bcaDesc("CR", y, m, 23, "PT KOPERASI PEGAWAI PEMDA BELANJA GROSIR"), amount: 14_300_000n, truth: T("4100"), open: true, ai: AI("4100", "Penjualan grosir", 0.83) });
    }
  }
  return {
    key: "sinar",
    spec: {
      name: "CV Sinar Retail",
      industry: "ritel minimarket",
      entities: [{ name: "CV SINAR RETAIL", shortName: "CV Sinar", kind: "CV", banks: [{ bank: "BCA", number: "3440556677", label: "BCA Giro" }] }],
      rules: [{ pattern: "QRIS", direction: "IN", accountCode: "4100", taxTag: null, priority: 50 }],
    },
    banks: { bca: { entity: 0, bank: 0, opening: 145_000_000n } },
    openings: [[{ code: "1160", amount: 95_000_000n }, { code: "3100", amount: -150_000_000n }]],
    lines,
    closedThrough: { year: 2026, month: 7 },
  };
}

// =====================================================================================
// 3) PT Jasa Kreatif Digital — agency, PPN-registered, fully closed through August
// =====================================================================================
function jasaKreatif(): ClientScenario {
  const lines: DemoLine[] = [];
  const clients = ["PT BANK DIGITAL NUSA", "PT KOPI KENANGAN RASA", "PT ASURANSI AMANAH"];
  for (const { year: y, month: m } of DEMO_MONTHS) {
    for (const c of clients.slice(0, 2 + (m % 2))) {
      lines.push({ bankKey: "mdr", date: d(y, m, day(5, 25)), description: `TRANSFER DARI ${c} RETAINER`, amount: jt(55, 90), truth: T("4110", "PPN_KELUARAN"), ai: AI("4110", "Pendapatan jasa agensi", 0.9, "PPN_KELUARAN") });
    }
    lines.push({ bankKey: "mdr", date: d(y, m, 25), description: "PAYROLL TIM KREATIF", amount: -jt(78, 82), truth: T("6100") });
    lines.push({ bankKey: "mdr", date: d(y, m, 3), description: "TRANSFER KE ADOBE SYSTEMS LANGGANAN", amount: -3_900_000n, truth: T("6160"), ai: AI("6160", "Langganan software desain", 0.88) });
    lines.push({ bankKey: "mdr", date: d(y, m, 8), description: `TRANSFER KE HONOR FREELANCE ${ref()}`, amount: -jt(10, 18), truth: T("6170"), ai: AI("6170", "Honor tenaga lepas", 0.85) });
    lines.push({ bankKey: "mdr", date: d(y, m, 1), description: "TRANSFER KE CO-WORKING SPACE SEWA", amount: -9_000_000n, truth: T("6120"), ai: AI("6120", "Sewa ruang kerja", 0.9) });
    lines.push({ bankKey: "mdr", date: d(y, m, 15), description: "SETORAN PPN MASA", amount: -jt(12, 16), truth: T("2130", "PPN_KELUARAN") });
    lines.push({ bankKey: "mdr", date: d(y, m, 28), description: "BIAYA ADM BULANAN", amount: -12_500n, truth: T("7100") });
  }
  return {
    key: "jasa",
    spec: {
      name: "PT Jasa Kreatif Digital",
      industry: "agensi kreatif",
      entities: [{ name: "PT JASA KREATIF DIGITAL", shortName: "PT JKD", kind: "PT", banks: [{ bank: "MANDIRI", number: "1570033221100", label: "Mandiri Giro" }] }],
    },
    banks: { mdr: { entity: 0, bank: 0, opening: 320_000_000n } },
    openings: [[{ code: "1130", amount: 140_000_000n }, { code: "3100", amount: -250_000_000n }]],
    lines,
    closedThrough: { year: 2026, month: 8 },
  };
}

let cached: ClientScenario[] | null = null;
/** Generated once per process; deterministic across runs. */
export function scenarios(): ClientScenario[] {
  cached ??= [grupAyam(), sinarRetail(), jasaKreatif()];
  return cached;
}

/** Statement files per client/bank/month, in chronological order. */
export function statementFiles(sc: ClientScenario): (StatementFile & { bankKey: string })[] {
  const files: (StatementFile & { bankKey: string })[] = [];
  for (const [bankKey, b] of Object.entries(sc.banks)) {
    const ent = sc.spec.entities[b.entity];
    const bank = ent.banks[b.bank];
    let opening = b.opening;
    for (const { year, month } of DEMO_MONTHS) {
      const rows = sc.lines
        .filter((l) => l.bankKey === bankKey && l.date.getUTCFullYear() === year && l.date.getUTCMonth() + 1 === month)
        .sort((a, z) => a.date.getTime() - z.date.getTime())
        .map((l) => ({ date: l.date, description: l.description, amount: l.amount }));
      let running = opening;
      for (const r of rows) {
        running += r.amount;
        if (running < 0n) throw new Error(`Skenario ${sc.key}/${bankKey} ${year}-${month}: saldo negatif — seimbangkan arus kas`);
      }
      files.push({ bankKey, bank: bank.bank as "BCA" | "MANDIRI" | "BRI", accountNumber: bank.number, holder: ent.name, year, month, opening, rows });
      opening = rows.reduce((s, r) => s + r.amount, opening);
    }
  }
  return files;
}

/** Simulated AI answers keyed by merchant key — what the seed's MockProvider replies. */
export function aiTable(sc: ClientScenario) {
  const table: Record<string, AiAnswer> = {};
  for (const l of sc.lines) if (l.ai) table[merchantKey(l.description)] = l.ai;
  return table;
}
