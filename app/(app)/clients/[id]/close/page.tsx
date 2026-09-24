import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { CLOSE_SIGNOFFS, closeReadiness, runControls } from "@/lib/controls";
import { formatDate, formatPeriod } from "@/lib/format";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { ScopeBar } from "@/components/app/scope-bar";
import { ClosePanel } from "@/components/app/close-panel";

export default async function ClosePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, periodOptions, base } = await loadClientPage(params, searchParams);
  const controls = await runControls(prisma, client.id, period.year, period.month);
  const p = await prisma.period.findUnique({ where: { clientId_year_month: { clientId: client.id, year: period.year, month: period.month } }, include: { signoffs: true } });
  const done = p?.signoffs.map((s) => s.key) ?? [];
  const r = closeReadiness(controls, done);
  // One line per kind of blocker, not one per control — the list on the left already has the detail.
  const blockers = [
    r.fails.length ? `${r.fails.length} kontrol gagal, perbaiki dulu` : "",
    r.unacked.length ? `${r.unacked.length} kontrol perlu dicek dan diberi catatan` : "",
    r.missing.length ? `${r.missing.length} checklist belum dicentang` : "",
  ].filter(Boolean);
  const label = formatPeriod(period.year, period.month);
  const open = controls.find((c) => c.key === "suspense" && c.status === "REVIEW");
  const missing = controls.find((c) => c.key.startsWith("bank:") && c.detail.includes("belum diimpor"));
  const locked = p?.status === "LOCKED";

  return (
    <div className="space-y-6">
      <PageHeader title="Tutup Buku" description={`${client.name} · ${label}`} actions={<ScopeBar entities={[]} periods={periodOptions} period={period.key} />} />
      {locked ? (
        <NextStep tone="done">Buku {label} sudah ditutup. Laporan siap dikirim ke klien.</NextStep>
      ) : missing ? (
        <NextStep href={`${base}/import`} cta="Impor mutasi">{missing.title.replace("Rekonsiliasi", "Mutasi")} belum diimpor. Beberapa kontrol baru bisa lolos setelah mutasinya masuk.</NextStep>
      ) : open ? (
        <NextStep href={`${base}/review`} cta="Mulai review">{open.detail}.</NextStep>
      ) : r.unacked.length ? (
        <NextStep>Cek kontrol yang ditandai “Perlu dicek”, lalu beri catatan kenapa wajar.</NextStep>
      ) : r.missing.length ? (
        <NextStep>Centang checklist di kanan setelah Anda memeriksanya.</NextStep>
      ) : (
        <NextStep>Semua kontrol lolos dan checklist lengkap. Tutup buku {label}.</NextStep>
      )}
      <ClosePanel
        clientId={client.id}
        year={period.year}
        month={period.month}
        periodLabel={label}
        controls={controls}
        signoffs={CLOSE_SIGNOFFS.map((s) => ({ key: s.key, label: s.label, done: done.includes(s.key) }))}
        locked={locked}
        lockedAt={p?.lockedAt ? formatDate(p.lockedAt) : null}
        blockers={blockers}
      />
    </div>
  );
}
