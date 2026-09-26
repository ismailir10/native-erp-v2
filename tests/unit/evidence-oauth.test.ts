import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ find: vi.fn(), consume: vi.fn(), upsert: vi.fn(), exchange: vi.fn(), firm: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => {
  const prisma = { driveOAuthState: { findFirst: mocks.find, deleteMany: mocks.consume }, driveConnection: { upsert: mocks.upsert }, $transaction: mocks.transaction };
  mocks.transaction.mockImplementation(async (work) => work(prisma));
  return { prisma };
});
vi.mock("@/lib/tenant", () => ({ getCurrentFirm: mocks.firm }));
vi.mock("@/lib/evidence/drive", async (original) => ({ DriveError: (await original<typeof import("@/lib/evidence/drive")>()).DriveError, exchangeCode: mocks.exchange, oauthConfigured: () => true }));
vi.mock("@/lib/settings/secret", () => ({
  encryptSecret: (value: string) => `encrypted:${value}`,
  settingsSecretConfigured: () => true,
}));
vi.mock("@/lib/evidence/config", () => ({ requireEvidenceEnabled: () => {} }));
import { GET } from "@/app/api/google/callback/route";
import { DriveError } from "@/lib/evidence/drive";

const state = "s".repeat(43);
const browser = "b".repeat(43);
function req(params = `state=${state}&code=code`, cookie = browser) {
  return new NextRequest(`https://buku.test/api/google/callback?${params}`, {
    headers: { cookie: `buku_drive_oauth=${cookie}` },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.firm.mockResolvedValue({ id: "firm-1" });
  mocks.find.mockResolvedValue({ id: "pending-approval" });
  mocks.consume.mockResolvedValue({ count: 1 });
  mocks.exchange.mockResolvedValue({ refreshToken: "refresh-secret" });
});

it("consumes unexpired browser/firm bound state and only persists encrypted token", async () => {
  const before = Date.now();
  const response = await GET(req());
  expect(response.headers.get("location")).toBe("/documents?google=connected");
  const where = mocks.consume.mock.calls[0][0].where;
  expect(where).toMatchObject({
    firmId: "firm-1",
    id: createHash("sha256").update(state).digest("hex"),
    browserHash: createHash("sha256").update(browser).digest("hex"),
  });
  expect(where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before);
  expect(mocks.upsert.mock.calls[0][0].create).toEqual({ firmId: "firm-1", refreshToken: "encrypted:refresh-secret" });
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
});

it("rejects replay or expired state without code exchange", async () => {
  mocks.find.mockResolvedValue(null);
  expect((await GET(req())).headers.get("location")).toBe("/documents?google=error&reason=state");
  expect(mocks.exchange).not.toHaveBeenCalled();
});

it("rejects missing cookie before consuming state", async () => {
  await GET(req(undefined, ""));
  expect(mocks.consume).not.toHaveBeenCalled();
  expect(mocks.exchange).not.toHaveBeenCalled();
});

it("consumes declined consent without exchanging", async () => {
  expect((await GET(req(`state=${state}&error=access_denied`))).headers.get("location")).toBe("/documents?google=error&reason=denied");
  expect(mocks.consume).toHaveBeenCalledOnce();
  expect(mocks.exchange).not.toHaveBeenCalled();
});

it("does not overwrite connection when refresh token missing", async () => {
  mocks.exchange.mockResolvedValue({ accessToken: "access" });
  expect((await GET(req())).headers.get("location")).toBe("/documents?google=error&reason=no_refresh_token");
  expect(mocks.upsert).not.toHaveBeenCalled();
});

it("does not expose provider failure or code in redirect", async () => {
  mocks.exchange.mockRejectedValue(new Error("provider secret"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const response = await GET(req());
  expect(response.headers.get("location")).toBe("/documents?google=error&reason=exchange");
  expect(warn.mock.calls).toEqual([["google oauth callback failed: exchange"]]);
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});

it("does not reconnect after disconnect cancels approval during code exchange", async () => {
  mocks.exchange.mockImplementation(async () => {
    // The disconnect transaction removed the pending approval while Google was responding.
    mocks.consume.mockResolvedValue({ count: 0 });
    return { refreshToken: "new-refresh" };
  });
  const response = await GET(req());
  expect(mocks.find).toHaveBeenCalledOnce();
  expect(mocks.exchange).toHaveBeenCalledOnce();
  expect(mocks.transaction).toHaveBeenCalledOnce();
  expect(mocks.consume).toHaveBeenCalledOnce();
  expect(mocks.upsert).not.toHaveBeenCalled();
  expect(response.headers.get("location")).toBe("/documents?google=error&reason=state");
});

it("rechecks expiry when Google finishes exchanging the code", async () => {
  let initialCutoff: Date;
  mocks.find.mockImplementation(async ({ where }) => {
    initialCutoff = where.expiresAt.gt;
    return { id: "pending-approval" };
  });
  mocks.exchange.mockImplementation(async () => {
    mocks.consume.mockImplementation(async ({ where }) => {
      expect(where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(initialCutoff.getTime());
      return { count: 0 };
    });
    return { refreshToken: "new-refresh" };
  });
  expect((await GET(req())).headers.get("location")).toBe("/documents?google=error&reason=state");
  expect(mocks.upsert).not.toHaveBeenCalled();
});

it("names a missing Drive permission or a wrong client secret, and nothing else", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.exchange.mockRejectedValue(new DriveError("Izin membaca Google Drive belum diberikan.", "SCOPE"));
  expect((await GET(req())).headers.get("location")).toBe("/documents?google=error&reason=scope");
  mocks.exchange.mockRejectedValue(new DriveError("Konfigurasi Google di server tidak cocok.", "CONFIG", 401));
  expect((await GET(req())).headers.get("location")).toBe("/documents?google=error&reason=invalid_client");
  expect(warn.mock.calls.flat().join(" ")).not.toMatch(/code|refresh|secret/);
});
