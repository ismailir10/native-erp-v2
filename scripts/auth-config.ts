import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

class AuthConfigError extends Error {}

type Value = string | number | boolean;
export type AuthConfig = Record<string, Value>;
type Section = Record<string, Value | string[]>;
const FLOWS = ["invite", "recovery", "confirmation", "email_change", "magic_link", "reauthentication"] as const;
const NOTICES = ["password_changed", "email_changed", "phone_changed", "mfa_factor_enrolled", "mfa_factor_unenrolled", "identity_linked", "identity_unlinked"] as const;

/** Read the literal subset used by the checked-in auth sections. Reject unsupported syntax rather than guessing a live config. */
export function readAuthToml(source: string): Record<string, Section> {
  const sections: Record<string, Section> = {};
  let section = "";
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1];
      if (Object.hasOwn(sections, section)) throw new AuthConfigError("Bagian konfigurasi email tidak boleh diulang.");
      sections[section] = {};
      continue;
    }
    if (!(section === "auth" || section === "auth.email" || section.startsWith("auth.email.template.") || section.startsWith("auth.email.notification."))) continue;
    const entry = /^(\w+)\s*=\s*(.+)$/.exec(line);
    if (!entry || Object.hasOwn(sections[section], entry[1])) throw new AuthConfigError("Format konfigurasi email tidak didukung atau berulang.");
    let value: unknown;
    try { value = JSON.parse(entry[2]); } catch { throw new AuthConfigError("Nilai konfigurasi email harus berupa literal satu baris."); }
    if (!(typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isSafeInteger(value)) || (Array.isArray(value) && value.every((x) => typeof x === "string")))) throw new AuthConfigError("Jenis nilai konfigurasi email tidak didukung.");
    sections[section][entry[1]] = value as Value | string[];
  }
  return sections;
}

function publicOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new AuthConfigError("APP_URL harus berupa origin HTTPS Buku."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || ["localhost", "127.0.0.1"].includes(url.hostname)) throw new AuthConfigError("APP_URL harus berupa origin HTTPS Buku tanpa kredensial atau path.");
  return url.origin;
}

/** Public fields only: SMTP passwords, API keys and the Management API token can never enter this payload or its diff. */
export function buildAuthPayload(root: string, input: { appUrl: string; supportEmail: string }): AuthConfig {
  const origin = publicOrigin(input.appUrl);
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(input.supportEmail)) throw new AuthConfigError("BUKU_SUPPORT_EMAIL harus berisi alamat dukungan yang valid.");
  const config = readAuthToml(readFileSync(resolve(root, "supabase/config.toml"), "utf8"));
  const expiry = config["auth.email"]?.otp_expiry;
  if (expiry !== 3600) throw new AuthConfigError("Masa berlaku email harus cocok dengan salinan template: 3600 detik.");
  const redirects = config.auth?.additional_redirect_urls;
  if (!Array.isArray(redirects)) throw new AuthConfigError("Daftar alamat kembali belum dikonfigurasi.");
  const allowList = [...new Set(redirects.map((entry) => {
    const local = new URL(entry);
    if (!["localhost", "127.0.0.1"].includes(local.hostname) || local.search || local.hash || local.username || local.password || local.pathname.includes("*")) throw new AuthConfigError("Alamat kembali di repo harus berupa path lokal yang eksplisit.");
    return `${origin}${local.pathname}`;
  }))];
  if (!allowList.includes(`${origin}/auth/callback`)) throw new AuthConfigError("Daftar alamat kembali harus memuat halaman konfirmasi Buku.");
  const payload: AuthConfig = { site_url: origin, uri_allow_list: allowList.join(","), mailer_otp_exp: expiry, smtp_sender_name: "Buku" };
  const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
  const support = escape(input.supportEmail);
  const templatesRoot = resolve(root, "supabase/templates") + sep;
  function addTemplate(section: Section | undefined, name: string) {
    if (!section || typeof section.subject !== "string" || typeof section.content_path !== "string") throw new AuthConfigError("Subjek atau template email belum lengkap.");
    const path = resolve(root, section.content_path);
    if (!path.startsWith(templatesRoot) || !path.endsWith(".html")) throw new AuthConfigError("Template email harus berada dalam supabase/templates.");
    let html = readFileSync(path, "utf8");
    if (/ConfirmationURL|supabase/i.test(html)) throw new AuthConfigError("Template email harus menggunakan tautan Buku.");
    const marker = /<!-- buku-support -->[\s\S]*?<!-- \/buku-support -->/;
    if (!marker.test(html)) throw new AuthConfigError("Penanda alamat dukungan tidak ditemukan dalam template.");
    html = html.replace(marker, `Bantuan: <a href="mailto:${encodeURIComponent(input.supportEmail)}" style="color:#2152E8">${support}</a>.`);
    payload[`mailer_subjects_${name}`] = section.subject;
    payload[`mailer_templates_${name}_content`] = html;
  }
  for (const name of FLOWS) addTemplate(config[`auth.email.template.${name}`], name);
  for (const name of NOTICES) {
    const section = config[`auth.email.notification.${name}`];
    if (!section) continue; // Preserve hosted notification settings not managed by the repo.
    if (typeof section.enabled !== "boolean") throw new AuthConfigError("Status notifikasi email harus dinyatakan secara eksplisit.");
    payload[`mailer_notifications_${name}_enabled`] = section.enabled;
    if (section.enabled) addTemplate(section, `${name}_notification`);
  }
  return payload;
}

export function diffAuthConfig(current: Record<string, unknown>, desired: AuthConfig) {
  return Object.entries(desired).filter(([key, value]) => current[key] !== value).map(([key, after]) => ({ key, before: current[key], after }));
}

/** Hash string values in the diff: even an old template containing a pasted secret must never reach terminal output. */
function summary(value: unknown) {
  if (value === undefined || value === null) return "belum diatur";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value !== "string") return "nilai tidak dikenal";
  return `${value.length} karakter, sha256:${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

export async function runAuthConfig(input: { args: string[]; env: Record<string, string | undefined>; root: string; fetcher?: typeof fetch; log?: (message: string) => void }) {
  if (input.args.some((arg) => arg !== "--apply") || input.args.length > 1) throw new AuthConfigError("Gunakan auth:config untuk pratinjau, atau auth:config -- --apply untuk menerapkan.");
  const ref = input.env.SUPABASE_PROJECT_REF;
  const token = input.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !/^[a-z0-9]{20}$/.test(ref)) throw new AuthConfigError("Tetapkan SUPABASE_PROJECT_REF proyek tujuan melalui environment.");
  if (!token) throw new AuthConfigError("Token pengelolaan proyek belum tersedia di environment.");
  const desired = buildAuthPayload(input.root, { appUrl: input.env.APP_URL ?? "", supportEmail: input.env.BUKU_SUPPORT_EMAIL ?? "" });
  const fetcher = input.fetcher ?? fetch;
  const log = input.log ?? console.log;
  const endpoint = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const response = await fetcher(endpoint, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new AuthConfigError(`Konfigurasi login tidak dapat dibaca (HTTP ${response.status}).`);
  const current: unknown = await response.json();
  if (!current || typeof current !== "object" || Array.isArray(current)) throw new AuthConfigError("Respons konfigurasi login tidak dikenali.");
  const currentConfig = current as Record<string, unknown>;
  // An enabled unmanaged notice could still send vendor mail. Require a branded repository template; never silently disable it.
  for (const name of NOTICES) {
    const key = `mailer_notifications_${name}_enabled`;
    if (currentConfig[key] === true && !Object.hasOwn(desired, key)) throw new AuthConfigError(`Notifikasi ${name} aktif di proyek. Tambahkan template bermerek ke repo sebelum menerapkan.`);
  }
  const changes = diffAuthConfig(currentConfig, desired);
  log(`Proyek ${ref}: ${changes.length} pengaturan berbeda.`);
  for (const change of changes) log(`${change.key}: ${summary(change.before)} → ${summary(change.after)}`);
  if (!input.args.includes("--apply")) {
    log("Pratinjau saja. Tidak ada pengaturan yang diubah. Gunakan --apply setelah meninjau template dan proyek tujuan.");
    return { applied: false, changes };
  }
  if (changes.length) {
    const result = await fetcher(endpoint, { method: "PATCH", headers, body: JSON.stringify(Object.fromEntries(changes.map(({ key, after }) => [key, after]))), signal: AbortSignal.timeout(30_000) });
    if (!result.ok) throw new AuthConfigError(`Konfigurasi login gagal diterapkan (HTTP ${result.status}).`);
  }
  log(changes.length ? "Konfigurasi login Buku diterapkan." : "Konfigurasi login Buku sudah sesuai.");
  return { applied: changes.length > 0, changes };
}

if (/(?:^|[\\/])auth-config\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runAuthConfig({ args: process.argv.slice(2), env: process.env, root: process.cwd() }).catch((error) => {
    // Response bodies and transport errors can contain credentials. Only our own controlled validation errors are displayed.
    const message = error instanceof AuthConfigError ? error.message : "Konfigurasi login gagal diproses. Periksa koneksi dan akses proyek.";
    console.error(message);
    process.exitCode = 1;
  });
}
