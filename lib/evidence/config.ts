/** The pilot runs locally or behind the protected preview, never on the public demo. */
export function evidenceEnabled() {
  return process.env.EVIDENCE_ENABLED === "true" && process.env.DEMO_MODE !== "true" &&
    (!process.env.VERCEL || (process.env.VERCEL_ENV === "preview" && process.env.EVIDENCE_PRIVATE_DEPLOYMENT === "true"));
}
export function requireEvidenceEnabled() {
  if (!evidenceEnabled()) throw new Error("Dokumen belum diaktifkan di lingkungan ini.");
}
export const FILE_LIMIT = 10 * 1024 * 1024;
export const INTAKE_LIMIT = 100 * 1024 * 1024;
export const FILE_COUNT_LIMIT = 500;
export const CHUNK_LIMIT = 1024 * 1024;
