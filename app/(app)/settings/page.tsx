import { getCurrentFirm } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { resolveAiConfig } from "@/lib/settings/ai";
import { adminPasscodeConfigured, settingsSecretConfigured } from "@/lib/settings/secret";
import { PageHeader, NextStep } from "@/components/app/page-header";
import { AiSettingsForm } from "@/components/app/ai-settings-form";

export default async function SettingsPage() {
  const firm = await getCurrentFirm();
  const [cfg, lastCall] = await Promise.all([resolveAiConfig(prisma), prisma.aiUsage.findFirst({ where: { firmId: firm.id, model: { not: "demo-seed" } }, orderBy: { at: "desc" } })]);
  const missing = [!adminPasscodeConfigured() && "ADMIN_PASSCODE", !settingsSecretConfigured() && "SETTINGS_SECRET"].filter(Boolean) as string[];
  const live = Boolean(cfg.apiKey && cfg.model);

  return (
    <div className="space-y-6">
      <PageHeader title="Pengaturan" description="Berlaku untuk semua klien di kantor ini." />
      {missing.length > 0 ? (
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
          lastCall: lastCall && { at: formatDateTime(lastCall.at), ok: lastCall.ok, model: lastCall.model, note: lastCall.note },
        }}
        canSave={missing.length === 0}
      />
    </div>
  );
}
