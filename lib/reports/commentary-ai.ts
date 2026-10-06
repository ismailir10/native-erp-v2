/**
 * Catatan manajemen with AI (I5b, ADR 0014: AI mengusulkan, aritmetika membuktikan, akuntan menyetujui). The model may reword the
 * computed commentary (lib/reports/management.ts); a draft may hold no number that the computed sentences do not hold. The check is
 * on number tokens, not meaning: the accountant's approval covers meaning.
 */

/** Number tokens as written in Bahasa copy: "1.505.720.721", "4,8", "2026", "1210". Trailing punctuation is not part of a token. */
export function numberTokens(text: string): string[] {
  return text.match(/\d(?:[\d.,]*\d)?/g) ?? [];
}

/** Every number the computed sentences (and the names around them) hold. */
export function allowedNumbers(sources: string[]): Set<string> {
  return new Set(sources.flatMap(numberTokens));
}

/** The number tokens of a draft that the computed sentences do not hold, each once, in order. */
export function foreignNumbers(text: string, allowed: Set<string>): string[] {
  return [...new Set(numberTokens(text).filter((t) => !allowed.has(t)))];
}

export type CommentaryInput = { client: string; entity: string; period: string; currency: string; facts: string[] };
export const COMMENTARY_PROMPT_VERSION = "commentary-v1";
export const COMMENTARY_MAX_TOKENS = 2000;

/** The facts are the computed sentences, never ledger rows: the model words what arithmetic already said. */
export function buildCommentaryPrompt(input: CommentaryInput) {
  const system = [
    "Anda membantu kantor akuntan menulis catatan laporan manajemen bulanan untuk pemilik usaha.",
    "Tulis 3–5 kalimat dalam Bahasa Indonesia yang jelas dan tenang, tanpa istilah teknis yang tidak perlu.",
    "Pakai HANYA fakta yang diberikan. Jangan menulis angka apa pun yang tidak ada persis di fakta: jangan membulatkan, mengubah satuan (juta/miliar) atau menghitung angka baru.",
    "Jangan memberi saran, perkiraan atau penilaian di luar fakta. Jangan memakai emoji atau tanda seru.",
    'Jawab JSON saja: {"text":"<catatan>"}',
  ].join("\n");
  const user = [`Klien: ${input.client}`, `Perusahaan: ${input.entity}`, `Periode: ${input.period}`, `Mata uang: ${input.currency}`, "Fakta:", ...input.facts.map((f) => `- ${f}`)].join("\n");
  return { system, user };
}

/** The draft's text from the model's JSON (or bare text), trimmed and bounded. */
export function parseCommentary(text: string): string {
  const body = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let out = body;
  try {
    const v = JSON.parse(body) as { text?: unknown };
    if (typeof v?.text === "string") out = v.text;
  } catch {
    // Not JSON: the model answered with the paragraph itself.
  }
  out = out.replace(/\s+/g, " ").trim();
  if (!out) throw new Error("empty commentary");
  return out.slice(0, 1500);
}
