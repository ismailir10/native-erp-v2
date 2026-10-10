import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ configured: vi.fn(), getClaims: vi.fn(), member: vi.fn(), client: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/auth", () => ({ authConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getClaims: mocks.getClaims } }) }));
vi.mock("@/lib/db", () => ({ prisma: { firmMember: { findUnique: mocks.member }, client: { findFirst: mocks.client } } }));
import { getCurrentFirm, getClientForFirm } from "@/lib/tenant";
import { getWorkspaceSession, requireMember } from "@/lib/auth/session";

const firm = { id: "right-firm", name: "Kantor", kind: "KANTOR_AKUNTAN", suspendedAt: null };
const open = [{ kind: "COMP", startsAt: new Date("2026-01-01T00:00:00Z"), endsAt: null, revokedAt: null }];
/** The member row as resolveWorkspace reads it: firm with its grants, and the member's client assignments. */
const row = (m: Record<string, unknown>, opts: { grants?: unknown[]; clients?: string[] } = {}) =>
  ({ clientAccess: (opts.clients ?? []).map((clientId) => ({ clientId })), ...m, firm: { ...firm, grants: opts.grants ?? open } });
const signedIn = () => mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "8d1f6a3e-0000-4000-8000-000000000001" } } });

describe("authenticated tenant resolution", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.configured.mockReturnValue(true); });
  it("keeps an unconfigured deployment closed and redirects to the setup message", async () => {
    mocks.configured.mockReturnValue(false);
    expect(await getWorkspaceSession()).toBeNull();
    await expect(getCurrentFirm()).rejects.toThrow("redirect:/login");
    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("redirects anonymous callers without selecting a firm", async () => {
    mocks.getClaims.mockResolvedValue({ data: null });
    await expect(getCurrentFirm()).rejects.toThrow("redirect:/login");
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("resolves the firm from the live member row and refuses revoked members", async () => {
    signedIn();
    mocks.member.mockResolvedValue(row({ id: "m1", role: "AKUNTAN", disabled: false, firmId: firm.id }));
    expect(await getCurrentFirm()).toEqual(firm);
    expect(mocks.member).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "8d1f6a3e-0000-4000-8000-000000000001" } }));
    mocks.member.mockResolvedValue(row({ id: "m1", disabled: true }));
    expect(await getWorkspaceSession()).toBeNull();
  });
  it("treats a Supabase user without a member row as no access", async () => {
    signedIn(); mocks.member.mockResolvedValue(null);
    expect(await getWorkspaceSession()).toBeNull();
  });
  it("requireMember gates admin-only actions with an error, not a redirect", async () => {
    signedIn();
    mocks.member.mockResolvedValue(row({ id: "m1", role: "AKUNTAN", disabled: false }));
    await expect(requireMember("ADMIN")).rejects.toThrow("Hanya admin kantor");
    expect((await requireMember()).id).toBe("m1");
    mocks.member.mockResolvedValue(row({ id: "m2", role: "ADMIN", disabled: false }));
    expect((await requireMember("ADMIN")).id).toBe("m2");
    mocks.member.mockResolvedValue(row({ id: "m3", role: "OWNER", disabled: false }));
    expect((await requireMember("ADMIN")).id).toBe("m3");
    mocks.getClaims.mockResolvedValue({ data: null });
    await expect(requireMember()).rejects.toThrow("Masuk terlebih dahulu");
  });
  it("does not resolve another firm's client", async () => {
    signedIn();
    mocks.member.mockResolvedValue(row({ id: "m1", role: "ADMIN", disabled: false }));
    mocks.client.mockResolvedValue(null);
    await expect(getClientForFirm("foreign-client")).rejects.toThrow("Klien tidak ditemukan");
    expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ firmId: "right-firm" }, { id: "foreign-client" }] } }));
  });
  it("keeps an akuntan's assignment list next to the requested id instead of overwriting it", async () => {
    signedIn();
    mocks.member.mockResolvedValue(row({ id: "m1", role: "AKUNTAN", disabled: false }, { clients: ["assigned"] }));
    mocks.client.mockResolvedValue(null);
    await expect(getClientForFirm("unassigned")).rejects.toThrow("Klien tidak ditemukan");
    expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ firmId: "right-firm", id: { in: ["assigned"] } }, { id: "unassigned" }] } }));
  });
  it("sends a member of a closed organisation to the closed page, and refuses its actions", async () => {
    signedIn();
    mocks.member.mockResolvedValue(row({ id: "m1", role: "OWNER", disabled: false }, { grants: [] }));
    await expect(getCurrentFirm()).rejects.toThrow("redirect:/akses-ditutup");
    await expect(requireMember()).rejects.toThrow("Akses ruang kerja ini ditutup");
  });
});
