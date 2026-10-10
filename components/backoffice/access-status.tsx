import { StatusPill } from "@/components/app/status";
import type { Access } from "@/lib/access/grant";
import { formatDateWib } from "@/lib/format";

/** An organisation's access as icon + label (ui-rules 6): running, ending within a week, read-only, closed. */
export function AccessStatus({ access, suspended }: { access: Access; suspended: boolean }) {
  if (suspended) return <StatusPill status="FAIL" label="Ditangguhkan" />;
  if (access.state === "NONE") return <StatusPill status="FAIL" label="Ditutup" />;
  if (access.state === "READ_ONLY") return <StatusPill status="REVIEW" label={`Hanya baca sejak ${access.endsAt ? formatDateWib(access.endsAt) : "-"}`} />;
  const what = access.kind === "TRIAL" ? "Uji coba" : access.kind === "PAID" ? "Berbayar" : "Gratis";
  if (!access.endsAt) return <StatusPill status="PASS" label={`${what} · tanpa batas`} />;
  const label = `${what} · s.d. ${formatDateWib(access.endsAt)}${access.daysLeft !== null && access.daysLeft <= 7 ? ` (${access.daysLeft === 0 ? "hari ini" : `${access.daysLeft} hari`})` : ""}`;
  return <StatusPill status={access.daysLeft !== null && access.daysLeft <= 7 ? "REVIEW" : "PASS"} label={label} />;
}
