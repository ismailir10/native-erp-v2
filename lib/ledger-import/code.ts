/**
 * A source account read from a file without a code column is keyed `NC:<label>` (read.ts) so it stays unique per entity.
 * That key is internal: people see no code, only the name (which is the label).
 */
/** What an import is, as the pages name it: a trial balance is a Neraca-mode import whose saved plan says `tb`. */
export function importKindLabel(imp: { mode: "LEDGER" | "NERACA"; data?: unknown }): string {
  if (imp.mode === "LEDGER") return "Buku besar";
  return (imp.data as { tb?: boolean } | null)?.tb ? "Neraca saldo (TB)" : "Neraca";
}

export const NO_CODE_PREFIX = "NC:";
export const displaySourceCode = (code: string) => (code.startsWith(NO_CODE_PREFIX) ? "" : code);
/** "63005 Beban Sewa", or just the name when the file had no code. */
export const sourceAccountLabel = (s: { code: string; name: string }) => [displaySourceCode(s.code), s.name].filter(Boolean).join(" ");
