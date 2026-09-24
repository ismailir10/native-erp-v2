import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseStatementSections } from "@/lib/import/parsers";
import { readLines } from "@/lib/import/parsers/pdf";
import { checkContinuity } from "@/lib/import/normalize";
import { formatRupiah } from "@/lib/money";

/**
 * npm run inspect:statement -- <file> [--password=…] [--lines]   (or PDF_PASSWORD=… to keep it out of shell history)
 * Parses a bank statement WITHOUT touching the database: prints what Buku would import and whether
 * the running balance holds. `--lines` dumps the raw PDF text with x positions, for tuning a new layout.
 * Real client files live in data/private/ (gitignored). Don't paste their output into commits or issues.
 */
async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const password = args.find((a) => a.startsWith("--password="))?.slice("--password=".length) ?? process.env.PDF_PASSWORD;
  if (!file) {
    console.error("Usage: npm run inspect:statement -- <file> [--password=…] [--lines]");
    process.exit(1);
  }
  const data = readFileSync(file);

  if (args.includes("--lines")) {
    for (const l of await readLines(data, password)) {
      console.log(`p${l.page} y=${l.y.toFixed(0).padStart(4)}  ${l.cells.map((c) => `[${c.x0.toFixed(0)}] ${c.text}`).join("   ")}`);
    }
    return;
  }

  const sections = await parseStatementSections(basename(file), data, { password });
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  console.log(`File        ${basename(file)}${sections.length > 1 ? ` · ${sections.length} rekening dalam satu file` : ""}`);
  let broken = false;
  for (const st of sections) {
    const c = checkContinuity(st);
    broken ||= !c.ok;
    const sum = st.rows.reduce((s, r) => s + r.amount, 0n);
    console.log("");
    if (st.section) console.log(`── ${st.section.label} (${st.section.currency})`);
    console.log(`Format      ${st.format}`);
    console.log(`Rekening    ${st.accountNumber ?? "(tidak tertulis di file)"}`);
    console.log(`Periode     ${iso(st.periodStart)} s.d. ${iso(st.periodEnd)}`);
    console.log(`Saldo awal  ${formatRupiah(st.openingBalance)}`);
    console.log(`Mutasi      ${st.rows.length} baris, bersih ${formatRupiah(sum)}`);
    console.log(`Saldo akhir ${formatRupiah(st.closingBalance)}`);
    console.log(`Kesinambungan ${c.ok ? "NYAMBUNG ✓" : `ADA CELAH ✗ — ${c.note}`}`);
    const show = st.rows.length > 10 ? [...st.rows.slice(0, 5), null, ...st.rows.slice(-5)] : st.rows;
    for (const r of show) {
      if (!r) console.log("  …");
      else console.log(`  ${String(r.rowNumber).padStart(4)}  ${iso(r.date)}  ${formatRupiah(r.amount).padStart(18)}  ${(r.balance === null ? "" : formatRupiah(r.balance)).padStart(18)}  ${r.description.slice(0, 60)}`);
    }
  }
  if (broken) process.exitCode = 2;
}
main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
