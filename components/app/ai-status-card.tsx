import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/app/status";

/**
 * What an organisation sees of the AI (ADR 0017 §6): whether it is on, which model, and its own monthly use. The key and the
 * provider are Buku's and are set in the backoffice; nothing here can change them.
 */
export function AiStatusCard({ live, model, used, limit, lastCall }: { live: boolean; model: string | null; used: number; limit: number; lastCall: { at: string; ok: boolean } | null }) {
  const n = (v: number) => v.toLocaleString("id-ID");
  return (
    <Card data-testid="ai-status">
      <CardHeader>
        <CardTitle>AI untuk usulan akun</CardTitle>
        <CardDescription>Disediakan dan diatur oleh Buku. Usulan AI hanya untuk mutasi yang belum dikenali aturan atau memori, dan selalu masuk Review transaksi.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Status</dt><dd className="mt-1"><StatusPill status={live ? "PASS" : "REVIEW"} label={live ? "Aktif" : "Aturan saja"} /></dd></div>
          <div><dt className="text-muted-foreground">Model</dt><dd className="mt-1 font-medium break-all">{live && model ? model : "–"}</dd></div>
          <div>
            <dt className="text-muted-foreground">Pemakaian bulan ini</dt>
            <dd className="mt-1"><span className="num font-medium" data-testid="ai-monthly-use">{n(used)} dari {n(limit)} token</span>
              {lastCall && <span className="block text-xs text-muted-foreground">Terakhir {lastCall.at} · {lastCall.ok ? "berhasil" : "gagal"}</span>}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
