/**
 * A source account read from a file without a code column is keyed `NC:<label>` (read.ts) so it stays unique per entity.
 * That key is internal: people see no code, only the name (which is the label).
 */
export const NO_CODE_PREFIX = "NC:";
export const displaySourceCode = (code: string) => (code.startsWith(NO_CODE_PREFIX) ? "" : code);
/** "63005 Beban Sewa", or just the name when the file had no code. */
export const sourceAccountLabel = (s: { code: string; name: string }) => [displaySourceCode(s.code), s.name].filter(Boolean).join(" ");
