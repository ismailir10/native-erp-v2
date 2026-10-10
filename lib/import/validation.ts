import { checkContinuity } from "@/lib/import/normalize";
import type { ParsedStatement } from "@/lib/import/types";

export type StatementValidation = {
  version: 1;
  sourceHash?: string;
  attestation?: { at: string; fileName: string };
  source: { currency: string | null; period: "DECLARED" | "INFERRED"; opening: "PRINTED" | "DERIVED"; closing: "PRINTED" | "ROW" | "DERIVED"; openingBalance: string; closingBalance: string };
  issues: { code: string; severity: "CONFLICT" | "UNVERIFIED"; message: string }[];
};

/** Source evidence is not upgraded by calculating a value from the rows being checked. */
export function validateStatement(st: ParsedStatement, sourceHash?: string): StatementValidation {
  if (sourceHash !== undefined && !/^[a-f0-9]{64}$/i.test(sourceHash)) throw new Error("Hash sumber rekening koran tidak valid.");
  const source: StatementValidation["source"] = {
    currency: st.currency ?? st.section?.currency ?? null,
    period: st.provenance?.period ?? "INFERRED",
    opening: st.provenance?.opening ?? "DERIVED",
    closing: st.provenance?.closing ?? "DERIVED",
    openingBalance: st.openingBalance.toString(), closingBalance: st.closingBalance.toString(),
  };
  const issues: StatementValidation["issues"] = [];
  const add = (code: string, severity: "CONFLICT" | "UNVERIFIED", message: string) => issues.push({ code, severity, message });
  const continuity = checkContinuity(st);
  if (!continuity.ok) add("BALANCE_CONFLICT", "CONFLICT", continuity.note ?? "Saldo sumber tidak nyambung.");
  if (source.period === "INFERRED") add("PERIOD_INFERRED", "UNVERIFIED", "Periode sumber belum terverifikasi; belum membuktikan seluruh bulan tercakup.");
  if (source.opening === "DERIVED") add("OPENING_DERIVED", "UNVERIFIED", "Saldo awal dihitung dari transaksi, bukan saldo awal yang tercetak.");
  if (source.closing === "DERIVED") add("CLOSING_DERIVED", "UNVERIFIED", "Saldo akhir dihitung dari transaksi, bukan saldo akhir yang tercetak.");
  if (source.closing === "ROW" && st.rows.at(-1) && +st.rows.at(-1)!.date < +st.periodEnd) add("CLOSING_BEFORE_END", "UNVERIFIED", "Saldo terakhir tercetak sebelum akhir periode; lengkapi saldo penutup periode.");
  if (st.rows.some((r) => r.balanceOnly)) add("AMOUNT_UNRESOLVED", "CONFLICT", "Ada perubahan saldo tanpa nominal transaksi yang dapat dibuktikan. Periksa baris sumber yang belum lengkap.");
  if (st.rows.some((r) => r.written)) add("ROWS_REPAIRED", "UNVERIFIED", "Ada tanggal atau nominal yang diperbaiki berdasarkan saldo; periksa nilai asli pada baris sumber.");
  return { version: 1, ...(sourceHash === undefined ? {} : { sourceHash }), source, issues };
}

/** Old imports have no provenance; they must not be silently promoted to verified evidence. */
export function readValidation(value: unknown): StatementValidation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as StatementValidation;
  if (v.version !== 1 || !v.source || !["DECLARED", "INFERRED"].includes(v.source.period) || !["PRINTED", "DERIVED"].includes(v.source.opening) || !["PRINTED", "ROW", "DERIVED"].includes(v.source.closing) || !Array.isArray(v.issues)) return null;
  if (v.attestation !== undefined && (!v.attestation || typeof v.attestation.at !== "string" || !Number.isFinite(Date.parse(v.attestation.at)) || typeof v.attestation.fileName !== "string")) return null;
  if (v.sourceHash !== undefined && (typeof v.sourceHash !== "string" || !/^[a-f0-9]{64}$/i.test(v.sourceHash))) return null;
  if (v.source.currency !== null && (typeof v.source.currency !== "string" || !v.source.currency.trim())) return null;
  if (typeof v.source.openingBalance !== "string" || !/^-?\d+$/.test(v.source.openingBalance) || typeof v.source.closingBalance !== "string" || !/^-?\d+$/.test(v.source.closingBalance)) return null;
  if (!v.issues.every((i) => i && typeof i.code === "string" && typeof i.message === "string" && ["CONFLICT", "UNVERIFIED"].includes(i.severity))) return null;
  return v;
}
