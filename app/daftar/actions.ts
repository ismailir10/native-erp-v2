"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { SIGNUP_THANKS, SignupError, submitSignup, type SignupInput } from "@/lib/signup";
import { userMessage } from "@/lib/errors/user-message";

/**
 * The public trial request (ADR 0017 §4): no session by design; throttled per address and per IP in lib/signup.ts. The answer is the
 * same whether the request was stored or quietly dropped.
 */
export async function submitSignupAction(input: SignupInput): Promise<{ ok: true; notice: string } | { ok: false; error: string }> {
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
    await submitSignup(prisma, input ?? ({} as SignupInput), ip);
    return { ok: true, notice: SIGNUP_THANKS };
  } catch (e) {
    if (e instanceof SignupError) return { ok: false, error: e.message };
    return { ok: false, error: userMessage(e, "Permintaan belum terkirim. Coba lagi sebentar lagi.") };
  }
}
