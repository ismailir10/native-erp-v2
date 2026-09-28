import type { Db } from "@/lib/db";
import { sourceSuspenseNet } from "@/lib/controls/suspense-net";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { periodBounds } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { FxMissingError } from "@/lib/reports/fx";
import { revaluationProposals } from "@/lib/fx/revalue";
import { balanceSheet, combinedWorksheet, trialBalance } from "@/lib/reports/ledger";
import { sanityControls } from "@/lib/controls/sanity";
import { anomalyControls } from "@/lib/controls/anomaly";
import { closeLock, dueProposals, schedulesDueBy } from "@/lib/adjust/schedules";
import { registerVsLedger } from "@/lib/assets/register";
import { subledgerVsLedger } from "@/lib/receivables/aging";

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
    const fmt = (v: bigint) => formatMoney(v, e.functionalCurrency);
    const tb = await trialBalance(db, scope, end);
    const dr = tb.reduce((s, r) => s + r.debit, 0n);
    const cr = tb.reduce((s, r) => s + r.credit, 0n);
    controls.push({
      key: `tb:${e.id}`,
      title: "Neraca saldo seimbang",
      scope: e.shortName,
      status: dr === cr ? "PASS" : "FAIL",
      detail: dr === cr ? `Debit = kredit = ${fmt(dr)}` : `Selisih ${fmt(dr - cr)}`,
      href: `${base}/trial-balance?entity=${e.id}`,
    });
    const bs = await balanceSheet(db, scope, end);
    controls.push({
      key: `bs:${e.id}`,
      title: "Neraca: aset = liabilitas + ekuitas",
      scope: e.shortName,
      status: bs.totals.difference === 0n ? "PASS" : "FAIL",
      detail: bs.totals.difference === 0n ? `Total aset ${fmt(bs.totals.assets)}` : `Selisih ${fmt(bs.totals.difference)}`,
      href: `${base}/reports?entity=${e.id}`,
    });

    let statementMissing = false;
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
        statementMissing = true;
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
        detail: ok ? `Saldo bank = buku besar = ${fmt(gl)}` : `Bank ${fmt(stmt)} vs buku besar ${fmt(gl)}`,
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
      detail: clearing === 0n ? "Semua transfer antar rekening berpasangan" : `Sisa ${fmt(clearing)}. Ada transfer yang pasangannya belum diimpor`,
      href: `${base}/ledger/${ACCOUNT_CODES.CLEARING}?entity=${e.id}`,
      ack: acks.get(clKey),
    });

    const sane = [
      ...(await sanityControls(db, { clientId, entity: e, tb, start, end, base, acks, statementMissing })),
      ...(await anomalyControls(db, { clientId, entity: e, year, month, base, acks })),
    ];
    controls.push(
      ...(sane.length
        ? sane
        : [{ key: `sanity:${e.id}`, title: "Kewajaran pembukuan", scope: e.shortName, status: "PASS" as const, detail: "Tidak ada saldo janggal, pembiayaan di Laba Rugi, bulan kosong, tebakan yang diterima begitu saja, fluktuasi atau jurnal ganda" }]),
    );

    // Adjustment schedules (rule 5a): an installment of this month not yet posted needs the click or a note.
    const due = await dueProposals(db, clientId, year, month, e.id);
    if (due.length) {
      const sKey = `sched:${e.id}`;
      const list = due.slice(0, 3).map((p) => `${p.memo} ${fmt(p.installment.amount)}`);
      controls.push({
        key: sKey,
        title: "Jurnal terjadwal belum dicatat",
        scope: e.shortName,
        status: "REVIEW",
        detail: `${due.length} angsuran: ${list.join("; ")}${due.length > 3 ? `; +${due.length - 3} lainnya` : ""}`,
        href: `${base}/journals/new?period=${year}-${String(month).padStart(2, "0")}`,
        ack: acks.get(sKey),
      });
    }

    // Fixed-asset register (rule 5b): its cost and accumulated depreciation against the GL accounts it uses, for entities with assets.
    const [fa] = await registerVsLedger(db, clientId, year, month, [e.id]);
    if (fa) {
      const faKey = `fa:${e.id}`;
      const diff = [
        fa.register.cost !== fa.ledger.cost ? `Harga perolehan: daftar ${fmt(fa.register.cost)} vs buku besar ${fmt(fa.ledger.cost)} (${fa.assetAccounts.join(", ")})` : "",
        fa.register.accumulated !== fa.ledger.accumulated ? `Akumulasi penyusutan: daftar ${fmt(fa.register.accumulated)} vs buku besar ${fmt(fa.ledger.accumulated)} (${fa.accumulatedAccounts.join(", ")})` : "",
      ].filter(Boolean);
      controls.push({
        key: faKey,
        title: "Daftar aset tetap = buku besar",
        scope: e.shortName,
        status: fa.equal ? "PASS" : "REVIEW",
        detail: fa.equal ? `Harga perolehan ${fmt(fa.register.cost)}, akumulasi penyusutan ${fmt(fa.register.accumulated)}` : `${diff.join("; ")}. Aset yang belum didaftarkan atau jurnal manual di akun aset menjelaskan selisih ini`,
        href: `${base}/assets?period=${year}-${String(month).padStart(2, "0")}&entity=${e.id}`,
        ack: acks.get(faKey),
      });
    }

    // Receivable/payable subledger (rule 5c): open invoices against the GL accounts they use, for entities with invoices.
    for (const direction of ["SALES", "PURCHASE"] as const) {
      const [sub] = await subledgerVsLedger(db, clientId, direction, end, [e.id]);
      if (!sub) continue;
      const sales = direction === "SALES";
      const key = `${sales ? "ar" : "ap"}:${e.id}`;
      const what = sales ? "Piutang" : "Utang";
      controls.push({
        key,
        title: sales ? "Piutang usaha = daftar faktur" : "Utang usaha = daftar tagihan",
        scope: e.shortName,
        status: sub.equal ? "PASS" : "REVIEW",
        detail: sub.equal
          ? `${what} terbuka ${fmt(sub.subledger)} (${sub.accounts.join(", ")})`
          : `${what} terbuka: daftar ${fmt(sub.subledger)} vs buku besar ${fmt(sub.ledger)} (${sub.accounts.join(", ")})${sub.unsettledLines ? `; ${sub.unsettledLines} mutasi bank di akun itu belum dicocokkan ke faktur` : ""}`,
        href: `${base}/receivables?period=${year}-${String(month).padStart(2, "0")}&entity=${e.id}&tab=${sales ? "piutang" : "utang"}`,
        ack: acks.get(key),
      });
    }
  }

  // Ledger / Neraca imports (rule 15a): accepted source differences stay FAIL until 1999 is cleared; REVIEW checks need a note.
  const imports = await db.ledgerImport.findMany({
    where: { clientId, status: "POSTED", periodStart: { lte: end }, periodEnd: { gte: start } },
    include: { checks: true },
    orderBy: { createdAt: "asc" },
  });
  for (const imp of imports) {
    const inPeriod = (d: Date | null) => (d ? +d >= +start && +d <= +end : +imp.periodEnd >= +start && +imp.periodEnd <= +end);
    const checks = imp.checks.filter((c) => c.severity !== "INFO" && inPeriod(c.date));
    const accepted = checks.filter((c) => c.severity === "BLOCK" && c.accepted);
    const reviews = checks.filter((c) => c.severity === "REVIEW");
    let open = 0;
    for (const c of accepted) {
      // Bank lines waiting in Review also sit on 1999; they are the `suspense` control's, not this file's.
      const entityIds = c.entityId ? [c.entityId] : (await db.entity.findMany({ where: { clientId }, select: { id: true } })).map((e) => e.id);
      for (const id of entityIds) if ((await sourceSuspenseNet(db, id, end)) !== 0n) { open++; break; }
    }
    const key = `ledger:${imp.id}`;
    const parts = [
      open ? `${open} selisih dari file sumber masih di 1999, koreksi lewat Usulan jurnal koreksi di Tutup Buku` : accepted.length ? `${accepted.length} selisih sumber sudah dikoreksi` : "",
      reviews.length ? `${reviews.length} temuan perlu dicek` : "",
      imp.roundingTotal ? `pembulatan sen ke 7190 total ${formatMoney(imp.roundingTotal, "IDR")}` : "",
    ].filter(Boolean);
    controls.push({
      key,
      title: `Impor ${imp.mode === "NERACA" ? "neraca" : "buku besar"} ${imp.sheetName}`,
      scope: clientScope,
      status: open ? "FAIL" : reviews.length ? "REVIEW" : "PASS",
      detail: parts.join(" · ") || "Tidak ada temuan untuk periode ini",
      href: `${base}/import/ledger/${imp.id}`,
      ack: acks.get(key),
    });
  }

  // FX revaluation (rule 6b): REVIEW until the month-end difference is posted or rates are filled in.
  for (const p of await revaluationProposals(db, clientId, year, month)) {
    const key = `reval:${p.entityId}`;
    const pending = p.lines.reduce((s, l) => s + l.diff, 0n);
    controls.push({
      key,
      title: "Revaluasi kurs saldo valas",
      scope: p.entityName,
      status: p.missingRates.length || p.lines.length ? "REVIEW" : "PASS",
      detail: p.missingRates.length
        ? `Isi ${p.missingRates.join(", ")}`
        : p.lines.length
          ? `${p.lines.length} saldo valas belum dinilai ulang (selisih bersih ${formatMoney(pending, p.functional)} ke 7200)`
          : "Saldo valas sudah dinilai dengan kurs penutup",
      href: p.missingRates.length ? `${base}/rates` : `${base}/close?period=${year}-${String(month).padStart(2, "0")}`,
      ack: acks.get(key),
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
    const ws = await combinedWorksheet(db, clientId, end).catch((e) => {
      if (e instanceof FxMissingError) return e;
      throw e;
    });
    if (ws instanceof FxMissingError) {
      controls.push({
        key: "fx-translation",
        title: "Kurs penjabaran ke Rupiah lengkap",
        scope: "Grup",
        status: "REVIEW",
        detail: ws.missing.map((m) => `${m.entity}: ${m.need}`).join("; "),
        href: `${base}/rates`,
        ack: acks.get("fx-translation"),
      });
      return controls;
    }
    const idr = (v: bigint) => formatMoney(v, ws.translated ? "IDR" : (entities[0]?.functionalCurrency ?? "IDR"));
    controls.push({
      key: "intercompany",
      title: "Antar entitas (1190) tereliminasi",
      scope: "Grup",
      status: ws.residual === 0n ? "PASS" : "REVIEW",
      detail: ws.residual === 0n ? `Tereliminasi ${idr(ws.matched)}` : `Selisih ${idr(ws.residual)} antar entitas belum cocok`,
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

export async function lockPeriod(db: Db, clientId: string, year: number, month: number, note: string, actorId?: string | null) {
  // Schedules due by this month known before the controls run: one created meanwhile was never checked, so the lock refuses (rule 5a).
  const known = new Set(await schedulesDueBy(db, clientId, year, month));
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
      r.fails.length ? `${r.fails.length} kontrol gagal` : "",
      r.unacked.length ? `${r.unacked.length} kontrol Perlu dicek belum diberi catatan` : "",
      r.missing.length ? `${r.missing.length} checklist belum dicentang` : "",
    ].filter(Boolean);
    throw new CloseError(`Belum bisa tutup buku: ${why.join(", ")}.`);
  }
  return db.$transaction(async (tx) => {
    await closeLock(tx, clientId);
    if ((await schedulesDueBy(tx, clientId, year, month)).some((id) => !known.has(id))) {
      throw new CloseError("Jadwal penyesuaian baru yang jatuh tempo sampai bulan ini ditambahkan saat tutup buku berjalan. Muat ulang halaman, periksa kontrolnya, lalu tutup lagi.");
    }
    return tx.period.update({ where: { id: period.id }, data: { status: "LOCKED", lockedAt: new Date(), lockNote: note, lockedById: actorId ?? null } });
  });
}
