import "dotenv/config";
import { createPrisma } from "../lib/db";
import { initializeWorkspace, inviteUser, listMembers, revokeUser } from "../lib/auth/operator";
import { createSupabaseAdmin } from "../lib/supabase/admin";
import { appUrl } from "../lib/supabase/env";
import type { MemberRole } from "../lib/generated/prisma/enums";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Gunakan pasangan --opsi nilai. Contoh: npm run access -- invite --firm ID --email ALAMAT --name NAMA.");
    const key = args[i].slice(2);
    if (options.has(key)) throw new Error(`Opsi --${key} tidak boleh diulang.`);
    options.set(key, args[i + 1]);
  }
  const allowed: Record<string, string[]> = { init: ["name"], list: [], invite: ["firm", "email", "name", "role", "url"], revoke: ["firm", "email"] };
  if (!Object.hasOwn(allowed, command)) throw new Error("Pilih init --name NAMA, list, invite --firm ID --email ALAMAT --name NAMA [--role ADMIN|AKUNTAN] [--url ORIGIN], atau revoke --firm ID --email ALAMAT.");
  if ([...options.keys()].some((key) => !allowed[command].includes(key))) throw new Error("Opsi tidak dikenal untuk perintah ini.");
  if (["invite", "revoke"].includes(command) && (!options.get("firm") || !options.get("email"))) throw new Error("--firm ID dan --email ALAMAT wajib diisi.");
  const role = options.get("role");
  if (role && role !== "ADMIN" && role !== "AKUNTAN") throw new Error("--role harus ADMIN atau AKUNTAN.");
  const db = createPrisma();
  try {
    if (command === "init") {
      const firm = await initializeWorkspace(db, options.get("name") ?? "");
      console.log(`Kantor dibuat: ${firm.id} · ${firm.name}. Gunakan ID ini untuk access invite.`);
    } else if (command === "list") {
      const firms = await db.firm.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
      for (const firm of firms) console.log(`${firm.id} · ${firm.name}`);
      if (!firms.length) console.log("Belum ada kantor. Gunakan access init --name NAMA.");
      for (const member of await listMembers(db)) console.log(`  ${member.email} · ${member.name} · ${member.role}${member.disabled ? " · DICABUT" : ""} · kantor ${member.firm.name}`);
    } else {
      const auth = createSupabaseAdmin().auth.admin;
      const input = { firmId: options.get("firm")!, email: options.get("email")! };
      if (command === "invite") {
        const member = await inviteUser(db, auth, { ...input, name: options.get("name") ?? "", role: role as MemberRole | undefined, redirectTo: options.get("url") || appUrl() || undefined });
        console.log(`Undangan terkirim ke ${member.email} (${member.role}) · kantor ${member.firmId}. Tautan atur kata sandi ada di email.`);
      } else {
        const member = await revokeUser(db, auth, input);
        console.log(`Akses dicabut: ${member.email} · kantor ${member.firmId}.`);
      }
    }
  } finally { await db.$disconnect(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Akses gagal diubah."); process.exitCode = 1; });
