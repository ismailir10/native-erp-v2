import { createHash } from "node:crypto";
import type { Db } from "@/lib/db";
import { recordEvent } from "@/lib/audit";
import { runBudgetedAi } from "@/lib/ai/budget";
import { AiAnswerError, type AiProvider } from "@/lib/ai/provider";
import { formatPeriod } from "@/lib/format";
import { commentary, managementSummary } from "@/lib/reports/management";
import { allowedNumbers, buildCommentaryPrompt, COMMENTARY_MAX_TOKENS, COMMENTARY_PROMPT_VERSION, foreignNumbers, type CommentaryInput } from "@/lib/reports/commentary-ai";

/**
 * Catatan bulan ini (I5b): the computed sentences, an AI draft that may only reword them, and the note the accountant approves. A
 * note is checked against the computed sentences it was approved with; when the books move and they change, it is stale and the
 * report falls back to the computed sentences (accounting-rules 20c).
 */
export class CommentError extends Error {}

type Key = { clientId: string; entityId: string; year: number; month: number };
const REPORT_TOKEN_LIMIT = 20_000;
const scopeOf = (k: Key) => `report:${k.clientId}:${k.year}-${String(k.month).padStart(2, "0")}`;

async function entityOf(db: Db, k: Key) {
  const entity = await db.entity.findFirst({ where: { id: k.entityId, clientId: k.clientId }, select: { id: true, name: true, functionalCurrency: true, client: { select: { name: true, firmId: true } } } });
  if (!entity) throw new CommentError("Perusahaan tidak ditemukan.");
  return entity;
}

/** The computed sentences of the month (lib/reports/management.ts), the only facts any note may state. */
export async function computedFacts(db: Db, k: Key): Promise<string[]> {
  return commentary(await managementSummary(db, k));
}

export type ReportCommentView = { text: string; source: "AI" | "ACCOUNTANT"; approvedAt: Date; approvedBy: string | null; stale: boolean };

export async function reportComment(db: Db, k: Key, facts?: string[]): Promise<ReportCommentView | null> {
  const row = await db.reportComment.findUnique({ where: { entityId_year_month: { entityId: k.entityId, year: k.year, month: k.month } } });
  if (!row || row.clientId !== k.clientId) return null;
  const current = facts ?? (await computedFacts(db, k));
  const by = row.approvedById ? await db.firmMember.findUnique({ where: { id: row.approvedById }, select: { name: true } }) : null;
  return { text: row.text, source: row.source as "AI" | "ACCOUNTANT", approvedAt: row.approvedAt, approvedBy: by?.name ?? null, stale: JSON.stringify(row.facts) !== JSON.stringify(current) };
}

/** The note the management report carries: the approved one while it still matches the books, else the computed sentences. */
export async function noteForReport(db: Db, k: Key): Promise<{ lines: string[]; approved: boolean; staleNote: boolean }> {
  const facts = await computedFacts(db, k);
  const note = await reportComment(db, k, facts);
  if (note && !note.stale) return { lines: [note.text], approved: true, staleNote: false };
  return { lines: facts, approved: false, staleNote: !!note };
}

/** One budgeted, cached call; the draft comes back with the numbers it holds that the facts do not. Nothing is saved. */
export async function draftCommentary(db: Db, k: Key & { firmId: string; provider: AiProvider }): Promise<{ text: string; foreign: string[] }> {
  if (!k.provider.draftCommentary) throw new CommentError("Model AI ini belum mendukung penyusunan catatan.");
  const entity = await entityOf(db, k);
  if (entity.client.firmId !== k.firmId) throw new CommentError("Perusahaan tidak ditemukan.");
  const facts = await computedFacts(db, k);
  const input: CommentaryInput = { client: entity.client.name, entity: entity.name, period: formatPeriod(k.year, k.month), currency: entity.functionalCurrency, facts };
  const allowed = allowedNumbers([...facts, input.client, input.entity, input.period]);
  const key = createHash("sha256").update(JSON.stringify([k.firmId, k.entityId, input, k.provider.model, COMMENTARY_PROMPT_VERSION])).digest("hex");
  const scope = scopeOf(k);
  const hit = await db.evidenceAiCache.findFirst({ where: { key, firmId: k.firmId, scope } });
  let text: string;
  if (hit && typeof (hit.payload as { text?: unknown }).text === "string") text = (hit.payload as { text: string }).text;
  else {
    const r = await runBudgetedAi(
      db,
      { firmId: k.firmId, scope, prompt: buildCommentaryPrompt(input), maxCompletionTokens: COMMENTARY_MAX_TOKENS, scopeTokenLimit: REPORT_TOKEN_LIMIT, model: k.provider.model, keysRequested: 1, note: "Catatan laporan manajemen" },
      async () => {
        const out = await k.provider.draftCommentary!(input);
        if (!out.text.trim()) throw new AiAnswerError("Catatan AI kosong; pakai kalimat otomatis.", out.promptTokens, out.completionTokens, out.model);
        return out;
      },
    );
    text = r.text;
    await db.evidenceAiCache.upsert({ where: { key }, create: { key, firmId: k.firmId, scope, payload: { text } }, update: {} });
  }
  return { text, foreign: foreignNumbers(text, allowed) };
}

/**
 * The accountant's click. An AI draft with a number the facts do not hold is refused; the accountant's own wording may hold one
 * (they own it) and gets the list back as a warning.
 */
export async function saveReportComment(db: Db, k: Key & { firmId: string; text: string; source: "AI" | "ACCOUNTANT"; actorId?: string | null }): Promise<{ foreign: string[] }> {
  const entity = await entityOf(db, k);
  if (entity.client.firmId !== k.firmId) throw new CommentError("Perusahaan tidak ditemukan.");
  const text = k.text.replace(/\s+\n/g, "\n").trim();
  if (!text) throw new CommentError("Isi catatannya, atau kembali ke kalimat otomatis.");
  if (text.length > 1500) throw new CommentError("Catatan maksimal 1.500 karakter.");
  if (k.source !== "AI" && k.source !== "ACCOUNTANT") throw new CommentError("Sumber catatan tidak dikenal.");
  const facts = await computedFacts(db, k);
  const foreign = foreignNumbers(text, allowedNumbers([...facts, entity.client.name, entity.name, formatPeriod(k.year, k.month)]));
  if (k.source === "AI" && foreign.length) throw new CommentError(`Catatan AI memuat angka yang tidak ada di laporan: ${foreign.join(", ")}. Ubah sendiri atau susun ulang.`);
  await db.$transaction(async (tx) => {
    const data = { text, source: k.source, facts, approvedById: k.actorId ?? null, approvedAt: new Date() };
    await tx.reportComment.upsert({
      where: { entityId_year_month: { entityId: k.entityId, year: k.year, month: k.month } },
      create: { firmId: k.firmId, clientId: k.clientId, entityId: k.entityId, year: k.year, month: k.month, ...data },
      update: data,
    });
    await recordEvent(tx, { clientId: k.clientId, entityId: k.entityId, kind: "REPORT_COMMENT", subject: `period:${k.year}-${String(k.month).padStart(2, "0")}`, summary: `Catatan laporan manajemen ${entity.name} disetujui (${k.source === "AI" ? "disusun AI" : "ditulis akuntan"})`, after: { text, source: k.source }, actorId: k.actorId ?? null });
  });
  return { foreign };
}

export async function clearReportComment(db: Db, k: Key & { firmId: string; actorId?: string | null }) {
  const entity = await entityOf(db, k);
  if (entity.client.firmId !== k.firmId) throw new CommentError("Perusahaan tidak ditemukan.");
  await db.$transaction(async (tx) => {
    const { count } = await tx.reportComment.deleteMany({ where: { clientId: k.clientId, entityId: k.entityId, year: k.year, month: k.month } });
    if (count) await recordEvent(tx, { clientId: k.clientId, entityId: k.entityId, kind: "REPORT_COMMENT", subject: `period:${k.year}-${String(k.month).padStart(2, "0")}`, summary: `Catatan laporan manajemen ${entity.name} dikembalikan ke kalimat otomatis`, actorId: k.actorId ?? null });
  });
}
