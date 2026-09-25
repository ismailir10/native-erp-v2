/** Both environments use the same authenticated document workspace. Explicit false is an operational kill switch. */
export function evidenceEnabled() {
  return process.env.EVIDENCE_ENABLED !== "false";
}
export function requireEvidenceEnabled() {
  if (!evidenceEnabled()) throw new Error("Dokumen belum diaktifkan di lingkungan ini.");
}
export const FILE_LIMIT = 10 * 1024 * 1024;
export const INTAKE_LIMIT = 100 * 1024 * 1024;
export const FILE_COUNT_LIMIT = 500;
export const CHUNK_LIMIT = 1024 * 1024;
