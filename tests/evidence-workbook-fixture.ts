import ExcelJS from "exceljs";

/**
 * Synthetic group reconciliation workbook with the shapes a real consultant file has (invented names and figures):
 * a README, a source register and a final gate that mention bank statements, a HoldCo opening neraca without a stated
 * date (only prose "Closing … Opening …"), a single-entity SGD HoldCo GL whose memos say "Rekening koran", a 4-entity
 * IDR OpCo GL with an entity column, and derived engine sheets full of formulas without cached results.
 * Only three sheets are postable tables: HC foundation (NERACA), HC GL and OpCo GL (LEDGER).
 */
export const GROUP_ENTITIES = [
  { shortName: "HOLDCO", name: "Unggas Nusantara Pte Ltd", currency: "SGD" },
  { shortName: "OPA", name: "PT Ayam Satu", currency: "IDR" },
  { shortName: "OPB", name: "PT Ayam Dua", currency: "IDR" },
  { shortName: "OPC", name: "PT Ayam Tiga", currency: "IDR" },
  { shortName: "OPD", name: "PT Ayam Empat", currency: "IDR" },
] as const;
export const POSTABLE = { neraca: "04_HC_FOUNDATION", holdco: "10_HC_GL_MASTER", opco: "20_OPCO_GL_MASTER" } as const;
export const ENGINE_ROWS = 400;

const GL_HEADER = ["Entity", "GL Entry ID", "Status", "Entry Date", "Calendar Year", "Period", "Account Code", "Account Name", "Counterparty", "Currency", "Debit", "Credit", "Net", "Description"];
const net = (row: number) => ({ formula: `K${row}-L${row}` });

export async function groupWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const add = (name: string, rows: unknown[][]) => {
    const ws = wb.addWorksheet(name);
    rows.forEach((r) => ws.addRow(r));
    return ws;
  };

  add("00_README", [["GROUP RECONCILIATION WORKBOOK"], ["Scope: HoldCo and four OpCos, FY2026 working basis."], ["Sheet", "Purpose"], ["10_HC_GL_MASTER", "HoldCo general ledger"]]);
  add("02_SOURCE_REGISTER", [
    ["Entity", "Source Type", "Source Reference", "Notes"],
    ["HOLDCO", "Rekening koran", "OCBC SGD Jan 2026", "Bank statement reconstructed"],
    ["OPA", "Rekening koran", "BCA Jan 2026", "Mutasi rekening per bulan"],
  ]);

  // Opening neraca: debit/credit per account, no balance date anywhere in a cell — only prose.
  add(POSTABLE.neraca, [
    ["HOLDCO FOUNDATION & OPENING BRIDGE"],
    ["Foundation only. Use the audited TB to establish Closing 31 Dec 2025 and bridge it to Opening 1 Jan 2026 for the reporting period."],
    ["Foundation ID", "Source Type", "Source Reference", "Date / Period", "Account Code", "Account Name", "Debit", "Credit", "Net Movement"],
    ["HCF-001", "TB 2025", "Audited TB", "FY2025", "10001", "Bank OCBC SGD", 500000, 0, { formula: "G4-H4" }],
    ["HCF-002", "TB 2025", "Audited TB", "FY2025", "20000", "Long Term Loan Payable", 0, 300000, { formula: "G5-H5" }],
    ["HCF-003", "TB 2025", "Audited TB", "FY2025", "30000", "Share Capital", 0, 200000, { formula: "G6-H6" }],
  ]);

  const hc = [
    ["HOLDCO GL MASTER — FY2026 WORKING BASIS"],
    ["Entries reconstructed from the bank statement; Net is a formula column."],
    GL_HEADER,
    ["HOLDCO", "HC-GL-0001", "REVIEW", "2026-01-05", 2026, "JAN", "10001", "Bank OCBC SGD", "", "SGD", 15000, 0, net(4), "Rekening koran OCBC — capital call"],
    ["HOLDCO", "HC-GL-0002", "REVIEW", "2026-01-05", 2026, "JAN", "30000", "Share Capital", "", "SGD", 0, 15000, net(5), "Rekening koran OCBC — capital call"],
    ["HOLDCO", "HC-GL-0003", "REVIEW", "2026-01-20", 2026, "JAN", "60001", "Bank Charges", "", "SGD", 25, 0, net(6), "Rekening koran OCBC — fee"],
    ["HOLDCO", "HC-GL-0004", "REVIEW", "2026-01-20", 2026, "JAN", "10001", "Bank OCBC SGD", "", "SGD", 0, 25, net(7), "Rekening koran OCBC — fee"],
  ];
  add(POSTABLE.holdco, hc);

  const op: unknown[][] = [["OPCO GL MASTER — FY2026"], ["Four operating companies in one ledger; Entity column decides the books."], GL_HEADER];
  GROUP_ENTITIES.slice(1).forEach((e, i) => {
    const r = op.length + 1;
    op.push([e.shortName, `OP-GL-${i}1`, "OK", "2026-01-10", 2026, "JAN", "11001", "Kas", "", "IDR", 1_000_000 * (i + 1), 0, net(r), "Setoran modal"]);
    op.push([e.shortName, `OP-GL-${i}2`, "OK", "2026-01-10", 2026, "JAN", "31001", "Modal Disetor", "", "IDR", 0, 1_000_000 * (i + 1), net(r + 1), "Setoran modal"]);
  });
  add(POSTABLE.opco, op);

  // Derived sheets: look like ledgers/TBs to a keyword reader, but no postable header (no date, no plain debit/credit).
  const engine: unknown[][] = [["HOLDCO MOVEMENT ENGINE — derived from the general ledger"], ["Calendar Year", "Account Code", "Account Name", "Opening", "Mvt Dr", "Mvt Cr", "Closing"]];
  for (let i = 0; i < ENGINE_ROWS; i++) {
    const r = engine.length + 1;
    engine.push([2026, `9${String(i).padStart(4, "0")}`, `Akun ${i}`, { formula: `SUMIF(X${r})` }, { formula: `SUMIF(Y${r})` }, { formula: `SUMIF(Z${r})` }, { formula: `D${r}+E${r}-F${r}` }]);
  }
  add("11_HC_MOVEMENT_ENGINE", engine);
  add("14_HC_TB_ENGINE", [["Trial balance engine — general ledger rollup"], ["Calendar Year", "Account Code", "Account Name", "Closing"], [2026, "10001", "Bank OCBC SGD", { formula: "SUM(A1)" }]]);
  add("37_GROUP_FINAL_GATE", [["Control", "Result"], ["Bank statement tie-out", "PASS"], ["Entity", "PASS"]]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
