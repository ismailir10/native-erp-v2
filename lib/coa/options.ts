import { FS_LINES } from "@/lib/coa/template";
import type { AccountOption } from "@/components/app/account-picker";

const TYPE_LABEL: Record<string, string> = { ASET: "Aset", LIABILITAS: "Liabilitas", EKUITAS: "Ekuitas", PENDAPATAN: "Pendapatan", BEBAN: "Beban" };

/** Group label for pickers: "Beban · Beban umum & administrasi". */
export const accountGroup = (a: { type: string; fsLine: string | null }) => `${TYPE_LABEL[a.type]} · ${FS_LINES[a.fsLine as keyof typeof FS_LINES]?.label ?? ""}`.replace(/ · $/, "");

/** Accounts a bank line can be classified to (never a bank or 1999), grouped for pickers. */
export function classifiableOptions(accounts: { code: string; name: string; type: string; fsLine: string | null; isBank: boolean; isSuspense: boolean }[]): AccountOption[] {
  return accounts.filter((a) => !a.isBank && !a.isSuspense).map((a) => ({ code: a.code, name: a.name, group: accountGroup(a) }));
}
