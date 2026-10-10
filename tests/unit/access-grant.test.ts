import { describe, expect, it } from "vitest";
import { accessState, endOfDayJakarta, readOnlyMessage, type GrantLike } from "@/lib/access/grant";

const at = (iso: string) => new Date(iso);
const grant = (g: Partial<GrantLike>): GrantLike => ({ kind: "TRIAL", startsAt: at("2026-10-01T00:00:00Z"), endsAt: null, revokedAt: null, ...g });
const firm = { suspendedAt: null };

describe("endOfDayJakarta", () => {
  it("is 23:59:59.999 WIB, i.e. 16:59:59.999 UTC of the same date", () => expect(endOfDayJakarta("2026-10-23").toISOString()).toBe("2026-10-23T16:59:59.999Z"));
  it("refuses a malformed or impossible date", () => {
    expect(() => endOfDayJakarta("23-10-2026")).toThrow();
    expect(() => endOfDayJakarta("2026-02-30")).toThrow();
  });
});

describe("accessState", () => {
  const ends = endOfDayJakarta("2026-10-23");
  it("open-ended grant is ACTIVE without an end", () => expect(accessState([grant({ kind: "COMP" })], firm, at("2030-01-01T00:00:00Z"))).toEqual({ state: "ACTIVE", endsAt: null, daysLeft: null, kind: "COMP" }));
  it("counts Jakarta days left; the last day is 0 and still ACTIVE at 23:59 WIB", () => {
    expect(accessState([grant({ endsAt: ends })], firm, at("2026-10-20T03:00:00Z")).daysLeft).toBe(3);
    // 06:59 WIB on the 23rd and 23:59 WIB on the 23rd: same day, 0 left.
    expect(accessState([grant({ endsAt: ends })], firm, at("2026-10-22T23:59:00Z"))).toMatchObject({ state: "ACTIVE", daysLeft: 0 });
    expect(accessState([grant({ endsAt: ends })], firm, at("2026-10-23T16:59:00Z"))).toMatchObject({ state: "ACTIVE", daysLeft: 0 });
  });
  it("turns READ_ONLY at midnight WIB after the end date", () => expect(accessState([grant({ endsAt: ends })], firm, at("2026-10-23T17:00:00Z"))).toEqual({ state: "READ_ONLY", endsAt: ends, daysLeft: null, kind: "TRIAL" }));
  it("is NONE before the first grant starts", () => expect(accessState([grant({ startsAt: at("2026-11-01T00:00:00Z") })], firm, at("2026-10-15T00:00:00Z")).state).toBe("NONE"));
  it("is NONE with no grants, or when every grant is revoked", () => {
    expect(accessState([], firm).state).toBe("NONE");
    expect(accessState([grant({ endsAt: ends, revokedAt: at("2026-10-10T00:00:00Z") })], firm, at("2026-10-12T00:00:00Z")).state).toBe("NONE");
    expect(accessState([grant({ endsAt: ends, revokedAt: at("2026-10-10T00:00:00Z") })], firm, at("2026-10-30T00:00:00Z")).state).toBe("NONE");
  });
  it("a revocation dated later has not happened yet", () => expect(accessState([grant({ revokedAt: at("2026-12-01T00:00:00Z") })], firm, at("2026-10-12T00:00:00Z")).state).toBe("ACTIVE"));
  it("overlapping grants: the longest decides; an open-ended one wins", () => {
    const later = endOfDayJakarta("2026-11-30");
    expect(accessState([grant({ endsAt: ends }), grant({ kind: "PAID", endsAt: later })], firm, at("2026-10-20T00:00:00Z"))).toMatchObject({ state: "ACTIVE", endsAt: later, kind: "PAID" });
    expect(accessState([grant({ endsAt: ends }), grant({ kind: "COMP" })], firm, at("2026-10-20T00:00:00Z"))).toMatchObject({ endsAt: null, kind: "COMP" });
  });
  it("an extension after a gap: READ_ONLY in the gap, ACTIVE again once it starts", () => {
    const next = grant({ kind: "PAID", startsAt: at("2026-11-01T00:00:00Z"), endsAt: endOfDayJakarta("2027-10-31") });
    expect(accessState([grant({ endsAt: ends }), next], firm, at("2026-10-28T00:00:00Z")).state).toBe("READ_ONLY");
    expect(accessState([grant({ endsAt: ends }), next], firm, at("2026-11-02T00:00:00Z")).state).toBe("ACTIVE");
  });
  it("suspension closes everything, whatever the grants say", () => expect(accessState([grant({ kind: "COMP" })], { suspendedAt: at("2026-10-05T00:00:00Z") }, at("2026-10-06T00:00:00Z")).state).toBe("NONE"));
});

describe("readOnlyMessage", () => {
  it("names the end date in Jakarta time and how to continue", () => {
    expect(readOnlyMessage({ kind: "TRIAL", endsAt: endOfDayJakarta("2026-10-23") })).toBe("Masa uji coba berakhir pada 23 Okt 2026. Data tetap tersimpan dan laporan bisa diunduh. Hubungi Buku untuk memperpanjang.");
    expect(readOnlyMessage({ kind: "PAID", endsAt: null })).toMatch(/^Masa akses berakhir\. /);
  });
});
