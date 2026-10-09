import type { GrantKind } from "@/lib/generated/prisma/enums";

/**
 * An organisation's access, computed from its grants at the moment of the request (ADR 0017 §3). Never stored.
 * - ACTIVE: an unrevoked grant covers now.
 * - READ_ONLY: grants had started, all have ended — read and export, nothing else.
 * - NONE: no grant has started, every grant is revoked, or the organisation is suspended.
 */
export type AccessState = "ACTIVE" | "READ_ONLY" | "NONE";

export type GrantLike = { kind: GrantKind; startsAt: Date; endsAt: Date | null; revokedAt: Date | null };

export type Access = {
  state: AccessState;
  /** ACTIVE: when access ends (null = no end). READ_ONLY: when it ended. NONE: null. */
  endsAt: Date | null;
  /** ACTIVE with an end: whole Jakarta days left after today (0 = ends today). Otherwise null. */
  daysLeft: number | null;
  /** The grant deciding the state (the one running longest), for wording such as "Uji coba". */
  kind: GrantKind | null;
};

const WIB_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The last instant of a calendar day in Jakarta (UTC+7, no daylight saving): grants end at 23:59:59.999 WIB. */
export function endOfDayJakarta(date: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error("Tanggal harus berformat YYYY-MM-DD.");
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const check = new Date(utcMidnight);
  if (check.getUTCFullYear() !== Number(m[1]) || check.getUTCMonth() !== Number(m[2]) - 1 || check.getUTCDate() !== Number(m[3])) throw new Error("Tanggal tidak valid.");
  return new Date(utcMidnight + DAY_MS - WIB_MS - 1);
}

/** Jakarta calendar day number (days since epoch) of an instant. */
const jakartaDay = (at: Date) => Math.floor((at.getTime() + WIB_MS) / DAY_MS);

export function accessState(grants: readonly GrantLike[], firm: { suspendedAt: Date | null }, now = new Date()): Access {
  const none: Access = { state: "NONE", endsAt: null, daysLeft: null, kind: null };
  if (firm.suspendedAt && firm.suspendedAt <= now) return none;
  const live = grants.filter((g) => !g.revokedAt || g.revokedAt > now);
  const active = live.filter((g) => g.startsAt <= now && (g.endsAt === null || now < g.endsAt));
  if (active.length) {
    const open = active.find((g) => g.endsAt === null);
    const decider = open ?? active.reduce((a, b) => (b.endsAt! > a.endsAt! ? b : a));
    const endsAt = decider.endsAt;
    return { state: "ACTIVE", endsAt, daysLeft: endsAt ? jakartaDay(endsAt) - jakartaDay(now) : null, kind: decider.kind };
  }
  const ended = live.filter((g) => g.startsAt <= now && g.endsAt !== null && g.endsAt <= now);
  if (ended.length) {
    const last = ended.reduce((a, b) => (b.endsAt! > a.endsAt! ? b : a));
    return { state: "READ_ONLY", endsAt: last.endsAt, daysLeft: null, kind: last.kind };
  }
  return none;
}

/** "Masa uji coba berakhir pada 23 Okt 2026." — the refusal shown for a write while READ_ONLY. */
export function readOnlyMessage(access: Pick<Access, "endsAt" | "kind">) {
  const what = access.kind === "TRIAL" ? "Masa uji coba" : "Masa akses";
  const when = access.endsAt ? ` pada ${new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(access.endsAt)}` : "";
  return `${what} berakhir${when}. Data tetap tersimpan dan laporan bisa diunduh. Hubungi Buku untuk memperpanjang.`;
}
