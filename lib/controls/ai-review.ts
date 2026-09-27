import { createHash } from "node:crypto";
import type { Db } from "@/lib/db";
import { runControls, type Control } from "@/lib/controls";
import { flaggedBankRows } from "@/lib/controls/sanity";
import { periodBounds, formatPeriod } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { runBudgetedAi } from "@/lib/ai/budget";
import { AiAnswerError, CLOSE_REVIEW_MAX_ROWS, CLOSE_REVIEW_MAX_TOKENS, CLOSE_REVIEW_PROMPT_VERSION, buildCloseReviewPrompt, parseCloseReview, type AiProvider, type CloseReviewControl, type CloseReviewInput, type CloseReviewItem, type CloseReviewRow } from "@/lib/ai/provider";

/**
 * AI close review (ADR 0009). Deterministic controls decide; AI only explains flagged ones and proposes an action,
 * citing the row ids it was given. It never posts, acks, ticks or locks.
 */

/** Per client-month: room for a few reviews as the accountant fixes things (reservations are conservative). */
export const CLOSE_REVIEW_TOKEN_LIMIT = 40_000;
const ROWS_PER_CONTROL = 10;
const DESCRIPTION = 80;

export type ReviewLink = { id: string; label: string; href: string };
export type CloseReviewView = {
  items: (CloseReviewItem & { title: string; scope: string; status: "REVIEW" | "FAIL"; links: ReviewLink[] })[];
  flagged: number;
};

type Gathered = { input: CloseReviewInput; links: Map<string, ReviewLink>; flagged: Control[] };

async function gather(db: Db, clientId: string, year: number, month: number, controls?: Control[]): Promise<Gathered> {
  const { start, end } = periodBounds(year, month);
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { entities: true } });
  const base = `/clients/${clientId}`;
  const pk = `${year}-${String(month).padStart(2, "0")}`;
  const flagged = (controls ?? (await runControls(db, clientId, year, month))).filter((c) => c.status !== "PASS");
  const entityOf = (key: string) => client.entities.find((e) => e.id === key.split(":")[1]);
  const links = new Map<string, ReviewLink>();
  let budget = CLOSE_REVIEW_MAX_ROWS;
  const take = <T,>(rows: T[]) => {
    const n = Math.max(0, Math.min(ROWS_PER_CONTROL, budget, rows.length));
    budget -= n;
    return rows.slice(0, n);
  };
  const bankRow = (t: { id: string; date: Date; description: string; amount: bigint; accountCode: string | null; suggestedCode: string | null; method: string; confidence: number }, currency: string, entityId: string): CloseReviewRow => {
    const code = t.accountCode ?? t.suggestedCode ?? "1999";
    links.set(t.id, { id: t.id, label: `${t.date.toISOString().slice(0, 10)} ${t.description.slice(0, 40)}`, href: `${base}/ledger/${code}?period=${pk}&entity=${entityId}` });
    return { id: t.id, date: t.date.toISOString().slice(0, 10), text: t.description.slice(0, DESCRIPTION), amount: formatMoney(t.amount, currency), account: code, how: `${t.method} ${t.confidence.toFixed(2)}` };
  };
  const bySize = <T extends { amount: bigint }>(rows: T[]) => [...rows].sort((a, b) => (abs(b.amount) > abs(a.amount) ? 1 : abs(b.amount) < abs(a.amount) ? -1 : 0));

  const reviewed: CloseReviewControl[] = [];
  for (const c of flagged) {
    const kind = c.key.split(":")[0];
    const e = entityOf(c.key);
    let rows: CloseReviewRow[] = [];
    if (e && (kind === "pl-financing" || kind === "guess")) {
      const f = await flaggedBankRows(db, clientId, e.id, start, end);
      rows = take(bySize(kind === "guess" ? f.guesses : f.financing)).map((t) => bankRow(t, e.functionalCurrency, e.id));
    } else if (e && (kind === "nature" || kind === "nature-total")) {
      // The bank lines that fed the suspicious balance-sheet accounts this month.
      const codes = (await db.account.findMany({ where: { clientId, type: { in: ["ASET", "LIABILITAS"] }, isBank: false, isSuspense: false, isClearing: false, isIntercompany: false }, select: { code: true } })).map((a) => a.code);
      const txs = await db.bankTransaction.findMany({ where: { entityId: e.id, date: { gte: start, lte: end }, accountCode: { in: codes } } });
      rows = take(bySize(txs)).map((t) => bankRow(t, e.functionalCurrency, e.id));
    } else if (kind === "suspense") {
      const txs = await db.bankTransaction.findMany({ where: { bankAccount: { entity: { clientId } }, status: "NEEDS_REVIEW", date: { lte: end } }, include: { bankAccount: { include: { entity: true } } } });
      rows = take(bySize(txs)).map((t) => bankRow(t, t.bankAccount.entity.functionalCurrency, t.entityId));
    } else if (kind === "ledger") {
      const importId = c.key.split(":")[1];
      const checks = await db.importCheck.findMany({ where: { ledgerImportId: importId, severity: { in: ["BLOCK", "REVIEW"] }, OR: [{ date: null }, { date: { gte: start, lte: end } }] }, orderBy: { id: "asc" } });
      rows = take(checks).map((k) => {
        links.set(k.id, { id: k.id, label: k.message.slice(0, 60), href: `${base}/import/ledger/${importId}` });
        const currency = client.entities.find((x) => x.id === k.entityId)?.functionalCurrency ?? "IDR";
        return { id: k.id, date: k.date?.toISOString().slice(0, 10) ?? "", text: k.message.slice(0, 160), amount: k.amount === null ? "" : formatMoney(k.amount, currency), account: k.code, how: `${k.severity}${k.accepted ? " diterima" : ""}` };
      });
    }
    reviewed.push({ key: c.key, title: c.title, scope: c.scope, status: c.status as "REVIEW" | "FAIL", detail: c.detail, rows });
  }
  const accounts = await db.account.findMany({ where: { clientId }, select: { code: true, name: true }, orderBy: { code: "asc" } });
  return { input: { client: client.name, period: formatPeriod(year, month), accounts, controls: reviewed }, links, flagged };
}

const cacheKey = (firmId: string, clientId: string, input: CloseReviewInput, model: string) =>
  createHash("sha256").update(JSON.stringify([firmId, clientId, input, model, CLOSE_REVIEW_PROMPT_VERSION])).digest("hex");
const scopeOf = (clientId: string, year: number, month: number) => `close:${clientId}:${year}-${String(month).padStart(2, "0")}`;

function view(g: Gathered, items: CloseReviewItem[]): CloseReviewView {
  const byKey = new Map(g.flagged.map((c) => [c.key, c]));
  return {
    flagged: g.flagged.length,
    items: items.flatMap((i) => {
      const c = byKey.get(i.controlKey);
      return c ? [{ ...i, title: c.title, scope: c.scope, status: c.status as "REVIEW" | "FAIL", links: i.refs.flatMap((r) => (g.links.has(r) ? [g.links.get(r)!] : [])) }] : [];
    }),
  };
}

/** A review already paid for with exactly this input and model; null if the books changed since (or none yet). No AI call. */
export async function cachedCloseReview(db: Db, firmId: string, clientId: string, year: number, month: number, model: string | null, controls?: Control[]): Promise<CloseReviewView | null> {
  if (!model) return null;
  const g = await gather(db, clientId, year, month, controls);
  if (g.flagged.length === 0) return null;
  const hit = await db.evidenceAiCache.findFirst({ where: { key: cacheKey(firmId, clientId, g.input, model), firmId, scope: scopeOf(clientId, year, month) } });
  return hit ? view(g, parseCloseReview(JSON.stringify(hit.payload), g.input)) : null;
}

export async function reviewClose(db: Db, firmId: string, clientId: string, year: number, month: number, provider: AiProvider): Promise<CloseReviewView> {
  if (!provider.reviewClose) throw new Error("Model AI ini belum mendukung tinjauan tutup buku.");
  const g = await gather(db, clientId, year, month);
  if (g.flagged.length === 0) return { items: [], flagged: 0 };
  const key = cacheKey(firmId, clientId, g.input, provider.model);
  const scope = scopeOf(clientId, year, month);
  const hit = await db.evidenceAiCache.findFirst({ where: { key, firmId, scope } });
  if (hit) return view(g, parseCloseReview(JSON.stringify(hit.payload), g.input));
  const result = await runBudgetedAi(
    db,
    { firmId, scope, prompt: buildCloseReviewPrompt(g.input), maxCompletionTokens: CLOSE_REVIEW_MAX_TOKENS, scopeTokenLimit: CLOSE_REVIEW_TOKEN_LIMIT, model: provider.model, keysRequested: g.input.controls.length },
    async () => {
      const r = await provider.reviewClose!(g.input);
      try { return { ...r, items: parseCloseReview(JSON.stringify({ items: r.items }), g.input) }; }
      catch { throw new AiAnswerError("Tinjauan AI tidak valid; periksa kontrol secara manual.", r.promptTokens, r.completionTokens, r.model); }
    },
  );
  await db.evidenceAiCache.upsert({ where: { key }, create: { key, firmId, scope, payload: { items: result.items } }, update: {} });
  return view(g, result.items);
}

const abs = (v: bigint) => (v < 0n ? -v : v);
