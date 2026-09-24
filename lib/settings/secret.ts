import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Encryption for secrets stored in AppSetting (AES-256-GCM). The key is derived from the
 * SETTINGS_SECRET env var, so a leaked DB dump alone doesn't reveal the AI key.
 * Format: "v1:" + base64(iv[12] | tag[16] | ciphertext).
 */
const VERSION = "v1:";

export function settingsSecretConfigured() {
  return (process.env.SETTINGS_SECRET ?? "").length >= 32;
}

function key() {
  const secret = process.env.SETTINGS_SECRET ?? "";
  if (secret.length < 32) throw new Error("SETTINGS_SECRET belum diatur (minimal 32 karakter).");
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return VERSION + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

/** Throws if the value was tampered with or encrypted under a different SETTINGS_SECRET. */
export function decryptSecret(value: string): string {
  if (!value.startsWith(VERSION)) throw new Error("Format rahasia tidak dikenal");
  const buf = Buffer.from(value.slice(VERSION.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export function adminPasscodeConfigured() {
  return (process.env.ADMIN_PASSCODE ?? "").length > 0;
}

/** Constant-time passcode check. Hashing first makes the comparison length-independent. */
export function passcodeMatches(input: string): boolean {
  const expected = process.env.ADMIN_PASSCODE ?? "";
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
