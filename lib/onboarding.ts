import type { Db } from "@/lib/db";
import { createClient, type ClientSpec } from "@/lib/setup";
import { isCurrency } from "@/lib/fx/currency";

/**
 * "Tambah klien": a real client with its entities (PT/CV/owner), each with its functional currency and optional bank
 * accounts (a company whose books come from a ledger file has none). Reuses createClient(), so the client gets the
 * template COA and one GL bank account (1101–1109) per bank account.
 */
/** `fields` maps a form path ("name", "entities.0.banks.1.number") to what to fix, so the form can mark every field at once. */
export class OnboardingError extends Error {
  constructor(readonly fields: Record<string, string>) {
    const n = Object.keys(fields).length;
    super(n === 1 ? Object.values(fields)[0] : `Periksa ${n} isian yang ditandai.`);
  }
}

const KINDS = ["PT", "CV", "PERORANGAN"] as const;
const BANKS = ["BCA", "MANDIRI", "BRI", "SMBC", "GENERIC"] as const;
const BANK_NAME: Record<(typeof BANKS)[number], string> = { BCA: "BCA", MANDIRI: "Mandiri", BRI: "BRI", SMBC: "SMBC", GENERIC: "Bank" };

export type NewClientInput = {
  name: string;
  industry: string;
  entities: { name: string; shortName: string; kind: (typeof KINDS)[number]; npwp: string; currency?: string; banks: { bank: (typeof BANKS)[number]; number: string; label: string; isOverdraft?: boolean }[] }[];
};

/** Every problem at once, keyed by field. Optional: industry, short name, NPWP, bank accounts, account label (defaults to "BCA ••5566"). */
export function validateNewClient(input: NewClientInput): ClientSpec {
  const fields: Record<string, string> = {};
  const name = input.name.trim();
  if (!name) fields.name = "Isi nama klien.";
  else if (name.length > 120) fields.name = "Nama klien maksimal 120 karakter.";
  if (input.entities.length === 0) fields.entities = "Tambahkan minimal satu entitas.";

  const seen = new Map<string, string>();
  const entities = input.entities.map((e, i) => {
    const at = `entities.${i}`;
    const eName = e.name.trim();
    if (!eName) fields[`${at}.name`] = e.kind === "PERORANGAN" ? "Isi nama pemilik." : "Isi nama badan usaha.";
    if (!KINDS.includes(e.kind)) fields[`${at}.kind`] = "Pilih jenis entitas.";
    if (e.npwp.trim() && !/^[\d.\-\s]{15,25}$/.test(e.npwp.trim())) fields[`${at}.npwp`] = "NPWP berisi 15 atau 16 angka, boleh dengan titik dan strip.";
    const currency = (e.currency ?? "IDR").trim().toUpperCase();
    if (!isCurrency(currency)) fields[`${at}.currency`] = "Pilih mata uang dari daftar.";
    const banks = e.banks.map((b, k) => {
      const bt = `${at}.banks.${k}`;
      if (!BANKS.includes(b.bank)) fields[`${bt}.bank`] = "Pilih bank.";
      const number = b.number.replace(/[\s.\-]/g, "");
      if (!number) fields[`${bt}.number`] = "Isi nomor rekening.";
      else if (!/^\d{6,20}$/.test(number)) fields[`${bt}.number`] = "Nomor rekening berisi 6–20 angka.";
      else if (seen.has(number)) fields[`${bt}.number`] = "Nomor ini sudah dimasukkan di atas.";
      else seen.set(number, bt);
      const label = b.label.trim() || `${BANK_NAME[b.bank] ?? "Bank"}${b.isOverdraft ? " PRK" : ""} ••${number.slice(-4)}`;
      return { bank: b.bank, number, label: label.slice(0, 60), isOverdraft: Boolean(b.isOverdraft) };
    });
    return { name: eName, shortName: e.shortName.trim() || eName, kind: e.kind, npwp: e.npwp.trim() || undefined, functionalCurrency: currency, banks };
  });
  if (seen.size > 9) fields.entities = "Maksimal 9 rekening bank per klien.";
  if (Object.keys(fields).length) throw new OnboardingError(fields);

  // Companies first, then owners — the order every list in the app uses.
  const rank = { PT: 0, CV: 1, PERORANGAN: 2 } as const;
  return { name, industry: input.industry.trim(), entities: [...entities].sort((a, b) => rank[a.kind] - rank[b.kind]) };
}

export async function addClient(db: Db, firmId: string, input: NewClientInput) {
  const spec = validateNewClient(input);
  const { client } = await db.$transaction((tx) => createClient(tx, firmId, spec));
  return client;
}
