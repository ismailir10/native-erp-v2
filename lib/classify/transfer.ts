import type { Classification, ClassifyInput } from "@/lib/classify/types";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { isGenericKey, merchantKey } from "@/lib/import/normalize";
import { formatDate } from "@/lib/format";
import { formatRupiah } from "@/lib/money";

/**
 * Transfer matcher (accounting-rules 13). Pairs opposite amounts within 2 business days across a client's bank accounts, and only when
 * it is safe to (use-case feedback UC-B2, where a supplier withdrawal netted against a stranger's credit of the same amount):
 * - the description carries a transfer hint or names an own entity — equal amounts alone are too common to trust;
 * - neither description names anyone besides the group's own entities (a supplier, a customer): such a line is a payment, not a transfer;
 * - exactly one candidate on each side. Several candidates are never resolved by picking the nearest date: every line involved goes to
 *   Review with the transfer account suggested and the candidates named.
 * Same entity → 1199 clearing; different entity → 1190 intercompany. A hinted line whose counterpart isn't imported still goes to
 * 1199/1190 when it names an own entity (and nobody else); the clearing controls then surface the open half.
 */
const TRANSFER_HINT = /TRSF|\bTRF\b|TRANSFER|PINDAH ?BUKU|PEMINDAHAN|OVERBOOK|SETOR TUNAI|TARIK TUNAI/i;
const DAY = 86_400_000;
/** A Friday transfer that lands on Tuesday (weekend, SKN clearing) is still the same transfer. */
export const MATCH_BUSINESS_DAYS = 2;
/** Below the auto-post threshold: a transfer suggestion that waits for the reviewer. */
const AMBIGUOUS_CONFIDENCE = 0.8;

/** Banks and their products: naming the other account's bank names no counterparty. */
const BANK_WORDS = new Set(
  "BANK BCA MANDIRI MDR BRI BNI BSI CIMB NIAGA SMBC BTN PERMATA DANAMON OCBC MAYBANK PANIN MEGA JAGO SEABANK JENIUS BTPN UOB HSBC DBS GIRO TABUNGAN TAHAPAN SIMPEDES BRITAMA XPRESI".split(" "),
);
/** Words that describe moving the group's own money, not who it went to. A word missing here only sends an own transfer to Review. */
const OWN_TRANSFER_WORDS = new Set("PEMILIK OWNER SENDIRI ANTAR REKENING REK SWEEP INTERNAL MODAL KEMBALI PENGEMBALIAN TALANGAN OPERASIONAL".split(" "));

/**
 * The counterparty a description names besides the group's own entities, or null when it names none. What is left after taking out
 * references, channel words, bank names, own-transfer words and the own entities' names is a name.
 */
export function thirdPartyName(description: string, ownNames: string[]): string | null {
  let s = ` ${merchantKey(description)} `;
  for (const n of [...ownNames].map((x) => merchantKey(x)).filter((x) => x.length >= 3).sort((a, b) => b.length - a.length)) s = s.split(` ${n} `).join(" ");
  const rest = s.split(/\s+/).filter((w) => /^[A-Z]{2,}$/.test(w) && !BANK_WORDS.has(w) && !OWN_TRANSFER_WORDS.has(w));
  return rest.length && !isGenericKey(rest.join(" ")) ? rest.join(" ") : null;
}

/** Weekdays after the earlier date up to and including the later one (Saturday and Sunday don't count; no holiday calendar). */
export function businessDaysApart(a: Date, b: Date): number {
  const [from, to] = +a <= +b ? [a, b] : [b, a];
  let n = 0;
  for (let t = +from + DAY; t <= +to; t += DAY) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) n++;
  }
  return n;
}

/** `matched`: already half of a pair. `pairRefused`: the reviewer took it out of a pair (*Lepas pasangan*); never paired again. */
export type TransferCandidate = ClassifyInput & { matched?: boolean; pairRefused?: boolean };

export function matchTransfers(
  items: TransferCandidate[],
  ownNames: { entityId: string; names: string[] }[],
): Map<string, Classification> {
  const result = new Map<string, Classification>();
  const allNames = ownNames.flatMap((e) => e.names);
  const clean = (i: TransferCandidate) => !thirdPartyName(i.description, allNames);
  const hinted = items.filter((i) => !i.matched && !i.pairRefused && (TRANSFER_HINT.test(i.description) || mentionsOwn(i, ownNames)) && clean(i));
  const outs = hinted.filter((i) => i.amount < 0n);
  const ins = hinted.filter((i) => i.amount > 0n);
  const fits = (o: TransferCandidate, i: TransferCandidate) => i.bankAccountId !== o.bankAccountId && i.amount === -o.amount && businessDaysApart(i.date, o.date) <= MATCH_BUSINESS_DAYS;
  const candidatesOf = new Map(outs.map((o) => [o.id, ins.filter((i) => fits(o, i))]));
  const outsFor = (i: TransferCandidate) => outs.filter((o) => candidatesOf.get(o.id)!.includes(i));
  const codeFor = (a: TransferCandidate, b: TransferCandidate) => (a.entityId === b.entityId ? ACCOUNT_CODES.CLEARING : ACCOUNT_CODES.INTERCOMPANY);

  for (const o of outs) {
    const cands = candidatesOf.get(o.id)!;
    if (!cands.length) continue;
    const rivals = outsFor(cands[0]);
    if (cands.length === 1 && rivals.length === 1) {
      const partner = cands[0];
      const same = partner.entityId === o.entityId;
      const reason = same ? "Transfer antar rekening sendiri (pasangan ditemukan)" : "Transfer antar entitas grup (pasangan ditemukan)";
      const c = { method: "TRANSFER" as const, accountCode: codeFor(o, partner), taxTag: null, confidence: 0.99, reason };
      result.set(o.id, { ...c, matchedTxId: partner.id });
      result.set(partner.id, { ...c, matchedTxId: o.id });
      continue;
    }
    // Several lines could be the other half: none is chosen. Each one involved waits in Review with the candidates named.
    const group = new Set([o, ...cands, ...cands.flatMap(outsFor)]);
    for (const x of group) {
      if (result.has(x.id)) continue;
      const others = [...group].filter((y) => Math.sign(Number(y.amount)) !== Math.sign(Number(x.amount)));
      const named = others.map((y) => `${formatDate(y.date)} ${formatRupiah(y.amount < 0n ? -y.amount : y.amount)}`).join("; ");
      result.set(x.id, {
        method: "TRANSFER",
        accountCode: codeFor(x, others[0]),
        taxTag: null,
        confidence: AMBIGUOUS_CONFIDENCE,
        reason: `${others.length} kandidat pasangan transfer dengan nominal sama (${named}): tidak dipasangkan otomatis, pilih akunnya di Review`,
      });
    }
  }

  // Unpaired but hinted: names another group entity → 1190; names its own entity → 1199.
  // Either way the counterpart is pending import; the clearing/intercompany controls track it.
  for (const i of hinted) {
    if (result.has(i.id) || !TRANSFER_HINT.test(i.description)) continue;
    const d = i.description.toUpperCase();
    const other = ownNames.find((e) => e.entityId !== i.entityId && e.names.some((n) => d.includes(n)));
    const self = ownNames.find((e) => e.entityId === i.entityId && e.names.some((n) => d.includes(n)));
    if (other) {
      result.set(i.id, { method: "TRANSFER", accountCode: ACCOUNT_CODES.INTERCOMPANY, taxTag: null, confidence: 0.92, reason: "Transfer ke/dari entitas grup (pasangan belum diimpor)" });
    } else if (self) {
      result.set(i.id, { method: "TRANSFER", accountCode: ACCOUNT_CODES.CLEARING, taxTag: null, confidence: 0.92, reason: "Transfer antar rekening sendiri (pasangan belum diimpor)" });
    }
  }
  return result;
}

function mentionsOwn(i: ClassifyInput, ownNames: { entityId: string; names: string[] }[]) {
  const d = i.description.toUpperCase();
  return ownNames.some((e) => e.names.some((n) => d.includes(n)));
}
