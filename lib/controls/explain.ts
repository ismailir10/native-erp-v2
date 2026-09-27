import { createHash } from "node:crypto";
import type { Db } from "@/lib/db";
import { runControls } from "@/lib/controls";
import { gather, snapshotOf, CLOSE_REVIEW_TOKEN_LIMIT, type ReviewLink } from "@/lib/controls/ai-review";
import { formatPeriod } from "@/lib/format";
import { runBudgetedAi } from "@/lib/ai/budget";
import { AiAnswerError, amountOf, CONTROL_EXPLAIN_MAX_TOKENS, CONTROL_EXPLAIN_PROMPT_VERSION, buildControlExplainPrompt, parseControlExplain, type AiProvider, type ControlExplainAnswer, type ControlExplainInput } from "@/lib/ai/provider";
import { saveProposal, type ProposalLine } from "@/lib/adjust/proposals";

/**
 * Close copilot — "Jelaskan" (ADR 0009, accounting-rules 20b). One flagged control, its own rows only, one budgeted and cached call.
 * The answer may carry a draft note (a prefill the accountant saves) and a grounded draft journal, stored as a ProposedEntry that
 * only the accountant's click posts. Nothing here posts, acknowledges, ticks or locks.
 */

export type ControlExplanation = { controlKey: string; explanation: string; suggestion: string; note: string; links: ReviewLink[]; proposal: { id: string; status: string } | null };

export class ExplainError extends Error {}

const scopeOf = (clientId: string, year: number, month: number) => `close:${clientId}:${year}-${String(month).padStart(2, "0")}`;

export async function explainControl(db: Db, firmId: string, clientId: string, year: number, month: number, controlKey: string, provider: AiProvider): Promise<ControlExplanation> {
  if (!provider.explainControl) throw new ExplainError("Model AI ini belum mendukung penjelasan kontrol.");
  const control = (await runControls(db, clientId, year, month)).find((c) => c.key === controlKey);
  if (!control) throw new ExplainError("Kontrol tidak ditemukan untuk periode ini.");
  if (control.status === "PASS") throw new ExplainError("Kontrol ini sudah lolos; tidak ada yang perlu dijelaskan.");
  const g = await gather(db, clientId, year, month, [control]);
  const reviewed = g.input.controls[0];
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { entities: true } });
  // Entity-scoped controls (`kind:<entityId>`) may get a draft journal for that entity; group-level ones get words only.
  const entity = client.entities.find((e) => e.id === controlKey.split(":")[1]) ?? null;
  const accounts = (await db.account.findMany({ where: { clientId, isBank: false }, select: { code: true, name: true }, orderBy: { code: "asc" } }));
  const input: ControlExplainInput = { client: client.name, period: formatPeriod(year, month), currency: entity?.functionalCurrency ?? client.entities[0]?.functionalCurrency ?? "IDR", accounts, control: reviewed, canDraft: entity !== null };

  const key = createHash("sha256").update(JSON.stringify([firmId, clientId, input, provider.model, CONTROL_EXPLAIN_PROMPT_VERSION])).digest("hex");
  const scope = scopeOf(clientId, year, month);
  let answer: ControlExplainAnswer;
  const hit = await db.evidenceAiCache.findFirst({ where: { key, firmId, scope } });
  if (hit) answer = parseControlExplain(JSON.stringify(hit.payload), input);
  else {
    const result = await runBudgetedAi(
      db,
      { firmId, scope, prompt: buildControlExplainPrompt(input), maxCompletionTokens: CONTROL_EXPLAIN_MAX_TOKENS, scopeTokenLimit: CLOSE_REVIEW_TOKEN_LIMIT, model: provider.model, keysRequested: 1, note: "Jelaskan kontrol" },
      async () => {
        const r = await provider.explainControl!(input);
        try { return { ...r, ...parseControlExplain(JSON.stringify(r), input) }; }
        catch { throw new AiAnswerError("Penjelasan AI tidak valid; periksa kontrol secara manual.", r.promptTokens, r.completionTokens, r.model); }
      },
    );
    answer = { explanation: result.explanation, suggestion: result.suggestion, refs: result.refs, note: result.note, entry: result.entry };
    await db.evidenceAiCache.upsert({ where: { key }, create: { key, firmId, scope, payload: answer }, update: {} });
  }

  let proposal: ControlExplanation["proposal"] = null;
  if (answer.entry && entity) {
    const lines: ProposalLine[] = answer.entry.lines.map((l) => {
      const minor = amountOf(l.amount, input.currency)!.toString(); // grounded: parsed from a cited row's amount
      return { accountCode: l.accountCode, debit: l.side === "D" ? minor : "0", credit: l.side === "K" ? minor : "0" };
    });
    // Only the rows the answer cites can be the bank line it moves; two cited lines that both fit make the draft ambiguous.
    const bank = await reclassedBankLine(db, entity.id, answer.refs, answer.entry, input.currency);
    if (bank !== "AMBIGUOUS") {
      const p = await saveProposal(db, { firmId, clientId, entityId: entity.id, year, month, source: "AI_CONTROL", controlKey, key: `AI:${key}`, memo: answer.entry.memo, lines, reason: answer.explanation, refs: answer.refs, bankTransactionId: bank, snapshot: snapshotOf(reviewed.rows) });
      proposal = { id: p.id, status: p.status };
    }
  }
  return { controlKey, explanation: answer.explanation, suggestion: answer.suggestion, note: control.status === "REVIEW" ? answer.note : "", links: answer.refs.flatMap((r) => (g.links.has(r) ? [g.links.get(r)!] : [])), proposal };
}

/**
 * A two-line draft that takes a cited bank line off its current account (the reverse side, its full amount) and onto another
 * one is a re-classification of that line: it must post through the review writer, never as a free journal (rule 3).
 */
async function reclassedBankLine(db: Db, entityId: string, citedIds: string[], entry: NonNullable<ControlExplainAnswer["entry"]>, currency: string): Promise<string | null | "AMBIGUOUS"> {
  if (entry.lines.length !== 2 || citedIds.length === 0) return null;
  const txs = await db.bankTransaction.findMany({ where: { id: { in: citedIds }, entityId, accountCode: { not: null } }, orderBy: { id: "asc" } });
  const matches = txs.filter((t) => {
    const abs = t.amount < 0n ? -t.amount : t.amount;
    const reverse = t.amount > 0n ? "D" : "K"; // money in was credited to its account: moving it off debits that account
    const from = entry.lines.find((l) => l.accountCode === t.accountCode && l.side === reverse && amountOf(l.amount, currency) === abs);
    return !!from && entry.lines.some((l) => l !== from && l.accountCode !== t.accountCode && amountOf(l.amount, currency) === abs);
  });
  return matches.length === 1 ? matches[0].id : matches.length > 1 ? "AMBIGUOUS" : null;
}
