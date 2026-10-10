import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ submit: vi.fn(), headers: vi.fn(), db: {} }));
vi.mock("next/headers", () => ({ headers: boundary.headers }));
vi.mock("@/lib/db", () => ({ prisma: boundary.db }));
vi.mock("@/lib/signup", async (original) => ({ ...await original<typeof import("@/lib/signup")>(), submitSignup: boundary.submit }));
import { submitSignupAction } from "@/app/daftar/actions";
import { SIGNUP_THANKS, SignupError } from "@/lib/signup";

const input = { name: "Sari", email: "sari@example.test", orgName: "Kantor Contoh", orgKind: "KANTOR_AKUNTAN" };

describe("public trial action boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.headers.mockResolvedValue(new Headers());
  });

  it.each([true, false])("acknowledges stored=%s without exposing duplicate or throttle status", async (stored) => {
    boundary.submit.mockResolvedValue({ stored });
    expect(await submitSignupAction(input)).toEqual({ ok: true, notice: SIGNUP_THANKS });
  });

  it("passes the request IP to the existing limiter without collecting new fields", async () => {
    boundary.headers.mockResolvedValue(new Headers({ "x-forwarded-for": "192.0.2.1, 192.0.2.2" }));
    boundary.submit.mockResolvedValue({ stored: true });
    await submitSignupAction(input);
    expect(boundary.submit).toHaveBeenCalledWith(boundary.db, input, "192.0.2.1");
  });

  it.each(["Tulis alamat email kerja yang valid.", "Tulis nama Anda.", "Tulis nama kantor atau perusahaan.", "Pilih kantor akuntan atau perusahaan."])("returns the actionable field error: %s", async (message) => {
    boundary.submit.mockRejectedValue(new SignupError(message));
    expect(await submitSignupAction(input)).toEqual({ ok: false, error: message });
  });
});
