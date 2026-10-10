import "dotenv/config";
import { createPrisma } from "../lib/db";
import { addOperator, initializeWorkspace, inviteUser, listMembers, listOperators, removeOperator, revokeUser, setMemberRole } from "../lib/auth/operator";
import { createSupabaseAdmin } from "../lib/supabase/admin";
import { appUrl } from "../lib/supabase/env";
import type { MemberRole } from "../lib/generated/prisma/enums";

const ROLES = ["OWNER", "ADMIN", "AKUNTAN", "VIEWER"];
const USAGE = [
  "init --name NAMA",
  "list",
  "invite --firm ID --email ALAMAT --name NAMA [--role OWNER|ADMIN|AKUNTAN|VIEWER] [--url ORIGIN]",
  "revoke --firm ID --email ALAMAT",
  "set-role --firm ID --email ALAMAT --role OWNER|ADMIN|AKUNTAN|VIEWER",
  "operator add --email ALAMAT --name NAMA [--url ORIGIN]",
  "operator remove --email ALAMAT",
  "operator list",
].join(", ");

async function main() {
  const argv = process.argv.slice(2);
  // `operator add|remove|list` is one command of two words (Buku admins, ADR 0017 §2).
  const command = argv[0] === "operator" ? `operator ${argv[1] ?? ""}` : argv[0];
  const args = argv.slice(argv[0] === "operator" ? 2 : 1);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Gunakan pasangan --opsi nilai. Contoh: npm run access -- invite --firm ID --email ALAMAT --name NAMA.");
    const key = args[i].slice(2);
    if (options.has(key)) throw new Error(`Opsi --${key} tidak boleh diulang.`);
    options.set(key, args[i + 1]);
  }
  const allowed: Record<string, string[]> = {
    init: ["name"], list: [], invite: ["firm", "email", "name", "role", "url"], revoke: ["firm", "email"], "set-role": ["firm", "email", "role"],
    "operator add": ["email", "name", "url"], "operator remove": ["email"], "operator list": [],
  };
  if (!Object.hasOwn(allowed, command)) throw new Error(`Pilih salah satu: ${USAGE}.`);
  if ([...options.keys()].some((key) => !allowed[command].includes(key))) throw new Error("Opsi tidak dikenal untuk perintah ini.");
  if (["invite", "revoke", "set-role"].includes(command) && (!options.get("firm") || !options.get("email"))) throw new Error("--firm ID dan --email ALAMAT wajib diisi.");
  if (command.startsWith("operator ") && command !== "operator list" && !options.get("email")) throw new Error("--email ALAMAT wajib diisi.");
  const role = options.get("role");
  if (role && !ROLES.includes(role)) throw new Error("--role harus OWNER, ADMIN, AKUNTAN atau VIEWER.");
  if (command === "set-role" && !role) throw new Error("--role wajib diisi.");
  const url = options.get("url") || appUrl() || undefined;
  const db = createPrisma();
  try {
    if (command === "init") {
      const firm = await initializeWorkspace(db, options.get("name") ?? "");
      console.log(`Kantor dibuat: ${firm.id} · ${firm.name}. Gunakan ID ini untuk access invite.`);
    } else if (command === "list") {
      const firms = await db.firm.findMany({ select: { id: true, name: true, kind: true }, orderBy: { name: "asc" } });
      for (const firm of firms) console.log(`${firm.id} · ${firm.name} · ${firm.kind}`);
      if (!firms.length) console.log("Belum ada kantor. Gunakan access init --name NAMA.");
      for (const member of await listMembers(db)) console.log(`  ${member.email} · ${member.name} · ${member.role}${member.disabled ? " · DICABUT" : ""} · kantor ${member.firm.name}`);
    } else if (command === "set-role") {
      const member = await setMemberRole(db, { firmId: options.get("firm")!, email: options.get("email")!, role: role as MemberRole });
      console.log(`Peran diubah: ${member.email} → ${member.role} · kantor ${member.firmId}.`);
    } else if (command === "operator list") {
      const admins = await listOperators(db);
      for (const admin of admins) console.log(`${admin.email} · ${admin.name}${admin.disabled ? " · DICABUT" : ""}`);
      if (!admins.length) console.log("Belum ada admin Buku. Gunakan access operator add --email ALAMAT --name NAMA.");
    } else if (command === "operator remove") {
      const admin = await removeOperator(db, { email: options.get("email")! });
      console.log(`Admin Buku dicabut: ${admin.email}. Akun login-nya tetap (bisa juga anggota kantor).`);
    } else if (command === "operator add") {
      const admin = await addOperator(db, createSupabaseAdmin().auth, { email: options.get("email")!, name: options.get("name") ?? "", redirectTo: url });
      console.log(`Admin Buku aktif: ${admin.email}. Bila akunnya baru, tautan atur kata sandi ada di email. Backoffice: /backoffice.`);
    } else {
      const auth = createSupabaseAdmin().auth;
      const input = { firmId: options.get("firm")!, email: options.get("email")! };
      if (command === "invite") {
        const member = await inviteUser(db, auth, { ...input, name: options.get("name") ?? "", role: role as MemberRole | undefined, redirectTo: url });
        console.log(`Undangan terkirim ke ${member.email} (${member.role}) · kantor ${member.firmId}. Tautan atur kata sandi ada di email.`);
      } else {
        const member = await revokeUser(db, auth, input);
        console.log(`Akses dicabut: ${member.email} · kantor ${member.firmId}.`);
      }
    }
  } finally { await db.$disconnect(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Akses gagal diubah."); process.exitCode = 1; });
