"use client";

import { AccountPicker, type AccountOption } from "@/components/app/account-picker";
import { bankOptions } from "@/lib/banks";
import type { BankCode } from "@/lib/generated/prisma/enums";

const OPTIONS: AccountOption[] = bankOptions();
const nameOnly = (o: AccountOption) => o.name;

/** The bank of a bank account: the banks Buku knows (`lib/banks.ts`), grouped and searchable, *Bank lain* last. */
export function BankPicker({ value, onChange, className }: { value: BankCode; onChange: (code: BankCode) => void; className?: string }) {
  return (
    <AccountPicker
      value={value}
      onChange={(v) => onChange(v as BankCode)}
      options={OPTIONS}
      ariaLabel="Bank"
      placeholder="Pilih bank"
      searchPlaceholder="Cari bank"
      emptyText="Bank tidak ada di daftar. Pilih Bank lain."
      labelOf={nameOnly}
      className={className}
    />
  );
}
