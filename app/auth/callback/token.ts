/** Only the email flows that Buku's templates send can exchange a token. SMS and arbitrary redirects are never accepted. */
const EMAIL_TYPES = ["invite", "recovery", "signup", "magiclink", "email_change"] as const;
export type LinkToken = { tokenHash: string; type: typeof EMAIL_TYPES[number] } | { code: string };

export function readLinkToken(input: { code?: unknown; token_hash?: unknown; type?: unknown }): LinkToken | null {
  const valid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,2048}$/.test(value);
  if (input.code && !input.token_hash && !input.type && valid(input.code)) return { code: input.code };
  if (!input.code && valid(input.token_hash) && EMAIL_TYPES.includes(input.type as typeof EMAIL_TYPES[number])) {
    return { tokenHash: input.token_hash, type: input.type as typeof EMAIL_TYPES[number] };
  }
  return null;
}
