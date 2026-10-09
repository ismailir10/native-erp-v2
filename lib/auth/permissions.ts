import type { MemberRole } from "@/lib/generated/prisma/enums";

export const ROLE_LABEL: Record<MemberRole, string> = { OWNER: "Pemilik", ADMIN: "Admin", AKUNTAN: "Akuntan", VIEWER: "Peninjau" };

/**
 * What a member of an organisation may do (ADR 0017 §5). Client assignment and the organisation's access state are checked
 * separately (lib/auth/session.ts); this is the role part only. AI credentials and access grants are not here: they belong to
 * Buku admins (lib/auth/platform.ts), never to a member.
 */
export type Capability =
  | "books.read" // see the books and reports of a client, export them
  | "books.write" // import, review, post, adjust, sign off, lock a month
  | "client.create" // a new client (firm) or entity
  | "period.unlock"
  | "import.remove"
  | "close.batch" // close many past months at once
  | "client.delete"
  | "org.settings" // Google Drive, organisation settings
  | "members.manage" // invite, disable, change roles, assign clients
  | "org.transfer"; // hand ownership to another member

const ALL: readonly MemberRole[] = ["OWNER", "ADMIN", "AKUNTAN", "VIEWER"];
const WRITERS: readonly MemberRole[] = ["OWNER", "ADMIN", "AKUNTAN"];
const ADMINS: readonly MemberRole[] = ["OWNER", "ADMIN"];

const MATRIX: Record<Capability, readonly MemberRole[]> = {
  "books.read": ALL,
  "books.write": WRITERS,
  "client.create": WRITERS,
  "period.unlock": ADMINS,
  "import.remove": ADMINS,
  "close.batch": ADMINS,
  "client.delete": ADMINS,
  "org.settings": ADMINS,
  "members.manage": ADMINS,
  "org.transfer": ["OWNER"],
};

export const can = (role: MemberRole, capability: Capability) => MATRIX[capability].includes(role);

/** Capabilities that change data; refused while the organisation is read-only or in a support session. */
export const isWrite = (capability: Capability) => capability !== "books.read";

/** OWNER and ADMIN may do what "admin kantor" could before roles grew to four, and see every client without an assignment. */
export const isAdminRole = (role: MemberRole) => ADMINS.includes(role);

/** Bahasa refusal for a missing capability, shown as is by forms and toasts. */
export function capabilityRefusal(capability: Capability) {
  if (capability === "org.transfer") return "Hanya pemilik yang dapat memindahkan kepemilikan.";
  if (capability === "books.write" || capability === "client.create") return "Peran Peninjau hanya dapat melihat dan mengunduh laporan.";
  return "Hanya admin kantor yang dapat melakukan ini.";
}
