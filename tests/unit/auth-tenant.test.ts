import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ configured: vi.fn(), getUser: vi.fn(), member: vi.fn(), client: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/auth", () => ({ authConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/db", () => ({ prisma: { firmMember: { findUnique: mocks.member }, client: { findFirst: mocks.client } } }));
import { getCurrentFirm, getClientForFirm } from "@/lib/tenant";
import { getWorkspaceSession, requireMember } from "@/lib/auth/session";

const firm = { id: "right-firm", name: "Kantor" };
const signedIn = () => mocks.getUser.mockResolvedValue({ data: { user: { id: "8d1f6a3e-0000-4000-8000-000000000001" } } });

describe("authenticated tenant resolution", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.configured.mockReturnValue(true); });
  it("keeps an unconfigured deployment closed and redirects to the setup message", async () => {
    mocks.configured.mockReturnValue(false);
    expect(await getWorkspaceSession()).toBeNull();
    await expect(getCurrentFirm()).rejects.toThrow("redirect:/login");
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("redirects anonymous callers without selecting a firm", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    await expect(getCurrentFirm()).rejects.toThrow("redirect:/login");
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("resolves the firm from the live member row and refuses revoked members", async () => {
    signedIn();
    mocks.member.mockResolvedValue({ id: "m1", role: "AKUNTAN", disabled: false, firmId: firm.id, firm });
    expect(await getCurrentFirm()).toEqual(firm);
    expect(mocks.member).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "8d1f6a3e-0000-4000-8000-000000000001" } }));
    mocks.member.mockResolvedValue({ id: "m1", disabled: true, firm });
    expect(await getWorkspaceSession()).toBeNull();
  });
  it("treats a Supabase user without a member row as no access", async () => {
    signedIn(); mocks.member.mockResolvedValue(null);
    expect(await getWorkspaceSession()).toBeNull();
  });
  it("requireMember gates admin-only actions with an error, not a redirect", async () => {
    signedIn();
    mocks.member.mockResolvedValue({ id: "m1", role: "AKUNTAN", disabled: false, firm });
    await expect(requireMember("ADMIN")).rejects.toThrow("Hanya admin kantor");
    expect((await requireMember()).id).toBe("m1");
    mocks.member.mockResolvedValue({ id: "m2", role: "ADMIN", disabled: false, firm });
    expect((await requireMember("ADMIN")).id).toBe("m2");
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireMember()).rejects.toThrow("Masuk terlebih dahulu");
  });
  it("does not resolve another firm's client", async () => {
    signedIn();
    mocks.member.mockResolvedValue({ id: "m1", role: "AKUNTAN", disabled: false, firm });
    mocks.client.mockResolvedValue(null);
    await expect(getClientForFirm("foreign-client")).rejects.toThrow("Klien tidak ditemukan");
    expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign-client", firmId: "right-firm" } }));
  });
});
