import { createHash } from "node:crypto";
import type { Db, Tx } from "@/lib/db";
import type { AccountType, MapMethod } from "@/lib/generated/prisma/enums";
import { AI_BATCH_SIZE, aiConfig, type AiProvider, type MapItem } from "@/lib/ai/provider";
import { ACCOUNT_CODES, FS_LINES, type FsLine } from "@/lib/coa/template";

/**
 * Source account → client account mapping (accounting-rules §9a, §17).
 * Order: prior mapping → exact name → keyword rules → AI (names only, cached, capped) → none.
 * Suggestions are stored on SourceAccount.suggested*; only `acceptMappings()` (an explicit click) sets accountId.
 */

export type Suggestion = { accountCode: string; method: MapMethod; confidence: number; reason: string };
type ClientAccount = { code: string; name: string; type: AccountType; fsLine: string; isBank: boolean; isSuspense: boolean; isClearing: boolean };

export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Type hint from the name first (codes don't agree across charts: HoldCo 41000 is an expense), then the leading digit.
 * Order matters: "Loan to Subsidiary" is an asset, "Long Term Non-Bank" a liability, "Capital Placement" an investment.
 */
export function inferType(code: string, name: string): AccountType | null {
  const n = normName(name);
  if (/(expense|beban|biaya|cost of|cogs|hpp|harga pokok|\bloss\b|manfaat pajak)/.test(n) && !/(prepaid|dibayar di ?muka|accrued|accured|payable|utang|hutang)/.test(n)) return "BEBAN";
  if (/(revenue|income|pendapatan|penjualan|\bsales\b|\bgain\b)/.test(n) && !/(payable|receivable|tax payable|diterima di muka|unearned|deferred)/.test(n)) return "PENDAPATAN";
  if (/(akumulasi|accumulat|allowance|penyisihan)/.test(n)) return "ASET";
  if (/(receivable|piutang|loan to|placement|penempatan|investment|investasi|tax asset|dibayar di ?muka|prepaid|advance|uang muka)/.test(n)) return "ASET";
  if (/(payable|\butang\b|\bhutang\b|accrued|accured|masih harus|liabilit|kewajiban|long term|jangka panjang|non ?bank|\bloan\b|pinjaman|diterima di muka|unearned)/.test(n)) return "LIABILITAS";
  if (/(capital|modal|saham|shares?|agio|premium|retained|laba ditahan|saldo laba|earnings|dividen|prive)/.test(n)) return "EKUITAS";
  if (/(\bkas\b|\bcash\b|\bbank\b|inventory|persediaan|goods|asset|aset|equipment|peralatan|deposit|guarantee|jaminan)/.test(n)) return "ASET";
  const d = code.replace(/^[A-Za-z]+-/, "").match(/\d/)?.[0];
  return d === "1" ? "ASET" : d === "2" ? "LIABILITAS" : d === "3" ? "EKUITAS" : d === "4" ? "PENDAPATAN" : d === "5" || d === "6" ? "BEBAN" : null;
}

/** Keyword rules → template codes. First match wins; `type` guards against e.g. "interest income" hitting a bank rule. */
const KEYWORDS: { re: RegExp; code: string; types?: AccountType[]; not?: RegExp }[] = [
  { re: /(akumulasi|accumulated|accumulation).*(penyusutan|depreciation|amortization|amortisasi)/, code: "1219" },
  { re: /(penyusutan|depreciation|amortisasi|amortization)/, code: "6180", types: ["BEBAN"] },
  { re: /(rounding|pembulatan)/, code: ACCOUNT_CODES.ROUNDING },
  { re: /(selisih kurs|foreign exchange|exchange (gain|loss)|forex|\bfx\b|revaluation|revaluasi)/, code: ACCOUNT_CODES.FX_GAIN_LOSS },
  { re: /(pajak tangguhan|deferred tax)/, code: "1260", types: ["ASET"] },
  { re: /(pajak tangguhan|deferred tax)/, code: "2300", types: ["LIABILITAS"] },
  { re: /(pajak tangguhan|deferred tax)/, code: "8100", types: ["BEBAN"] },
  { re: /(tax.*interest|pajak bunga|interest tax)/, code: "8200", types: ["BEBAN"] },
  { re: /(interest income|pendapatan bunga|jasa giro|bank interest|bunga bank|bunga tabungan|revenue interest|interest revenue)/, code: "4900", types: ["PENDAPATAN"] },
  { re: /(interest expense|beban bunga|bunga pinjaman|interest p2p)/, code: "7110", types: ["BEBAN"] },
  { re: /(bank charge|admin(istrasi)? bank|biaya bank|bank administration|bank admin|provisi|biaya transfer)/, code: "7100", types: ["BEBAN"] },
  { re: /(petty cash|kas kecil|cash in transit|\bkas\b|cash on hand)/, code: "1110", types: ["ASET"], not: /bank/ },
  { re: /\b(bank|giro|tabungan|deposito|time deposits?|call a ?c|ocbc|bca|bri|bni|mandiri|cimb|dbs|uob|citibank|permata|doku|flip|xendit|midtrans)\b/, code: "1120", types: ["ASET"], not: /(non ?bank|payable|utang|hutang|loan|pinjaman)/ },
  { re: /(allowance|penyisihan|cadangan kerugian|\becl\b)/, code: "1130", types: ["ASET"] },
  { re: /(ppn masukan|vat[- ]?in\b|input vat)/, code: "1150", types: ["ASET"] },
  { re: /(prepaid tax|pajak dibayar di ?muka|uang muka pajak|pph .*dibayar di ?muka|tax receivable)/, code: "1180", types: ["ASET"] },
  { re: /(trade receivable|piutang usaha|accounts? receivable)/, code: "1130", types: ["ASET"] },
  { re: /(persediaan|inventory|supplies|perlengkapan|finished goods|barang jadi|raw material)/, code: "1160", types: ["ASET"] },
  { re: /(prepaid|dibayar di ?muka|uang muka|advance|deposit|jaminan|guarantee)/, code: "1170", types: ["ASET"] },
  { re: /(piutang|receivable|loan to)/, code: "1140", types: ["ASET"] },
  { re: /(intangible|tak berwujud|software|right of use|hak guna|goodwill)/, code: "1250", types: ["ASET"] },
  { re: /(investment|investasi|penyertaan|placement|penempatan)/, code: "1260", types: ["ASET"] },
  { re: /(fixed asset|asset in progress|aset dalam penyelesaian|construction in progress|aset tetap|equipment|peralatan|kendaraan|vehicle|building|bangunan|renovation|renovasi|furniture|machine|mesin|\bland\b|tanah|inventaris|\bppe\b|\biot\b)/, code: "1210", types: ["ASET"] },
  { re: /(ppn keluaran|vat[- ]?out\b|output vat)/, code: "2130", types: ["LIABILITAS"] },
  { re: /(pph ?21|article 21|pasal 21)/, code: "2140", types: ["LIABILITAS"] },
  { re: /(pph ?23|article 23|pasal 23)/, code: "2141", types: ["LIABILITAS"] },
  { re: /(tax payable|utang pajak|hutang pajak|article 4|article 25|article 29|pasal 4|pasal 25|pasal 29|\bpph\b)/, code: "2145", types: ["LIABILITAS"] },
  { re: /(imbalan kerja|employee benefit|post.?employment|pesangon)/, code: "2310", types: ["LIABILITAS"] },
  { re: /(accrued|accured|masih harus dibayar|accrual)/, code: "2150", types: ["LIABILITAS"] },
  { re: /(unearned|diterima di muka|deferred revenue|customer deposit|uang muka pelanggan)/, code: "2160", types: ["LIABILITAS"] },
  { re: /(bank loan|utang bank|hutang bank|pinjaman bank|short term bank|kredit modal|credit card|kartu kredit|\bcc\b)/, code: "2210", types: ["LIABILITAS"] },
  { re: /(short ?term|jangka pendek)/, code: "2120", types: ["LIABILITAS"] },
  { re: /(long ?term|jangka panjang|non ?bank|lease|sewa pembiayaan|loan payable|\bloan\b|pinjaman)/, code: "2300", types: ["LIABILITAS"] },
  { re: /(trade payable|utang usaha|hutang usaha|accounts? payable)/, code: "2110", types: ["LIABILITAS"] },
  { re: /(payable|\butang\b|\bhutang\b|current liabilit|kewajiban lancar)/, code: "2120", types: ["LIABILITAS"] },
  { re: /(additional paid|agio|premium|tambahan modal|\bapic\b)/, code: "3110", types: ["EKUITAS"] },
  { re: /(share capital|modal saham|modal disetor|ordinary shares?|pref+er+ed shares?|paid ?up|capital stock)/, code: "3100", types: ["EKUITAS"] },
  { re: /(retained|saldo laba|laba ditahan|accumulated (loss|deficit)|earnings|laba tahun berjalan)/, code: ACCOUNT_CODES.RETAINED, types: ["EKUITAS"] },
  { re: /(prive|dividen|dividend|drawing)/, code: "3300", types: ["EKUITAS"] },
  { re: /(income tax expense|beban pajak|pph badan|tax expense|corporate tax)/, code: "8100", types: ["BEBAN"], not: /final/ },
  { re: /(final tax|pph final|4\(2\))/, code: "8200", types: ["BEBAN"] },
  { re: /(other income|pendapatan lain|other revenue|\bgain\b|miscellaneous income)/, code: "4910", types: ["PENDAPATAN"] },
  { re: /(sales|penjualan)/, code: "4100", types: ["PENDAPATAN"] },
  { re: /(revenue|pendapatan|service income|fee income|income)/, code: "4110", types: ["PENDAPATAN"] },
  { re: /(purchase|pembelian|material|bahan baku|raw material)/, code: "5100", types: ["BEBAN"] },
  { re: /(cost of|hpp|harga pokok|beban pokok)/, code: "5110", types: ["BEBAN"] },
  { re: /(salary|salaries|gaji|wages|upah|tunjangan|\bthr\b|bonus|payroll|intern)/, code: "6100", types: ["BEBAN"] },
  { re: /(bpjs|insurance|asuransi|medication|kesehatan|medical)/, code: "6110", types: ["BEBAN"] },
  { re: /(\brent\b|\bsewa\b|lease expense)/, code: "6120", types: ["BEBAN"] },
  { re: /(electric|listrik|water|pdam|internet|telepon|telecommunication|telephone|utilit)/, code: "6130", types: ["BEBAN"] },
  { re: /(travel|transport|perjalanan|bensin|fuel|logistic|pengiriman|delivery|parkir|toll|freight)/, code: "6140", types: ["BEBAN"] },
  { re: /(marketing|advertis|iklan|promosi|promotion|\bads\b|sponsor)/, code: "6150", types: ["BEBAN"] },
  { re: /(office|kantor|stationer|stationary|\batk\b|printing|alat tulis)/, code: "6160", types: ["BEBAN"] },
  { re: /(professional|legal|audit|consultant|konsultan|notaris|jasa profesional|\bagent\b)/, code: "6170", types: ["BEBAN"] },
  { re: /(expense|beban|biaya)/, code: "6190", types: ["BEBAN"] },
];

export function deterministicSuggestion(
  src: { code: string; name: string; typeHint: AccountType | null },
  ctx: { accounts: ClientAccount[]; priorByName: Map<string, string> },
): Suggestion | null {
  const n = normName(src.name);
  const prior = ctx.priorByName.get(n);
  if (prior) return { accountCode: prior, method: "PRIOR", confidence: 0.95, reason: "Nama akun sama sudah dipetakan sebelumnya" };
  const exact = ctx.accounts.find((a) => !a.isBank && !a.isSuspense && !a.isClearing && normName(a.name) === n);
  if (exact) return { accountCode: exact.code, method: "NAME", confidence: 0.95, reason: `Nama sama dengan ${exact.code} ${exact.name}` };
  const type = src.typeHint ?? inferType(src.code, src.name);
  for (const k of KEYWORDS) {
    if (!k.re.test(n)) continue;
    if (k.not?.test(n)) continue;
    if (k.types && type && !k.types.includes(type)) continue;
    const acc = ctx.accounts.find((a) => a.code === k.code);
    if (!acc) continue;
    return { accountCode: acc.code, method: "KEYWORD", confidence: 0.8, reason: `Kata kunci "${n.match(k.re)?.[0]}" → ${acc.code} ${acc.name}` };
  }
  return null;
}

export function aiMapCacheKey(name: string, typeHint: string | null, coaVersion: number) {
  return createHash("sha1").update(`map|${normName(name)}|${typeHint ?? "-"}|v${coaVersion}`).digest("hex").slice(0, 32);
}

const TYPE_LABEL: Record<AccountType, string> = { ASET: "Aset", LIABILITAS: "Liabilitas", EKUITAS: "Ekuitas", PENDAPATAN: "Pendapatan", BEBAN: "Beban" };

/** Accounts a source account may map to: the client chart minus bank GL (tied to statements), suspense and clearing. */
async function mappableAccounts(db: Db | Tx, clientId: string): Promise<ClientAccount[]> {
  const all = await db.account.findMany({ where: { clientId }, orderBy: { code: "asc" } });
  return all.filter((a) => !a.isBank && !a.isSuspense && !a.isClearing);
}

/**
 * Fill `suggested*` on every unmapped source account of the client: deterministic first, then AI for the rest.
 * AI runs outside any transaction, one request per ≤40 accounts, capped by AI_MAX_CALLS_PER_IMPORT and the monthly budget.
 */
export async function suggestMappings(db: Db, args: { firmId: string; clientId: string; provider: AiProvider | null; useAi: boolean }) {
  const client = await db.client.findUniqueOrThrow({ where: { id: args.clientId } });
  const accounts = await mappableAccounts(db, args.clientId);
  const sources = await db.sourceAccount.findMany({ where: { clientId: args.clientId }, orderBy: [{ entityId: "asc" }, { code: "asc" }] });
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const codeOfId = new Map((await db.account.findMany({ where: { clientId: args.clientId }, select: { id: true, code: true } })).map((a) => [a.id, a.code]));
  const priorByName = new Map<string, string>();
  for (const s of sources) if (s.accountId) priorByName.set(normName(s.name), codeOfId.get(s.accountId)!);

  const pending = sources.filter((s) => !s.accountId);
  let deterministic = 0;
  const leftovers: typeof pending = [];
  for (const s of pending) {
    const sug = deterministicSuggestion({ code: s.code, name: s.name, typeHint: s.typeHint }, { accounts, priorByName });
    if (sug) {
      deterministic++;
      await db.sourceAccount.update({ where: { id: s.id }, data: { suggestedCode: sug.accountCode, suggestedBy: sug.method, mapConfidence: sug.confidence, mapReason: sug.reason } });
    } else if (s.suggestedBy !== "AI") leftovers.push(s);
  }

  let calls = 0;
  let cacheHits = 0;
  let aiAnswered = 0;
  let note: string | undefined;
  if (args.useAi && leftovers.length) {
    const keyOf = (s: (typeof leftovers)[number]) => aiMapCacheKey(s.name, s.typeHint ?? inferType(s.code, s.name), client.coaVersion);
    const cached = new Map((await db.aiAccountMap.findMany({ where: { cacheKey: { in: leftovers.map(keyOf) } } })).map((c) => [c.cacheKey, c]));
    const misses: typeof leftovers = [];
    for (const s of leftovers) {
      const hit = cached.get(keyOf(s));
      if (hit && byCode.has(hit.accountCode)) {
        cacheHits++;
        await db.sourceAccount.update({ where: { id: s.id }, data: { suggestedCode: hit.accountCode, suggestedBy: "AI", mapConfidence: hit.confidence, mapReason: `AI: ${hit.reason}` } });
      } else misses.push(s);
    }
    // One question per unique (name, type) — the same name in five entities is paid once.
    const unique = new Map<string, (typeof misses)[number]>();
    for (const s of misses) if (!unique.has(keyOf(s))) unique.set(keyOf(s), s);
    const queue = [...unique.values()];
    if (queue.length && !args.provider) note = "AI tidak aktif: isi kunci di Pengaturan, atau petakan manual.";
    else if (queue.length) {
      const cfg = aiConfig();
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
      const used = await db.aiUsage.aggregate({ where: { firmId: args.firmId, at: { gte: monthStart } }, _sum: { promptTokens: true, completionTokens: true } });
      if ((used._sum.promptTokens ?? 0) + (used._sum.completionTokens ?? 0) >= cfg.monthlyTokenBudget) note = "Kuota token AI bulan ini habis";
      const chart = accounts.map((a) => ({ code: a.code, name: a.name, group: `${TYPE_LABEL[a.type]} · ${FS_LINES[a.fsLine as FsLine]?.label ?? a.fsLine}` }));
      for (let i = 0; !note && i < queue.length && calls < cfg.maxCallsPerImport; i += AI_BATCH_SIZE) {
        const batch = queue.slice(i, i + AI_BATCH_SIZE);
        const items: MapItem[] = batch.map((s, j) => ({ key: `a${j}`, code: s.code, name: s.name, typeHint: s.typeHint ?? inferType(s.code, s.name) }));
        calls++;
        try {
          const res = await args.provider!.mapAccounts(items, chart, `${client.name}${client.industry ? ` (${client.industry})` : ""}`);
          await db.aiUsage.create({ data: { firmId: args.firmId, model: res.model, keysRequested: items.length, cacheHits, calls: 1, promptTokens: res.promptTokens, completionTokens: res.completionTokens, ok: true, note: "pemetaan akun" } });
          for (const a of res.answers) {
            const item = items.find((x) => x.key === a.key);
            // Rule 19: whatever the provider returns, only codes in the client chart survive.
            if (!item || !byCode.has(a.accountCode)) continue;
            const src = batch[items.indexOf(item)];
            const key = keyOf(src);
            await db.aiAccountMap.upsert({
              where: { cacheKey: key },
              create: { cacheKey: key, name: src.name, typeHint: item.typeHint, accountCode: a.accountCode, confidence: a.confidence, reason: a.reason, model: res.model },
              update: {},
            });
            const same = misses.filter((m) => keyOf(m) === key);
            await db.sourceAccount.updateMany({ where: { id: { in: same.map((m) => m.id) } }, data: { suggestedCode: a.accountCode, suggestedBy: "AI", mapConfidence: a.confidence, mapReason: `AI: ${a.reason}` } });
            aiAnswered += same.length;
          }
        } catch (e) {
          note = `AI gagal: ${(e as Error).message.slice(0, 120)}`;
          await db.aiUsage.create({ data: { firmId: args.firmId, model: args.provider!.model, keysRequested: items.length, cacheHits, calls: 1, promptTokens: 0, completionTokens: 0, ok: false, note } });
        }
      }
      if (!note && queue.length > calls * AI_BATCH_SIZE) note = "Batas panggilan AI per permintaan tercapai. Klik lagi untuk melanjutkan.";
    }
  }
  return { pending: pending.length, deterministic, cacheHits, aiAnswered, calls, note };
}

export class MappingError extends Error {}

/**
 * The accountant's explicit accept (rule 9a). `items` = source account id → client account code, or
 * `{ newAccount: { fsLine, name } }` to create a client account under an FS line (never a special code).
 */
export async function acceptMappings(
  db: Db,
  clientId: string,
  items: { sourceAccountId: string; accountCode?: string; newAccount?: { fsLine: FsLine; name: string }; method: MapMethod }[],
) {
  return db.$transaction(async (tx) => {
    const sources = await tx.sourceAccount.findMany({ where: { id: { in: items.map((i) => i.sourceAccountId) }, clientId } });
    if (sources.length !== new Set(items.map((i) => i.sourceAccountId)).size) throw new MappingError("Akun sumber tidak ditemukan untuk klien ini");
    let created = 0;
    for (const it of items) {
      let code = it.accountCode;
      if (it.newAccount) {
        code = await createClientAccount(tx, clientId, it.newAccount.fsLine, it.newAccount.name);
        created++;
      }
      const acc = code ? await tx.account.findFirst({ where: { clientId, code } }) : null;
      if (!acc || acc.isBank || acc.isSuspense || acc.isClearing) throw new MappingError(`Akun ${code ?? "(kosong)"} tidak bisa dipakai untuk pemetaan`);
      await tx.sourceAccount.update({ where: { id: it.sourceAccountId }, data: { accountId: acc.id, mappedBy: it.newAccount ? "NEW" : it.method } });
    }
    return { mapped: items.length, created };
  });
}

/** Code ranges per FS line for "Buat akun baru". Special codes are skipped. */
const RANGES: Partial<Record<FsLine, [number, number]>> = {
  KAS_SETARA_KAS: [1111, 1129],
  PIUTANG_USAHA: [1131, 1139],
  PIUTANG_LAIN: [1141, 1149],
  PERSEDIAAN: [1161, 1169],
  PAJAK_DIBAYAR_DIMUKA: [1181, 1189],
  BIAYA_DIBAYAR_DIMUKA: [1171, 1179],
  ASET_TETAP: [1211, 1218],
  AKUM_PENYUSUTAN: [1220, 1229],
  ASET_TIDAK_LANCAR_LAIN: [1251, 1299],
  UTANG_USAHA: [2111, 2119],
  UTANG_PAJAK: [2146, 2149],
  UTANG_LAIN: [2121, 2129],
  UTANG_BANK: [2211, 2219],
  UTANG_JANGKA_PANJANG: [2301, 2399],
  MODAL: [3101, 3199],
  SALDO_LABA: [3201, 3299],
  PENDAPATAN_USAHA: [4101, 4199],
  PENDAPATAN_LAIN: [4911, 4999],
  HPP: [5101, 5999],
  BEBAN_PENJUALAN: [6141, 6159],
  BEBAN_UMUM_ADM: [6191, 6999],
  BEBAN_LAIN: [7101, 7189],
  BEBAN_PAJAK: [8101, 8199],
};
const SPECIAL = new Set(["1190", "1199", "1999", "3200", "3900", "7190", "7200", ...Array.from({ length: 9 }, (_, i) => `110${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `220${i + 1}`)]);
const SECTION_TYPE: Record<string, AccountType> = { ASET_LANCAR: "ASET", ASET_TIDAK_LANCAR: "ASET", LIABILITAS: "LIABILITAS", EKUITAS: "EKUITAS" };

export async function createClientAccount(tx: Tx, clientId: string, fsLine: FsLine, name: string): Promise<string> {
  const range = RANGES[fsLine];
  if (!range) throw new MappingError(`Akun baru tidak bisa dibuat di ${FS_LINES[fsLine]?.label ?? fsLine}`);
  const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
  const used = new Set((await tx.account.findMany({ where: { clientId }, select: { code: true } })).map((a) => a.code));
  let code: string | null = null;
  for (let c = range[0]; c <= range[1]; c++) if (!used.has(String(c)) && !SPECIAL.has(String(c))) (code ??= String(c));
  if (!code) throw new MappingError(`Rentang kode ${range[0]}–${range[1]} sudah penuh`);
  const section = FS_LINES[fsLine].section;
  const type: AccountType =
    SECTION_TYPE[section] ?? (fsLine === "PENDAPATAN_USAHA" || fsLine === "PENDAPATAN_LAIN" ? "PENDAPATAN" : "BEBAN");
  const normalBalance = type === "ASET" || type === "BEBAN" ? (fsLine === "AKUM_PENYUSUTAN" ? "CREDIT" : "DEBIT") : "CREDIT";
  await tx.account.create({ data: { firmId: client.firmId, clientId, code, name: name.slice(0, 80), type, normalBalance, fsLine } });
  // The chart changed, so cached AI answers keyed on the old chart no longer apply.
  await tx.client.update({ where: { id: clientId }, data: { coaVersion: { increment: 1 } } });
  return code;
}
