import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth/config", () => ({ createAuth: mocks.createAuth }));
import { GET, POST } from "@/app/api/auth/[...all]/route";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it.each(["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"])("returns a non-cacheable setup response when %s is missing", async (missing) => {
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-rollout-secret-not-for-deployment");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3200");
  vi.stubEnv(missing, "");
  for (const handler of [GET, POST]) {
    const response = await handler(new Request("http://localhost:3200/api/auth/get-session"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ message: "Akses belum siap. Hubungi pengelola Buku." });
  }
  expect(mocks.createAuth).not.toHaveBeenCalled();
});

it.each(["", "123456", "abcdefghijkl"])("keeps shared mode closed with invalid configured code %s", async (value) => {
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-rollout-secret-not-for-deployment");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3200");
  vi.stubEnv("AUTH_MODE", "shared-code");
  vi.stubEnv("AUTH_SHARED_CODE", value);
  expect((await POST(new Request("http://localhost:3200/api/auth/sign-in/shared-code"))).status).toBe(503);
  expect(mocks.createAuth).not.toHaveBeenCalled();
});
