/**
 * The proof of a transcribed statement (I2a, ADR 0014 I2): a row is accepted only when the previous balance plus its credit minus its
 * debit is its printed balance. Pure arithmetic on what the model read; the model never sees these checks or any expected balance.
 */
export type OcrRow = { date: string; description: string; debit: bigint | null; credit: bigint | null; balance: bigint | null };
export type RowProof = "OK" | "BREAK" | "NO_BALANCE" | "NO_AMOUNT" | "BAD_DATE" | "NO_OPENING";
export type Proof = { rows: { state: RowProof; expected: bigint | null }[]; closingOk: boolean | null; importable: boolean; problems: number };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s;
};

/**
 * `chained`: a file read deterministically (*Atur kolom*) whose bank prints a balance only on some rows (BCA: the last row of each day).
 * A row without one is proved by the next printed balance: the stretch up to it is OK when that balance ties, and breaks with it when not.
 * A scan read by AI is never chained: each of its rows must print its own balance (ADR 0014 I2).
 */
export function proveRows(rows: OcrRow[], opening: bigint | null, closing: bigint | null, opts: { chained?: boolean } = {}): Proof {
  let prev = opening;
  const out: Proof["rows"] = [];
  // Rows waiting for the next printed balance (chained only).
  let pending: number[] = [];
  for (const r of rows) {
    const amount = (r.credit ?? 0n) - (r.debit ?? 0n);
    let state: RowProof;
    let expected: bigint | null = prev === null ? null : prev + amount;
    if (!validDate(r.date)) state = "BAD_DATE";
    else if (amount === 0n) state = "NO_AMOUNT";
    else if (prev === null) state = "NO_OPENING";
    else if (r.balance === null) state = "NO_BALANCE";
    else state = expected === r.balance ? "OK" : "BREAK";
    if (state === "NO_AMOUNT") expected = prev;
    out.push({ state, expected });
    if (opts.chained) {
      if (state === "NO_BALANCE") pending.push(out.length - 1);
      else if (state === "OK" || state === "BREAK") {
        for (const i of pending) out[i].state = state;
        pending = [];
      } else pending = [];
    }
    // Continue from the printed balance (so one misread amount breaks one row); without one, from the computed balance.
    prev = r.balance ?? expected;
  }
  const last = rows.length ? rows[rows.length - 1].balance : opening;
  const closingOk = closing === null ? null : last === closing;
  const problems = out.filter((r) => r.state !== "OK").length + (closingOk === false ? 1 : 0);
  return { rows: out, closingOk, importable: rows.length > 0 && opening !== null && problems === 0, problems };
}

export const PROOF_LABEL: Record<RowProof, string> = {
  OK: "Terbukti",
  BREAK: "Saldo tidak nyambung",
  NO_BALANCE: "Saldo tidak terbaca",
  NO_AMOUNT: "Nominal kosong",
  BAD_DATE: "Tanggal tidak valid",
  NO_OPENING: "Saldo awal belum ada",
};
