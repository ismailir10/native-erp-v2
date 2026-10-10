import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseStatement } from "@/lib/import/parsers";
import { validateStatement } from "@/lib/import/validation";
import { ParseError } from "@/lib/import/types";

type Format = "BCA_CSV" | "XLSX";
type Mutation = "opening" | "closing" | "currency" | "calendar" | "missing-row" | "amount-sign" | "dual-amount";
type Oracle = { seed: number; opening: bigint; closing: bigint; amounts: bigint[]; balances: bigint[] };

/** A deterministic source ledger independent of the application's money/date/balance helpers. */
function oracle(seed: number): Oracle {
  // The last case exceeds Number's exact integer range. Spreadsheet amounts deliberately remain strings.
  const opening = seed === 9 ? 90_071_992_547_409_931n : 4_000_000n + BigInt(seed) * 93_071n;
  const amounts = Array.from({ length: 8 }, (_, index) => {
    const magnitude = BigInt((seed + 3) * (index + 11) * 107 + index * index * 17 + 1);
    return (index + seed) % 3 === 0 ? -magnitude : magnitude;
  });
  const balances = amounts.map((_, index) => opening + amounts.slice(0, index + 1).reduce((sum, amount) => sum + amount, 0n));
  return { seed, opening, closing: opening + amounts.reduce((sum, amount) => sum + amount, 0n), amounts, balances };
}

/** Generated files carry independent printed opening, closing, running balances, currency and full-month period. */
async function source(facts: Oracle, format: Format, mutation?: Mutation): Promise<Buffer> {
  const rows: string[][] = format === "BCA_CSV"
    ? [["Informasi Rekening - Mutasi Rekening"], ["Currency: IDR"], ["Periode: 01/08/2026 - 31/08/2026"], ["No. rekening: 1234567890"], ["Tanggal Transaksi", "Keterangan", "Cabang", "Jumlah", "", "Saldo"]]
    : [["Currency: IDR"], ["Periode: 01/08/2026 - 31/08/2026"], ["Tanggal", "Keterangan", "Debit", "Credit", "Balance"], ["2026-08-01", "Saldo Awal", "0", "0", facts.opening.toString()]];
  const first = rows.length;
  for (let index = 0; index < facts.amounts.length; index++) {
    const amount = facts.amounts[index];
    const magnitude = amount < 0n ? -amount : amount;
    const description = `Synthetic counterparty ${facts.seed}-${index}`;
    rows.push(format === "BCA_CSV"
      ? [`${index + 13}/08`, description, "000", magnitude.toString(), amount < 0n ? "DB" : "CR", facts.balances[index].toString()]
      : [`2026-08-${index + 13}`, description, amount < 0n ? magnitude.toString() : "0", amount > 0n ? magnitude.toString() : "0", facts.balances[index].toString()]);
  }
  const closingRow = rows.length;
  rows.push(format === "BCA_CSV" ? [`Saldo Akhir: ${facts.closing}`] : ["", "Saldo Akhir", "0", "0", facts.closing.toString()]);
  if (format === "BCA_CSV") rows.push([`Saldo Awal: ${facts.opening}`]);
  const target = first + facts.seed % facts.amounts.length;
  // Each mutation changes exactly one source field, or removes exactly one physical transaction row.
  switch (mutation) {
    case "opening":
      if (format === "BCA_CSV") rows[rows.length - 1][0] = `Saldo Awal: ${facts.opening + 17n}`;
      else rows[first - 1][4] = (facts.opening + 17n).toString();
      break;
    case "closing":
      if (format === "BCA_CSV") rows[closingRow][0] = `Saldo Akhir: ${facts.closing - 23n}`;
      else rows[closingRow][4] = (facts.closing - 23n).toString();
      break;
    case "currency": rows[format === "BCA_CSV" ? 1 : 0][0] = "Currency: USD"; break;
    case "calendar": rows[target][0] = format === "BCA_CSV" ? "31/02" : "2026-02-31"; break;
    case "missing-row": rows.splice(target, 1); break;
    case "amount-sign":
      if (format === "BCA_CSV") rows[target][4] = rows[target][4] === "DB" ? "CR" : "DB";
      else {
        const column = rows[target][2] !== "0" ? 2 : 3;
        rows[target][column] = `-${rows[target][column]}`;
      }
      break;
    case "dual-amount":
      if (format !== "XLSX") throw new Error("Dual amounts require a split-column source.");
      rows[target][rows[target][2] === "0" ? 2 : 3] = "29";
      break;
  }
  if (format === "BCA_CSV") return Buffer.from(rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n"));
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("August").addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const fileName = (format: Format) => format === "BCA_CSV" ? "synthetic-bca.csv" : "synthetic.xlsx";
const cases = Array.from({ length: 10 }, (_, seed) => oracle(seed));

describe.each<Format>(["BCA_CSV", "XLSX"])("generated %s source integrity corpus", (format) => {
  it.each(cases)("reads seed $seed exactly and validates independent printed evidence", async (facts) => {
    const statement = await parseStatement(fileName(format), await source(facts, format));
    expect(statement.openingBalance).toBe(facts.opening);
    expect(statement.closingBalance).toBe(facts.closing);
    expect(statement.rows.map((row) => row.amount)).toEqual(facts.amounts);
    expect(statement.rows.map((row) => row.balance)).toEqual(facts.balances);
    expect(statement.rows.map((row) => row.date.toISOString().slice(0, 10))).toEqual(facts.amounts.map((_, index) => `2026-08-${index + 13}`));
    expect(statement.rows.map((row) => row.description)).toEqual(facts.amounts.map((_, index) => `Synthetic counterparty ${facts.seed}-${index}`));
    expect(statement.periodStart.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(statement.periodEnd.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(validateStatement(statement).issues).toEqual([]);
  });

  const mutations: Mutation[] = ["opening", "closing", "currency", "calendar", "missing-row", "amount-sign", ...(format === "XLSX" ? ["dual-amount" as const] : [])];
  for (const mutation of mutations) {
    it.each(cases)(`${mutation} mutation never becomes clean evidence (seed $seed)`, async (facts) => {
      let statement;
      try {
        statement = await parseStatement(fileName(format), await source(facts, format, mutation));
      } catch (error) {
        // Crashes and test-fixture errors are not successful refusals.
        expect(error).toBeInstanceOf(ParseError);
        return;
      }
      const validation = validateStatement(statement);
      expect(validation.issues.some((issue) => issue.severity === "CONFLICT" || issue.severity === "UNVERIFIED"), `silently accepted ${format} ${mutation}, seed ${facts.seed}`).toBe(true);
      if (mutation === "closing") expect(statement.closingBalance).toBe(facts.closing - 23n);
      if (mutation === "opening") expect(statement.openingBalance).toBe(facts.opening + 17n);
    });
  }
});
