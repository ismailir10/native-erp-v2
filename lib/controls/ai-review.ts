import { aiAccounts } from "@/lib/ai/classify";
import { createHash } from "node:crypto";
import type { Db } from "@/lib/db";
import { runControls, type Control } from "@/lib/controls";
import { flaggedBankRows } from "@/lib/controls/sanity";
import { scanLedger, sourceLabel } from "@/lib/controls/anomaly";
import { formatMonthShort, formatPeriod, periodBounds } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { runBudgetedAi } from "@/lib/ai/budget";
import { AiAnswerError, CLOSE_REVIEW_MAX_ROWS, CLOSE_REVIEW_MAX_TOKENS, CLOSE_REVIEW_PROMPT_VERSION, buildCloseReviewPrompt, parseCloseReview, type AiProvider, type CloseReviewControl, type CloseReviewInput, type CloseReviewItem, type CloseReviewRow } from "@/lib/ai/provider";
import { sourceAccountLabel } from "@/lib/ledger-import/code";

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

export async function gather(db: Db, clientId: string, year: number, month: number, controls?: Control[]): Promise<Gathered> {
  const { start, end } = periodBounds(year, month);
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { entities: true } });
  const base = `/clients/${clientId}`;
  const pk = `${year}-${String(month).padStart(2, "0")}`;
  const flagged = (controls ?? (await runControls(db, clientId, year, month))).filter((c) => c.status !== "PASS");
  const entityOf = (key: string) => client.entities.find((e) => e.id === key.split(":")[1]);
  const links = new Map<string, ReviewLink>();
  let budget = CLOSE_REVIEW_MAX_ROWS;
  let allowance = ROWS_PER_CONTROL; // shared by every batch added to the current control; reset per control
  const take = <T,>(rows: T[]) => {
    const n = Math.max(0, Math.min(allowance, budget, rows.length));
    budget -= n;
    allowance -= n;
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
    allowance = ROWS_PER_CONTROL;
    const kind = c.key.split(":")[0];
    const e = entityOf(c.key);
    let rows: CloseReviewRow[] = [];
    if (e && (kind === "pl-financing" || kind === "guess")) {
      const f = await flaggedBankRows(db, clientId, e.id, start, end);
      rows = take(bySize(kind === "guess" ? f.guesses : f.financing)).map((t) => bankRow(t, e.functionalCurrency, e.id));
    } else if (e && (kind === "nature" || kind === "nature-total")) {
      // Rows that can explain the flag, nothing else (ADR 0009). `nature`: the listed accounts. `nature-total`: a transfer
      // between two asset accounts can't move the total, so send the asset accounts carrying credit balances and the bank
      // lines booked to those accounts or to non-asset accounts (expenses, liabilities, equity).
      const assets = kind === "nature-total";
      const candidates = await db.account.findMany({ where: { clientId, type: { in: ["ASET", "LIABILITAS"] }, isBank: false, isSuspense: false, isClearing: false, isIntercompany: false } });
      let flaggedCodes: string[];
      let bankCodes: string[];
      if (assets) {
        const assetIds = candidates.filter((a) => a.type === "ASET").map((a) => a.id);
        const sums = await db.journalLine.groupBy({ by: ["accountId"], where: { entityId: e.id, date: { lte: end }, accountId: { in: assetIds } }, _sum: { debit: true, credit: true } });
        const negative = sums.map((x) => ({ account: candidates.find((a) => a.id === x.accountId)!, net: (x._sum.debit ?? 0n) - (x._sum.credit ?? 0n) })).filter((x) => x.net < 0n);
        flaggedCodes = negative.map((x) => x.account.code);
        const nonAsset = (await db.account.findMany({ where: { clientId, type: { not: "ASET" } }, select: { code: true } })).map((a) => a.code);
        bankCodes = [...flaggedCodes, ...nonAsset];
        rows.push(
          ...take(bySize(negative.map((x) => ({ ...x, amount: x.net })))).map((x) => {
            const id = `akun:${e.id}:${x.account.code}`; // entity-scoped: the same code can be negative in two entities
            links.set(id, { id, label: `${x.account.code} ${x.account.name}`, href: `${base}/ledger/${x.account.code}?period=${pk}&entity=${e.id}` });
            return { id, date: "", text: `Akun aset ${x.account.code} ${x.account.name} bersaldo kredit`.slice(0, DESCRIPTION), amount: formatMoney(x.net, e.functionalCurrency), account: x.account.code, how: "saldo akhir" };
          }),
        );
      } else {
        const listed = new Set(c.detail.split("; ").map((part) => part.split(" ")[0]));
        flaggedCodes = candidates.filter((a) => listed.has(a.code)).map((a) => a.code);
        bankCodes = flaggedCodes;
      }
      const txs = await db.bankTransaction.findMany({ where: { entityId: e.id, date: { gte: start, lte: end }, accountCode: { in: bankCodes } } });
      rows.push(...take(bySize(txs)).map((t) => bankRow(t, e.functionalCurrency, e.id)));
      // Ledger-fed balances: the client's own accounts that make up each flagged Buku account.
      const parts = await db.journalLine.groupBy({
        by: ["sourceAccountId"],
        where: { entityId: e.id, date: { lte: end }, sourceAccountId: { not: null }, account: { clientId, code: { in: flaggedCodes } } },
        _sum: { debit: true, credit: true },
      });
      const sources = new Map((await db.sourceAccount.findMany({ where: { id: { in: parts.map((x) => x.sourceAccountId!) } }, include: { account: true } })).map((x) => [x.id, x]));
      const nets = parts.map((x) => ({ id: x.sourceAccountId!, amount: (x._sum.debit ?? 0n) - (x._sum.credit ?? 0n) })).filter((x) => x.amount !== 0n);
      rows.push(
        ...take(bySize(nets)).map((x) => {
          const src = sources.get(x.id)!;
          const id = `src:${x.id}`;
          links.set(id, { id, label: sourceAccountLabel({ code: src.code, name: src.name.slice(0, 40) }), href: `${base}/trial-balance?view=source&entity=${e.id}&period=${pk}` });
          return { id, date: "", text: `Akun sumber ${sourceAccountLabel(src)}`.slice(0, DESCRIPTION), amount: formatMoney(x.amount, e.functionalCurrency), account: src.account?.code ?? "", how: `dipetakan ke ${src.account?.code ?? "-"}${src.typeHint ? `, jenis di file ${src.typeHint}` : ""}` };
        }),
      );
    } else if (e && (kind === "flux" || kind === "flip" || kind === "dormant" || kind === "dup")) {
      // Ledger anomaly scans (rule 22b): the same findings the control shows, then the month's lines behind them.
      const scan = await scanLedger(db, clientId, e.id, year, month);
      const fmt = (v: bigint) => formatMoney(v, e.functionalCurrency);
      const ledger = (code: string) => `${base}/ledger/${code}?period=${pk}&entity=${e.id}`;
      if (kind === "dup") {
        rows = take(scan.dup.flatMap((d) => [d.first, d.second].map((x) => ({ ...x, code: d.account.code })))).map((x) => {
          const id = `je:${x.id}`;
          links.set(id, { id, label: `${x.date.toISOString().slice(0, 10)} ${x.code} ${x.memo.slice(0, 40)}`, href: ledger(x.code) });
          return { id, date: x.date.toISOString().slice(0, 10), text: x.memo.slice(0, DESCRIPTION), amount: fmt(x.amount), account: x.code, how: sourceLabel(x) };
        });
      } else {
        const found = kind === "flux" ? scan.flux : kind === "flip" ? scan.flip : scan.dormant;
        const months = [...scan.baseline, pk].map((k) => formatMonthShort(Number(k.slice(0, 4)), Number(k.slice(5))));
        const summaries = take(found).map((f) => {
          const id = `akun:${e.id}:${f.account.code}`;
          links.set(id, { id, label: `${f.account.code} ${f.account.name}`, href: ledger(f.account.code) });
          const series = scan.series.get(f.account.id) ?? [];
          const text = `Mutasi ${f.account.code} ${f.account.name}: ${series.map((v, i) => `${months[i]} ${fmt(v)}`).join(" · ")}`;
          return { id, date: "", text: text.slice(0, 240), amount: fmt(f.current), account: f.account.code, how: `sisi normal ${f.account.normalBalance === "DEBIT" ? "debit" : "kredit"}` };
        });
        rows.push(...summaries);
        const lines = await db.journalLine.findMany({
          where: { entityId: e.id, date: { gte: start, lte: end }, accountId: { in: found.slice(0, summaries.length).map((f) => f.account.id) }, entry: { kind: { not: "OPENING" } } },
          include: { account: { select: { code: true } }, entry: { select: { kind: true, memo: true, sourceRef: true, bankTransactionId: true } } },
          orderBy: [{ date: "asc" }, { id: "asc" }], // stable ties for bySize: the payload is the cache key
        });
        rows.push(
          ...take(bySize(lines.map((l) => ({ ...l, amount: l.debit - l.credit })))).map((l) => {
            const id = `jl:${l.id}`;
            links.set(id, { id, label: `${l.date.toISOString().slice(0, 10)} ${l.account.code} ${(l.memo ?? l.entry.memo).slice(0, 40)}`, href: ledger(l.account.code) });
            return { id, date: l.date.toISOString().slice(0, 10), text: (l.memo ?? l.entry.memo).slice(0, DESCRIPTION), amount: fmt(l.amount), account: l.account.code, how: sourceLabel({ ...l.entry, sourceRef: l.sourceRef ?? l.entry.sourceRef }) }; // the line's own sheet!row when it has one
          }),
        );
      }
    } else if (kind === "suspense") {
      const txs = await db.bankTransaction.findMany({ where: { bankAccount: { entity: { clientId } }, status: "NEEDS_REVIEW", date: { lte: end } }, include: { bankAccount: { include: { entity: true } } } });
      rows = take(bySize(txs)).map((t) => bankRow(t, t.bankAccount.entity.functionalCurrency, t.entityId));
    } else if (kind === "ledger") {
      const importId = c.key.split(":")[1];
      const checks = (await db.importCheck.findMany({ where: { ledgerImportId: importId, severity: { in: ["BLOCK", "REVIEW"] }, OR: [{ date: null }, { date: { gte: start, lte: end } }] }, orderBy: { id: "asc" } }))
        .sort((x, y) => Number(x.severity !== "BLOCK") - Number(y.severity !== "BLOCK")); // the differences behind a FAIL first
      rows = take(checks).map((k) => {
        links.set(k.id, { id: k.id, label: k.message.slice(0, 60), href: `${base}/import/ledger/${importId}` });
        const currency = client.entities.find((x) => x.id === k.entityId)?.functionalCurrency ?? "IDR";
        return { id: k.id, date: k.date?.toISOString().slice(0, 10) ?? "", text: k.message.slice(0, 160), amount: k.amount === null ? "" : formatMoney(k.amount, currency), account: k.code, how: `${k.severity}${k.accepted ? " diterima" : ""}` };
      });
    }
    reviewed.push({ key: c.key, title: c.title, scope: c.scope, status: c.status as "REVIEW" | "FAIL", detail: c.detail, rows });
  }
  const accounts = aiAccounts(await db.account.findMany({ where: { clientId }, select: { code: true, name: true }, orderBy: { code: "asc" } }));
  return { input: { client: client.name, period: formatPeriod(year, month), accounts, controls: reviewed }, links, flagged };
}

/** What a reviewer can change on a bank line a draft moves (account, tax tag), or null for a draft that moves none. */
export async function bankLineState(db: Db, bankTransactionId: string | null) {
  if (!bankTransactionId) return null;
  const t = await db.bankTransaction.findUnique({ where: { id: bankTransactionId }, select: { accountCode: true, taxTag: true } });
  return { id: bankTransactionId, accountCode: t?.accountCode ?? null, taxTag: t?.taxTag ?? null };
}

/**
 * Fingerprint of a control's rows (and of the bank line the draft moves): a draft made from them is only postable while
 * they are unchanged — a re-review of that line, even of its tax tag alone, makes the draft stale.
 */
export const snapshotOf = (rows: CloseReviewRow[], line: Awaited<ReturnType<typeof bankLineState>> = null) =>
  createHash("sha256").update(JSON.stringify(line ? [rows, line] : rows)).digest("hex");

/** A still-flagged control's current rows and fingerprint, or null when it passes or no longer exists. */
export async function controlSnapshot(db: Db, clientId: string, year: number, month: number, controlKey: string, bankTransactionId: string | null = null): Promise<{ snapshot: string; rows: CloseReviewRow[] } | null> {
  const control = (await runControls(db, clientId, year, month)).find((c) => c.key === controlKey && c.status !== "PASS");
  if (!control) return null;
  const rows = (await gather(db, clientId, year, month, [control])).input.controls[0].rows;
  return { snapshot: snapshotOf(rows, await bankLineState(db, bankTransactionId)), rows };
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
