import { CLOSE, OPEN, TX, en, idn, p2, xlsxBuffer } from "./bank-fixture";
import { makePdf, table } from "./pdf-fixture";

/**
 * Statements in a layout no Buku reader knows (column words no bank uses: "Value Dt", "Particulars", "Withdrawn", "Lodged", "Position"),
 * holding the five August rows of `tests/bank-fixture.ts` — or the same rows in September, carried on from August's closing balance, for
 * a "next month's file". *Atur kolom* must read them; the generic reader must not. Names and numbers are fake.
 */
export type Month = 8 | 9;
const opening = (month: Month) => (month === 8 ? OPEN : CLOSE);
const balances = (month: Month) => {
  let b = opening(month);
  return TX.map((t) => (b += t.amt));
};
const date = (d: number, month: Month) => `${p2(d)}/${p2(month)}/2026`;

/** CSV: a title block, the header, a "Saldo Awal" row, transactions with descriptions wrapped onto dateless rows, a total row. */
export function unknownCsv(month: Month = 8): Buffer {
  const bal = balances(month);
  const lines = [
    "POSISI KAS HARIAN;;;;;",
    "Nama;PT CONTOH FIKTIF;;;;",
    ";;;;;",
    "Value Dt;Ref;Particulars;Withdrawn;Lodged;Position",
    `${date(1, month)};;Saldo Awal;;;${idn(opening(month))}`,
    ...TX.flatMap((t, i) => [
      `${date(t.d, month)};R${i + 1};${t.desc[0]};${t.amt < 0 ? idn(t.amt) : ""};${t.amt > 0 ? idn(t.amt) : ""};${idn(bal[i])}`,
      ...t.desc.slice(1).map((d) => `;;${d};;;`),
    ]),
    `Total;;;${idn(TX.filter((t) => t.amt < 0).reduce((s, t) => s - t.amt, 0))};${idn(TX.filter((t) => t.amt > 0).reduce((s, t) => s + t.amt, 0))};`,
  ];
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

/** Text PDF of the same table (no "Saldo Awal" row: the opening comes from the first balance), wrapped lines below their row. */
export function unknownPdf(month: Month = 8): Buffer {
  const bal = balances(month);
  const X = { date: 40, desc: 110, out: 330, in: 410, bal: 490 };
  const head: [number, string][] = [[X.date, "Value Dt"], [X.desc, "Particulars"], [X.out, "Withdrawn"], [X.in, "Lodged"], [X.bal, "Position"]];
  const rows: [number, string][][] = TX.flatMap((t, i) => [
    [[X.date, date(t.d, month)], [X.desc, t.desc[0]], [t.amt < 0 ? X.out : X.in, en(t.amt)], [X.bal, en(bal[i])]] as [number, string][],
    ...t.desc.slice(1).map((d) => [[X.desc, d]] as [number, string][]),
  ]);
  return makePdf([[...table(800, [[[40, "POSISI KAS HARIAN"]], [[40, "PT CONTOH FIKTIF"]]]), ...table(760, [head, ...rows, [[40, "Halaman 1 dari 1"]]])]]);
}

/** Workbook: one amount column with a separate D/C column, newest first, Excel dates. */
export function unknownXlsx(month: Month = 8): Promise<Buffer> {
  const bal = balances(month);
  const body = TX.map((t, i) => [new Date(Date.UTC(2026, month - 1, t.d)), t.desc.join(" "), Math.abs(t.amt), t.amt < 0 ? "D" : "C", bal[i]] as (string | number | Date)[]).reverse();
  return xlsxBuffer("Kas", [["POSISI KAS HARIAN"], [], ["Value Dt", "Particulars", "Amt", "D/C", "Position"], ...body]);
}
