import type { AccountType, NormalBalance, TaxTag } from "@/lib/generated/prisma/enums";

/**
 * Standard COA template (SAK EP-style presentation, Bahasa). Applied per Client.
 * Special accounts (never renumber — referenced by code across the app):
 *   1190 intercompany · 1199 transfer clearing · 1999 suspense · 3200 retained earnings.
 * Bank GL accounts (11xx) are created per BankAccount by `bankAccountCode()`.
 */
export type AccountSeed = {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  fsLine: FsLine;
  isIntercompany?: boolean;
  isClearing?: boolean;
  isSuspense?: boolean;
  isRetained?: boolean;
  isBank?: boolean;
  taxTag?: TaxTag;
};

export const ACCOUNT_CODES = {
  INTERCOMPANY: "1190",
  CLEARING: "1199",
  SUSPENSE: "1999",
  RETAINED: "3200",
  PPN_MASUKAN: "1150",
  PPN_KELUARAN: "2130",
  OPENING_EQUITY: "3100",
} as const;

export const FS_LINES = {
  KAS_SETARA_KAS: { label: "Kas dan setara kas", section: "ASET_LANCAR" },
  PIUTANG_USAHA: { label: "Piutang usaha", section: "ASET_LANCAR" },
  PIUTANG_LAIN: { label: "Piutang lain-lain", section: "ASET_LANCAR" },
  PERSEDIAAN: { label: "Persediaan", section: "ASET_LANCAR" },
  PAJAK_DIBAYAR_DIMUKA: { label: "Pajak dibayar di muka", section: "ASET_LANCAR" },
  BIAYA_DIBAYAR_DIMUKA: { label: "Uang muka & biaya dibayar di muka", section: "ASET_LANCAR" },
  SUSPENSE: { label: "Pos belum terklasifikasi", section: "ASET_LANCAR" },
  ASET_TETAP: { label: "Aset tetap", section: "ASET_TIDAK_LANCAR" },
  AKUM_PENYUSUTAN: { label: "Akumulasi penyusutan", section: "ASET_TIDAK_LANCAR" },
  UTANG_USAHA: { label: "Utang usaha", section: "LIABILITAS" },
  UTANG_PAJAK: { label: "Utang pajak", section: "LIABILITAS" },
  UTANG_LAIN: { label: "Utang lain-lain", section: "LIABILITAS" },
  UTANG_BANK: { label: "Utang bank", section: "LIABILITAS" },
  MODAL: { label: "Modal", section: "EKUITAS" },
  SALDO_LABA: { label: "Saldo laba", section: "EKUITAS" },
  PRIVE: { label: "Prive / penarikan pemilik", section: "EKUITAS" },
  PENDAPATAN_USAHA: { label: "Pendapatan usaha", section: "LABA_RUGI" },
  HPP: { label: "Beban pokok pendapatan", section: "LABA_RUGI" },
  BEBAN_PENJUALAN: { label: "Beban penjualan", section: "LABA_RUGI" },
  BEBAN_UMUM_ADM: { label: "Beban umum & administrasi", section: "LABA_RUGI" },
  PENDAPATAN_LAIN: { label: "Pendapatan lain-lain", section: "LABA_RUGI" },
  BEBAN_LAIN: { label: "Beban lain-lain", section: "LABA_RUGI" },
  BEBAN_PAJAK: { label: "Beban pajak", section: "LABA_RUGI" },
} as const;
export type FsLine = keyof typeof FS_LINES;

const a = (
  code: string,
  name: string,
  type: AccountType,
  fsLine: FsLine,
  extra: Partial<AccountSeed> = {},
): AccountSeed => ({
  code,
  name,
  type,
  fsLine,
  normalBalance: type === "ASET" || type === "BEBAN" ? "DEBIT" : "CREDIT",
  ...extra,
});

export const COA_TEMPLATE: AccountSeed[] = [
  a("1110", "Kas Kecil", "ASET", "KAS_SETARA_KAS"),
  a("1130", "Piutang Usaha", "ASET", "PIUTANG_USAHA"),
  a("1150", "PPN Masukan", "ASET", "PAJAK_DIBAYAR_DIMUKA", { taxTag: "PPN_MASUKAN" }),
  a("1160", "Persediaan", "ASET", "PERSEDIAAN"),
  a("1170", "Uang Muka & Biaya Dibayar di Muka", "ASET", "BIAYA_DIBAYAR_DIMUKA"),
  a("1190", "Piutang/Utang Antar Entitas", "ASET", "PIUTANG_LAIN", { isIntercompany: true }),
  a("1199", "Kliring Transfer Antar Rekening", "ASET", "PIUTANG_LAIN", { isClearing: true }),
  a("1210", "Aset Tetap", "ASET", "ASET_TETAP"),
  a("1219", "Akumulasi Penyusutan", "ASET", "AKUM_PENYUSUTAN", { normalBalance: "CREDIT" }),
  a("1999", "Belum Terklasifikasi", "ASET", "SUSPENSE", { isSuspense: true }),
  a("2110", "Utang Usaha", "LIABILITAS", "UTANG_USAHA"),
  a("2130", "PPN Keluaran", "LIABILITAS", "UTANG_PAJAK", { taxTag: "PPN_KELUARAN" }),
  a("2140", "Utang PPh 21", "LIABILITAS", "UTANG_PAJAK", { taxTag: "PPH_21" }),
  a("2141", "Utang PPh 23", "LIABILITAS", "UTANG_PAJAK", { taxTag: "PPH_23" }),
  a("2150", "Beban Masih Harus Dibayar", "LIABILITAS", "UTANG_LAIN"),
  a("2210", "Utang Bank", "LIABILITAS", "UTANG_BANK"),
  a("3100", "Modal Disetor", "EKUITAS", "MODAL"),
  a("3200", "Saldo Laba", "EKUITAS", "SALDO_LABA", { isRetained: true }),
  a("3300", "Prive / Penarikan Pemilik", "EKUITAS", "PRIVE", { normalBalance: "DEBIT" }),
  a("4100", "Penjualan", "PENDAPATAN", "PENDAPATAN_USAHA"),
  a("4110", "Pendapatan Jasa", "PENDAPATAN", "PENDAPATAN_USAHA"),
  a("4900", "Pendapatan Bunga & Jasa Giro", "PENDAPATAN", "PENDAPATAN_LAIN"),
  a("4910", "Pendapatan Lain-lain", "PENDAPATAN", "PENDAPATAN_LAIN"),
  a("5100", "Pembelian Bahan & Barang Dagang", "BEBAN", "HPP"),
  a("5110", "Biaya Kemitraan & Produksi", "BEBAN", "HPP"),
  a("6100", "Beban Gaji & Tunjangan", "BEBAN", "BEBAN_UMUM_ADM"),
  a("6110", "Beban BPJS", "BEBAN", "BEBAN_UMUM_ADM"),
  a("6120", "Beban Sewa", "BEBAN", "BEBAN_UMUM_ADM"),
  a("6130", "Beban Listrik, Air & Internet", "BEBAN", "BEBAN_UMUM_ADM"),
  a("6140", "Beban Transportasi & Logistik", "BEBAN", "BEBAN_PENJUALAN"),
  a("6150", "Beban Pemasaran", "BEBAN", "BEBAN_PENJUALAN"),
  a("6160", "Beban Perlengkapan Kantor", "BEBAN", "BEBAN_UMUM_ADM"),
  a("6170", "Beban Jasa Profesional", "BEBAN", "BEBAN_UMUM_ADM"),
  a("6180", "Beban Penyusutan", "BEBAN", "BEBAN_UMUM_ADM"),
  a("6190", "Beban Umum Lain-lain", "BEBAN", "BEBAN_UMUM_ADM"),
  a("7100", "Beban Administrasi Bank", "BEBAN", "BEBAN_LAIN"),
  a("7110", "Beban Bunga Pinjaman", "BEBAN", "BEBAN_LAIN"),
  a("8100", "Beban Pajak Penghasilan", "BEBAN", "BEBAN_PAJAK", { taxTag: "PPH_25" }),
  a("8200", "Beban Pajak Final PPh 4(2)", "BEBAN", "BEBAN_PAJAK", { taxTag: "PPH_4_2" }),
];

/** Bank GL accounts live at 1101–1109 (max 9 bank accounts per client in MVP). */
export function bankAccountCode(index: number): string {
  if (index < 0 || index > 8) throw new Error("Maksimal 9 rekening bank per klien");
  return `110${index + 1}`;
}

export const TAX_TAG_LABEL: Record<TaxTag, string> = {
  PPN_KELUARAN: "PPN Keluaran",
  PPN_MASUKAN: "PPN Masukan",
  PPH_21: "PPh 21",
  PPH_23: "PPh 23",
  PPH_4_2: "PPh 4(2)",
  PPH_25: "PPh 25",
};
