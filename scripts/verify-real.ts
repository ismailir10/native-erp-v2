import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { createPrisma, type Db } from "@/lib/db";
import { createClient, createFirm } from "@/lib/setup";
import { acceptCheck, importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings, suggestMappings } from "@/lib/ledger-import/mapping";
import { upsertRate } from "@/lib/fx/rates";
import { balanceSheet, combinedWorksheet } from "@/lib/reports/ledger";
import { FxMissingError } from "@/lib/reports/fx";
import { parseStatementSections } from "@/lib/import/parsers";
import { checkContinuity } from "@/lib/import/normalize";
import { formatMoney } from "@/lib/money";
import { dateOnly } from "@/lib/format";

/**
 * npm run verify:real -- chickin|goers|smbc|all [--into-app]
 *
 * LOCAL ONLY. Reads real client files from data/private/ (gitignored), imports them into a fresh client and compares
 * Buku with the files themselves. Writes a report to data/private/reports/. Never run in CI; never commit the output.
 * --into-app puts the client into the firm the app shows (for a demo on localhost or the real-data preview);
 * without it the client goes into a separate "Verifikasi data nyata" firm.
 *
 * Answer key: the Chickin workbook's TB/FS tabs hold formulas without saved values, so Buku is compared against an
 * independent recompute of the same ledger rows (read here with plain ExcelJS, not Buku's reader).
 */

const PRIVATE = "data/private";
const out: string[] = [];
const log = (s = "") => {
  console.log(s);
  out.push(s);
};
let failures = 0;

async function firmFor(db: Db, intoApp: boolean) {
  if (intoApp) {
    const f = await db.firm.findFirst({ orderBy: { createdAt: "asc" } });
    if (!f) throw new Error("Belum ada firma di database. Buka aplikasinya sekali atau jalankan demo:reset.");
    return f;
  }
  return (await db.firm.findFirst({ where: { name: "Verifikasi data nyata" } })) ?? db.$transaction((tx) => createFirm(tx, "Verifikasi data nyata"));
}

const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");

/** Default mapping for accounts no rule recognised (AI isn't used here: no credit spent on verification). */
const FALLBACK: Record<string, string> = { ASET: "1140", LIABILITAS: "2120", EKUITAS: "3110", PENDAPATAN: "4910", BEBAN: "6190" };

async function runImport(db: Db, firmId: string, clientId: string, file: string, opts: { sheet?: string; entityId?: string; date?: Date }) {
  const data = readFileSync(file);
  const st = await stageImport(db, { firmId, clientId, fileName: file.split("/").pop()!, data, ...opts });
  if (st.status !== "STAGED") throw new Error(`Pilih sheet: ${st.candidates.map((c) => c.sheet).join(", ")}`);
  const checks = await db.importCheck.findMany({ where: { ledgerImportId: st.importId } });
  for (const c of checks.filter((c) => c.code === "UNBALANCED")) await acceptCheck(db, clientId, c.id);
  const blocking = checks.filter((c) => c.severity === "BLOCK" && c.code !== "UNBALANCED");
  if (blocking.length) throw new Error(`${blocking.length} BLOCK: ${blocking.slice(0, 3).map((c) => c.message).join(" | ")}`);
  const sug = await suggestMappings(db, { firmId, clientId, provider: null, useAi: false });
  const src = await importSourceAccounts(db, st.importId);
  const todo = src.filter((s) => !s.accountId);
  const fallback = todo.filter((s) => !s.suggestedCode);
  await acceptMappings(
    db,
    clientId,
    todo.map((s) => (s.suggestedCode ? { sourceAccountId: s.id, accountCode: s.suggestedCode, method: s.suggestedBy! } : { sourceAccountId: s.id, accountCode: FALLBACK[s.typeHint ?? ""] ?? "6190", method: "MANUAL" as const })),
  );
  const posted = await postImport(db, clientId, st.importId);
  return { importId: st.importId, checks, posted: posted.entries, sources: src.length, byRules: sug.deterministic, fallback: fallback.map((s) => `${s.code} ${s.name}`) };
}

// ─── Independent recompute (not Buku's reader) ────────────────────────────────

type Key = string; // entity|code|year
async function recomputeLedger(file: string, sheets: string[]) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sums = new Map<Key, { cents: bigint; rows: number }>();
  for (const name of sheets) {
    const ws = wb.getWorksheet(name)!;
    let head: Record<string, number> | null = null;
    ws.eachRow((row) => {
      const v = (row.values as unknown[]).slice(1).map((c) => (c && typeof c === "object" && "result" in (c as object) ? (c as { result: unknown }).result : c));
      if (!head) {
        const idx = (h: string) => v.findIndex((x) => String(x ?? "").trim() === h);
        if (idx("Entity") >= 0 && idx("Debit") >= 0 && idx("Account Code") >= 0) head = { entity: idx("Entity"), date: idx("Entry Date"), code: idx("Account Code"), debit: idx("Debit"), credit: idx("Credit") };
        return;
      }
      const entity = String(v[head.entity] ?? "").trim();
      const code = String(v[head.code] ?? "").trim();
      const date = v[head.date] instanceof Date ? (v[head.date] as Date) : null;
      if (!entity || !code || !date) return;
      const cents = (x: unknown) => (typeof x === "number" ? BigInt(Math.round(Number(x.toFixed(6)) * 100)) : x ? BigInt(Math.round(Number(String(x).replace(/,/g, "")) * 100)) : 0n);
      const k = `${entity}|${code}|${date.getUTCFullYear()}`;
      const cur = sums.get(k) ?? { cents: 0n, rows: 0 };
      cur.cents += cents(v[head.debit]) - cents(v[head.credit]);
      cur.rows++;
      sums.set(k, cur);
    });
  }
  return sums;
}

async function bukuBySource(db: Db, clientId: string) {
  const entities = await db.entity.findMany({ where: { clientId } });
  const lines = await db.journalLine.findMany({
    where: { entityId: { in: entities.map((e) => e.id) }, sourceAccountId: { not: null } },
    select: { entityId: true, date: true, debit: true, credit: true, sourceAccount: { select: { code: true } } },
  });
  const sums = new Map<Key, bigint>();
  for (const l of lines) {
    const e = entities.find((x) => x.id === l.entityId)!;
    const k = `${e.shortName}|${l.sourceAccount!.code}|${l.date.getUTCFullYear()}`;
    sums.set(k, (sums.get(k) ?? 0n) + l.debit - l.credit);
  }
  return { sums, entities };
}

// ─── Chickin ──────────────────────────────────────────────────────────────────

async function chickin(db: Db, intoApp: boolean) {
  const file = `${PRIVATE}/chickin.xlsx`;
  if (!existsSync(file)) return log(`Chickin: ${file} tidak ada.`);
  const firm = await firmFor(db, intoApp);
  const { client, entities } = await db.$transaction((tx) =>
    createClient(tx, firm.id, {
      name: intoApp ? "Chickin Group" : `Chickin Group (uji ${stamp()})`,
      industry: "agritech peternakan unggas",
      entities: [
        { name: "PT Sinergi Ketahanan Pangan", shortName: "SKP", kind: "PT", banks: [] },
        { name: "CSP", shortName: "CSP", kind: "PT", banks: [] },
        { name: "PT Chickin Ayam Hidup", shortName: "CAH", kind: "PT", banks: [] },
        { name: "PT Serikat Pangan Nusantara", shortName: "SPN", kind: "PT", banks: [] },
        { name: "Chickin Pte Ltd", shortName: "HOLDCO", kind: "PT", functionalCurrency: "SGD", banks: [] },
      ],
    }),
  );
  const holdco = entities[4].entity;
  log(`# Chickin — ${client.name}`);

  const ratesFile = `${PRIVATE}/rates.csv`;
  if (existsSync(ratesFile)) {
    const rows = readFileSync(ratesFile, "utf8").trim().split("\n").slice(1);
    for (const r of rows) {
      const [currency, quote, date, kind, rate, ...note] = r.split(",");
      const [y, m, d] = date.split("-").map(Number);
      await upsertRate(db, firm.id, { currency, quote, date: dateOnly(y, m, d), kind: kind as "SPOT" | "AVERAGE", rate, source: "FILE", note: note.join(",") || null });
    }
    log(`Kurs dari ${ratesFile}: ${rows.length} baris (sumber tertulis di kolom note; dikonfirmasi pemilik sebelum demo).`);
  } else log(`Kurs: ${ratesFile} tidak ada — Gabungan tidak bisa dijabarkan.`);

  const imports = [
    await runImport(db, firm.id, client.id, file, { sheet: "04_HC_2022_FOUNDATION", entityId: holdco.id, date: dateOnly(2022, 12, 31) }),
    await runImport(db, firm.id, client.id, file, { sheet: "20_OPCO_GL_MASTER" }),
    await runImport(db, firm.id, client.id, file, { sheet: "10_HC_GL_MASTER" }),
  ];
  log("\n## Impor");
  for (const [i, name] of ["04_HC_2022_FOUNDATION (neraca HoldCo 31 Des 2022)", "20_OPCO_GL_MASTER", "10_HC_GL_MASTER"].entries()) {
    const imp = imports[i];
    const by: Record<string, number> = {};
    for (const c of imp.checks) by[`${c.severity} ${c.code}`] = (by[`${c.severity} ${c.code}`] ?? 0) + 1;
    log(`- ${name}: ${imp.posted} jurnal, ${imp.sources} akun sumber (${imp.byRules} dipetakan aturan, ${imp.fallback.length} fallback per jenis)`);
    log(`  temuan: ${Object.entries(by).map(([k, n]) => `${k} ×${n}`).join(", ")}`);
  }

  // Buku vs independent recompute, per entity × account × year.
  log("\n## Buku vs rekalkulasi independen buku besar workbook (per entitas × akun sumber × tahun)");
  const expected = await recomputeLedger(file, ["04_HC_2022_FOUNDATION", "20_OPCO_GL_MASTER", "10_HC_GL_MASTER"].slice(1));
  const found = await bukuBySource(db, client.id);
  const foundation = await db.journalLine.findMany({ where: { entityId: holdco.id, entry: { kind: "OPENING" } }, select: { debit: true, credit: true, sourceAccount: { select: { code: true } } } });
  for (const l of foundation) {
    const k = `HOLDCO|${l.sourceAccount?.code}|2022`;
    found.sums.set(k, (found.sums.get(k) ?? 0n) - (l.debit - l.credit)); // foundation isn't in the GL sheets: leave it out of this comparison
    if (found.sums.get(k) === 0n) found.sums.delete(k);
  }
  const perEntity = new Map<string, { exact: number; rounding: number; mismatch: string[] }>();
  for (const k of new Set([...expected.keys(), ...found.sums.keys()])) {
    const [entity] = k.split("|");
    const cur = entities.find((e) => e.entity.shortName === entity)?.entity.functionalCurrency ?? "IDR";
    const exp = expected.get(k) ?? { cents: 0n, rows: 0 };
    const got = found.sums.get(k) ?? 0n;
    const gotCents = cur === "IDR" ? got * 100n : got;
    const diff = gotCents - exp.cents;
    const r = perEntity.get(entity) ?? { exact: 0, rounding: 0, mismatch: [] };
    if (diff === 0n) r.exact++;
    else if ((diff < 0n ? -diff : diff) <= BigInt(exp.rows) * 50n + 50n) r.rounding++;
    else r.mismatch.push(`${k}: buku ${formatMoney(gotCents, "SGD", { bare: true })} vs file ${formatMoney(exp.cents, "SGD", { bare: true })}`);
    perEntity.set(entity, r);
  }
  for (const [e, r] of [...perEntity].sort()) {
    const ok = r.mismatch.length === 0;
    if (!ok) failures++;
    log(`- ${e}: ${r.exact + r.rounding + r.mismatch.length} saldo dibandingkan · ${r.exact} sama persis · ${r.rounding} beda pembulatan sen · ${r.mismatch.length} tidak cocok ${ok ? "✓" : "✗"}`);
    for (const m of r.mismatch.slice(0, 10)) log(`    ${m}`);
  }

  // Buku's own statements per entity and the Gabungan.
  log("\n## Neraca Buku per entitas (akhir tahun)");
  for (const { entity } of entities) {
    for (const y of [2023, 2024, 2025]) {
      const bs = await balanceSheet(db, { clientId: client.id, entityIds: [entity.id] }, dateOnly(y, 12, 31));
      if (bs.totals.assets === 0n && bs.totals.liabilities === 0n && bs.totals.equity === 0n) continue;
      if (bs.totals.difference !== 0n) failures++;
      log(`- ${entity.shortName} ${y}: aset ${formatMoney(bs.totals.assets, entity.functionalCurrency)} · liabilitas ${formatMoney(bs.totals.liabilities, entity.functionalCurrency)} · ekuitas ${formatMoney(bs.totals.equity, entity.functionalCurrency)} · ${bs.totals.difference === 0n ? "seimbang ✓" : `selisih ${formatMoney(bs.totals.difference, entity.functionalCurrency)} ✗`}`);
    }
  }
  log("\n## Gabungan Grup (IDR)");
  for (const y of [2023, 2024, 2025]) {
    try {
      const ws = await combinedWorksheet(db, client.id, dateOnly(y, 12, 31));
      const sum = ws.rows.reduce((s, r) => s + r.combined, 0n);
      const cta = ws.rows.find((r) => r.code === "3900")?.combined ?? 0n;
      const bs = await balanceSheet(db, { clientId: client.id, entityIds: entities.map((e) => e.entity.id) }, dateOnly(y, 12, 31));
      if (sum !== 0n || bs.totals.difference !== 0n) failures++;
      log(`- ${y}: total aset ${formatMoney(bs.totals.assets, "IDR")} · selisih penjabaran ${formatMoney(-cta, "IDR")} · kertas kerja ${sum === 0n ? "seimbang ✓" : "tidak seimbang ✗"} · neraca ${bs.totals.difference === 0n ? "seimbang ✓" : "✗"}`);
    } catch (e) {
      if (e instanceof FxMissingError) log(`- ${y}: belum dijabarkan — ${e.missing.map((m) => `${m.entity} ${m.need}`).join("; ")}`);
      else throw e;
    }
  }

  // Register items the checks should catch.
  log("\n## Temuan konsultan yang tertangkap pemeriksaan otomatis");
  const all = imports.flatMap((i) => i.checks);
  const has = (code: string, re: RegExp) => all.some((c) => c.code === code && re.test(c.message));
  const register: [string, boolean | null][] = [
    ["CSP batch tidak seimbang ±Rp 5.000.000 (Mar/Des 2023)", has("UNBALANCED", /CSP .*2023.*5\.000\.000/)],
    ["Baris IDR di buku SGD HoldCo (HCO-SKP-FND-006, Rp 1.174.593.356)", has("FX_NO_RATE", /IDR di buku SGD/)],
    ["Kode SKP dipakai ulang antar tahun (FND-018: 21001/21002)", has("CODE_RENAMED", /Kode 2100[12] /)],
    ["Baris USD di buku SGD tanpa kurs (metode 'pooling')", has("FX_NO_RATE", /USD di buku SGD/)],
    ["Selisih pembulatan WP audit CAH (±Rp 1)", has("UNBALANCED", /CAH .*Rp 1 /)],
    ["APIC 31009 #VALUE! di SKP 2025 (SKP-SRC-006)", null],
  ];
  for (const [label, ok] of register) log(`- ${ok === null ? "–" : ok ? "✓" : "✗"} ${label}${ok === null ? " (sel #VALUE! ada di file sumber SKP 2025.xlsx, bukan di buku besar workbook ini)" : ""}`);
  const newOnes = all.filter((c) => c.code === "UNBALANCED" && /HOLDCO .*400,00/.test(c.message));
  if (newOnes.length) log(`- Baru (tidak ada di register): HoldCo ±S$ 400 terpisah di 14/15 Mei 2025.`);
}

// ─── Goers ────────────────────────────────────────────────────────────────────

async function goers(db: Db, intoApp: boolean) {
  const file = `${PRIVATE}/goers-neraca-2026-05.xlsx`;
  if (!existsSync(file)) return log(`Goers: ${file} tidak ada.`);
  const firm = await firmFor(db, intoApp);
  const { client, entities } = await db.$transaction((tx) =>
    createClient(tx, firm.id, { name: intoApp ? "Goers" : `Goers (uji ${stamp()})`, industry: "platform tiket acara", entities: [{ name: "PT Sanraya Adi Nattaya", shortName: "Goers", kind: "PT", banks: [] }] }),
  );
  log(`\n# Goers — ${client.name}`);
  const imp = await runImport(db, firm.id, client.id, file, { entityId: entities[0].entity.id });
  log(`- Neraca 31 Mei 2026 → saldo awal: ${imp.sources} akun (${imp.byRules} dipetakan aturan, fallback: ${imp.fallback.join(", ") || "-"})`);
  const totals = imp.checks.filter((c) => c.code === "TOTAL_OK" || c.code === "TOTAL_MISMATCH");
  for (const t of totals) {
    if (t.code === "TOTAL_MISMATCH") failures++;
    log(`- ${t.code === "TOTAL_OK" ? "✓" : "✗"} ${t.message}`);
  }
  const bs = await balanceSheet(db, { clientId: client.id, entityIds: [entities[0].entity.id] }, dateOnly(2026, 5, 31));
  log(`- Neraca Buku 31 Mei 2026: aset ${formatMoney(bs.totals.assets, "IDR")} · liabilitas + ekuitas ${formatMoney(bs.totals.liabilities + bs.totals.equity, "IDR")} · ${bs.totals.difference === 0n ? "seimbang ✓" : "✗"}`);
}

// ─── SMBC ─────────────────────────────────────────────────────────────────────

async function smbc() {
  const file = `${PRIVATE}/smbc-mei-2026.pdf`;
  if (!existsSync(file)) return log(`SMBC: ${file} tidak ada.`);
  log(`\n# SMBC — ${file.split("/").pop()}`);
  const sections = await parseStatementSections(file, readFileSync(file), { password: process.env.PDF_PASSWORD });
  for (const s of sections) {
    const c = checkContinuity(s);
    if (!c.ok) failures++;
    log(`- ${s.section?.label ?? "rekening"} (${s.section?.currency ?? "IDR"}) ${s.accountNumber}: ${s.rows.length} baris · saldo awal ${formatMoney(s.openingBalance, "IDR")} → akhir ${formatMoney(s.closingBalance, "IDR")} · ${c.ok ? "NYAMBUNG ✓" : `ADA CELAH ✗ ${c.note}`}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const which = args.find((a) => !a.startsWith("--")) ?? "all";
  const intoApp = args.includes("--into-app");
  const db = createPrisma();
  try {
    if (which === "chickin" || which === "all") await chickin(db, intoApp);
    if (which === "goers" || which === "all") await goers(db, intoApp);
    if (which === "smbc" || which === "all") await smbc();
  } finally {
    await db.$disconnect();
  }
  mkdirSync(`${PRIVATE}/reports`, { recursive: true });
  const path = `${PRIVATE}/reports/verify-real-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.md`;
  writeFileSync(path, out.join("\n") + "\n");
  console.log(`\n${failures ? `✗ ${failures} pemeriksaan gagal` : "✓ Semua pemeriksaan lolos"} — laporan: ${path} (jangan di-commit)`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
