import { requireWorkspaceSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { resolveAiConfig } from "@/lib/settings/ai";
import { monthlyAiUse } from "@/lib/ai/budget";
import { settingsSecretConfigured } from "@/lib/settings/secret";
import { PageHeader, NextStep } from "@/components/app/page-header";
import { AiSettingsForm } from "@/components/app/ai-settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { planRejections } from "@/lib/evidence/plan-stats";
import { ocrEnabled } from "@/lib/ocr/draft";
import { OcrSettingCard } from "@/components/app/ocr-setting";
import { isAdminRole } from "@/lib/auth/permissions";
import { LinkTabs } from "@/components/app/link-tabs";
import { TeamCard } from "@/components/app/team-card";
import { listTeam } from "@/lib/team";
import type { SearchParams } from "@/lib/scope";

export const metadata = { title: "Pengaturan" };

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { firm, member } = await requireWorkspaceSession();
  const isAdmin = isAdminRole(member.role);
  // Tim (ADR 0017 §5): owners and admins manage people here; other roles see only the general section.
  const tab = (await searchParams).tab === "tim" && isAdmin ? "tim" : "umum";
  const tabs = isAdmin ? <LinkTabs label="Bagian pengaturan" items={[{ href: "/settings", label: "Umum", active: tab === "umum" }, { href: "/settings?tab=tim", label: "Tim", active: tab === "tim" }]} /> : null;
  if (tab === "tim") {
    const team = await listTeam(prisma, firm.id);
    return (
      <div className="space-y-6">
        <PageHeader title="Pengaturan" description="Berlaku untuk semua klien di kantor ini." />
        {tabs}
        <NextStep>{team.kind === "PERUSAHAAN" ? "Undang anggota tim dan pilih perannya." : "Undang anggota tim, pilih perannya, lalu tugaskan klien untuk akuntan dan peninjau."}</NextStep>
        <TeamCard
          members={team.members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, disabled: m.disabled, clientIds: m.clientAccess.map((a) => a.clientId) }))}
          clients={team.clients}
          me={{ id: member.id, role: member.role }}
          company={team.kind === "PERUSAHAAN"}
          seatLimit={team.seatLimit}
        />
      </div>
    );
  }
  const [cfg, lastCall, plans, ocr] = await Promise.all([resolveAiConfig(prisma), prisma.aiUsage.findFirst({ where: { firmId: firm.id, model: { not: "demo-seed" } }, orderBy: { at: "desc" } }), planRejections(prisma, firm.id), ocrEnabled(prisma)]);
  const secretReady = settingsSecretConfigured();
  const live = Boolean(cfg.apiKey && cfg.model);

  return (
    <div className="space-y-6">
      <PageHeader title="Pengaturan" description="Berlaku untuk semua klien di kantor ini." />
      {tabs}
      {!isAdmin ? (
        <NextStep>Hanya admin kantor yang dapat mengubah pengaturan ini. Anda bisa melihat statusnya di bawah.</NextStep>
      ) : !secretReady ? (
        <NextStep>
          Pengaturan belum bisa diubah karena kunci keamanan server belum disiapkan. Hubungi pengelola aplikasi.
        </NextStep>
      ) : cfg.keyError ? (
        <NextStep>{cfg.keyError}</NextStep>
      ) : !live ? (
        <NextStep>Tempel kunci API dan pilih model untuk menyalakan usulan AI. Tanpa kunci, Buku tetap bekerja dengan aturan.</NextStep>
      ) : (
        <NextStep tone="done">Usulan AI aktif. Semua usulan tetap masuk Review transaksi sebelum dicatat.</NextStep>
      )}
      <AiSettingsForm
        status={{
          live,
          keyLast4: cfg.keyLast4,
          keySource: cfg.keySource,
          model: cfg.model || null,
          modelSource: cfg.modelSource,
          gatewayHost: new URL(cfg.baseUrl).host,
          maxCallsPerImport: cfg.maxCallsPerImport,
          monthlyTokenBudget: cfg.monthlyTokenBudget,
          monthlyTokensUsed: (await monthlyAiUse(prisma, firm.id)).spent,
          lastCall: lastCall && { at: formatDateTime(lastCall.at), ok: lastCall.ok, model: lastCall.model, note: lastCall.note },
        }}
        canSave={isAdmin && secretReady}
      />
      <OcrSettingCard enabled={ocr} canSave={isAdmin} aiLive={live} />
      <Card>
        <CardHeader>
          <CardTitle>Rencana jawaban AI</CardTitle>
          <CardDescription>Pertanyaan di Dokumen memakai AI untuk merencanakan pencarian. Rencana yang tidak valid ditolak dan diganti pencarian biasa.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm" data-testid="plan-rejections">
          {plans.requested === 0
            ? `Belum ada rencana jawaban AI dalam ${plans.days} hari terakhir.`
            : `${plans.days} hari terakhir: ${plans.requested} rencana diminta, ${plans.rejected} ditolak (${Math.round(plans.rate * 100)}%).`}
        </CardContent>
      </Card>
    </div>
  );
}
