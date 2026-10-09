import type { MemberRole } from "@/lib/generated/prisma/enums";

export const ROLE_LABEL: Record<MemberRole, string> = { OWNER: "Pemilik", ADMIN: "Admin", AKUNTAN: "Akuntan", VIEWER: "Peninjau" };

/** OWNER and ADMIN may do what "admin kantor" could before roles grew to four (ADR 0017 §5). */
export const isAdminRole = (role: MemberRole) => role === "OWNER" || role === "ADMIN";
