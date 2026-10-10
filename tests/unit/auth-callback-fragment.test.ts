import { describe, expect, it } from "vitest";
import { fragmentTarget } from "@/app/auth/callback/token";

/** Default-template links arrive verified, with the session or the failure in the fragment (cycle 2026-10-10-auth-callback-fragment). */
describe("where a link fragment goes", () => {
  it("sends a session to the password page, fragment intact", () => {
    const hash = "#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer&type=invite";
    expect(fragmentTarget(hash)).toEqual({ to: `/atur-sandi${hash}` });
    expect(fragmentTarget(hash.slice(1))).toEqual({ to: `/atur-sandi${hash}` });
  });
  it("names an expired link, and treats any other failure or an empty fragment as invalid", () => {
    expect(fragmentTarget("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid")).toEqual({ error: "expired" });
    expect(fragmentTarget("#error=server_error")).toEqual({ error: "invalid" });
    expect(fragmentTarget("")).toEqual({ error: "invalid" });
    expect(fragmentTarget("#access_token=only")).toEqual({ error: "invalid" });
  });
});
