import type { Db } from "@/lib/db";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { formatRupiah, periodBounds } from "@/lib/format";
import { balanceSheet, combinedWorksheet, trialBalance } from "@/lib/reports/ledger";

/**
 * Close controls (analog of belifi 16_CONTROLS). PASS / REVIEW / FAIL.
 * REVIEW ≠ bug: it needs a human note to acknowledge. FAIL blocks Tutup Buku.
 */
export type ControlStatus = "PASS" | "REVIEW" | "FAIL";
export type Control = {
  key: string;
  title: string;
  scope: string;
  status: ControlStatus;
  detail: string;
  href?: string;
  ack?: string | null;
};

export async function runControls(db: Db, clientId: string, year: number, month: number): Promise<Control[]> {
  const { start, end } = periodBounds(year, month);
  const entities = (
    await db.entity.findMany({ where: { clientId }, include: { bankAccounts: { include: { account: true } } }, orderBy: { name: "asc" } })
  ).sort((a, b) => Number(a.kind === "PERORANGAN") - Number(b.kind === "PERORANGAN")); // companies first
  const period = await db.period.findUnique({ where: { clientId_year_month: { clientId, year, month } }, include: { acks: true } });
  const acks = new Map(period?.acks.map((a) => [a.controlKey, a.note]) ?? []);
  const controls: Control[] = [];
  const base = `/clients/${clientId}`;
  const clientScope = entities.length > 1 ? "Grup" : (entities[0]?.shortName ?? "Klien");

  for (const e of entities) {
    const scope = { clientId, entityIds: [e.id] };
    const tb = await trialBalance(db, scope, end);
    const dr = tb.reduce((s, r) => s + r.debit, 0n);
    const cr = tb.reduce((s, r) => s + r.credit, 0n);
    controls.push({
      key: `tb:${e.id}`,
      title: "Neraca saldo seimbang",
      scope: e.shortName,
      status: dr === cr ? "PASS" : "FAIL",
      detail: dr === cr ? `Debit = kredit = ${formatRupiah(dr)}` : `Selisih ${formatRupiah(dr - cr)}`,
      href: `${base}/trial-balance?entity=${e.id}`,
    });
    const bs = await balanceSheet(db, scope, end);
    controls.push({
      key: `bs:${e.id}`,
      title: "Neraca: aset = liabilitas + ekuitas",
      scope: e.shortName,
      status: bs.totals.difference === 0n ? "PASS" : "FAIL",
      detail: bs.totals.difference === 0n ? `Total aset ${formatRupiah(bs.totals.assets)}` : `Selisih ${formatRupiah(bs.totals.difference)}`,
      href: `${base}/reports?entity=${e.id}`,
    });

    for (const ba of e.bankAccounts) {
      const lastTx = await db.bankTransaction.findFirst({
        where: { bankAccountId: ba.id, date: { lte: end }, balance: { not: null } },
        orderBy: [{ date: "desc" }, { rowNumber: "desc" }],
      });
      const coverage = await db.statementImport.findMany({ where: { bankAccountId: ba.id, periodStart: { lte: end }, periodEnd: { gte: start } } });
      const glRow = tb.find((r) => r.account.id === ba.accountId);
      const gl = glRow?.net ?? 0n;
      const key = `bank:${ba.id}`;
      if (coverage.length === 0) {
        controls.push({ key, title: `Rekonsiliasi ${ba.label}`, scope: e.shortName, status: "REVIEW", detail: "Mutasi bulan ini belum diimpor", href: `${base}/import`, ack: acks.get(key) });
        continue;
      }
      const stmt = lastTx?.balance ?? coverage[coverage.length - 1].closingBalance;
      const ok = stmt === gl;
      controls.push({
        key,
        title: `Rekonsiliasi ${ba.label}`,
        scope: e.shortName,
        status: ok ? "PASS" : "FAIL",
        detail: ok ? `Saldo bank = buku besar = ${formatRupiah(gl)}` : `Bank ${formatRupiah(stmt)} vs buku besar ${formatRupiah(gl)}`,
        href: `${base}/ledger/${ba.account.code}?entity=${e.id}`,
      });
      const broken = coverage.filter((c) => !c.continuityOk);
      const ckey = `cont:${ba.id}`;
      controls.push({
        key: ckey,
        title: `Kelengkapan mutasi ${ba.label}`,
        scope: e.shortName,
        status: broken.length ? "REVIEW" : "PASS",
        detail: broken.length ? broken.map((b) => `${b.fileName}: ${b.continuityNote}`).join("; ") : "Saldo berjalan nyambung dari awal ke akhir",
        ack: acks.get(ckey),
      });
    }

    const clearing = tb.find((r) => r.account.code === ACCOUNT_CODES.CLEARING)?.net ?? 0n;
    const clKey = `clearing:${e.id}`;
    controls.push({
      key: clKey,
      title: "Kliring transfer (1199) = 0",
      scope: e.shortName,
      status: clearing === 0n ? "PASS" : "REVIEW",
      detail: clearing === 0n ? "Semua transfer antar rekening berpasangan" : `Sisa ${formatRupiah(clearing)} — ada transfer yang pasangannya belum diimpor`,
      href: `${base}/ledger/${ACCOUNT_CODES.CLEARING}?entity=${e.id}`,
      ack: acks.get(clKey),
    });
  }

  const open = await db.bankTransaction.count({ where: { bankAccount: { entity: { clientId } }, status: "NEEDS_REVIEW", date: { lte: end } } });
  controls.push({
    key: "suspense",
    title: "Semua mutasi terklasifikasi (1999)",
    scope: clientScope,
    status: open === 0 ? "PASS" : "REVIEW",
    detail: open === 0 ? "Semua mutasi sudah diklasifikasi" : `${open} transaksi menunggu review`,
    href: `${base}/review`,
    ack: acks.get("suspense"),
  });

  if (entities.length > 1) {
    const ws = await combinedWorksheet(db, clientId, end);
    controls.push({
      key: "intercompany",
      title: "Antar entitas (1190) tereliminasi",
      scope: "Grup",
      status: ws.residual === 0n ? "PASS" : "REVIEW",
      detail: ws.residual === 0n ? `Tereliminasi ${formatRupiah(ws.matched)}` : `Selisih ${formatRupiah(ws.residual)} antar entitas belum cocok`,
      href: `${base}/reports?entity=combined`,
      ack: acks.get("intercompany"),
    });
  }
  return controls;
}

export const CLOSE_SIGNOFFS = [
  { key: "docs", label: "Bukti pendukung transaksi besar sudah diperiksa" },
  { key: "adjust", label: "Jurnal penyesuaian (penyusutan, akrual) sudah dicatat" },
  { key: "review", label: "Laporan keuangan sudah direview partner" },
] as const;

export class CloseError extends Error {}

export function closeReadiness(controls: Control[], signoffs: string[]) {
  const fails = controls.filter((c) => c.status === "FAIL");
  const unacked = controls.filter((c) => c.status === "REVIEW" && !c.ack);
  const missing = CLOSE_SIGNOFFS.filter((s) => !signoffs.includes(s.key));
  return { ready: fails.length === 0 && unacked.length === 0 && missing.length === 0, fails, unacked, missing };
}

export async function lockPeriod(db: Db, clientId: string, year: number, month: number, note: string) {
  const controls = await runControls(db, clientId, year, month);
  const period = await db.period.upsert({
    where: { clientId_year_month: { clientId, year, month } },
    create: { firmId: (await db.client.findUniqueOrThrow({ where: { id: clientId } })).firmId, clientId, year, month },
    update: {},
    include: { signoffs: true },
  });
  const r = closeReadiness(controls, period.signoffs.map((s) => s.key));
  if (!r.ready) {
    const why = [
      r.fails.length ? `${r.fails.length} kontrol GAGAL` : "",
      r.unacked.length ? `${r.unacked.length} kontrol REVIEW belum diberi catatan` : "",
      r.missing.length ? `${r.missing.length} checklist belum dicentang` : "",
    ].filter(Boolean);
    throw new CloseError(`Belum bisa tutup buku: ${why.join(", ")}.`);
  }
  return db.period.update({ where: { id: period.id }, data: { status: "LOCKED", lockedAt: new Date(), lockNote: note } });
}
