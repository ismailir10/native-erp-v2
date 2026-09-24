import type { Classification, ClassifyInput } from "@/lib/classify/types";
import { ACCOUNT_CODES } from "@/lib/coa/template";

/**
 * Transfer matcher. Pairs opposite amounts within ±2 days across a client's bank accounts,
 * but ONLY when the description carries a transfer hint — equal round amounts alone are
 * too common to trust. Same entity → 1199 clearing; different entity → 1190 intercompany.
 * A hinted line whose counterpart isn't imported still goes to 1199/1190 when the hint
 * names an own entity; the clearing controls then surface the open half.
 */
const TRANSFER_HINT = /TRSF|TRANSFER|PINDAH ?BUKU|PEMINDAHAN|OVERBOOK|SETOR TUNAI|TARIK TUNAI/i;
const DAY = 86_400_000;

export type TransferCandidate = ClassifyInput & { matched?: boolean };

export function matchTransfers(
  items: TransferCandidate[],
  ownNames: { entityId: string; names: string[] }[],
): Map<string, Classification> {
  const result = new Map<string, Classification>();
  const hinted = items.filter((i) => TRANSFER_HINT.test(i.description) || mentionsOwn(i, ownNames));
  const outs = hinted.filter((i) => i.amount < 0n && !i.matched);
  const ins = hinted.filter((i) => i.amount > 0n && !i.matched);
  const usedIns = new Set<string>();

  for (const o of outs) {
    const partner = ins
      .filter((i) => !usedIns.has(i.id) && i.bankAccountId !== o.bankAccountId && i.amount === -o.amount)
      .filter((i) => Math.abs(i.date.getTime() - o.date.getTime()) <= 2 * DAY)
      .sort((a, b) => Math.abs(a.date.getTime() - o.date.getTime()) - Math.abs(b.date.getTime() - o.date.getTime()))[0];
    if (!partner) continue;
    usedIns.add(partner.id);
    const same = partner.entityId === o.entityId;
    const code = same ? ACCOUNT_CODES.CLEARING : ACCOUNT_CODES.INTERCOMPANY;
    const reason = same ? "Transfer antar rekening sendiri (pasangan ditemukan)" : "Transfer antar entitas grup (pasangan ditemukan)";
    result.set(o.id, { method: "TRANSFER", accountCode: code, taxTag: null, confidence: 0.99, reason, matchedTxId: partner.id });
    result.set(partner.id, { method: "TRANSFER", accountCode: code, taxTag: null, confidence: 0.99, reason, matchedTxId: o.id });
  }

  // Unpaired but hinted: names another group entity → 1190; names its own entity → 1199.
  // Either way the counterpart is pending import; the clearing/intercompany controls track it.
  for (const i of hinted) {
    if (result.has(i.id) || i.matched || !TRANSFER_HINT.test(i.description)) continue;
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
