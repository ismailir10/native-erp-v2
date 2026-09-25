import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), user: vi.fn(), client: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/lib/db", () => ({ prisma: { authUser: { findUnique: mocks.user }, client: { findFirst: mocks.client } } }));
import { getCurrentFirm, getClientForFirm } from "@/lib/tenant";
import { getWorkspaceSession } from "@/lib/auth/session";

describe("authenticated tenant resolution", () => {
  beforeEach(() => vi.resetAllMocks());
  it("redirects anonymous callers without creating or selecting a firm", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(getCurrentFirm()).rejects.toThrow("redirect:/login");
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("uses the live invited user's firm and refuses revoked users", async () => {
    mocks.getSession.mockResolvedValue({ session: { id: "session" }, user: { id: "invited", firmId: "stale" } });
    mocks.user.mockResolvedValue({ id: "invited", disabled: false, firmId: "right-firm", firm: { id: "right-firm", name: "Kantor" } });
    expect(await getCurrentFirm()).toEqual({ id: "right-firm", name: "Kantor" });
    mocks.user.mockResolvedValue({ id: "invited", disabled: true });
    expect(await getWorkspaceSession()).toBeNull();
  });
  it("does not resolve another firm's client", async () => {
    mocks.getSession.mockResolvedValue({ session: {}, user: { id: "invited" } });
    mocks.user.mockResolvedValue({ id: "invited", disabled: false, firm: { id: "right-firm" } });
    mocks.client.mockResolvedValue(null);
    await expect(getClientForFirm("foreign-client")).rejects.toThrow("Klien tidak ditemukan");
    expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign-client", firmId: "right-firm" } }));
  });
});
