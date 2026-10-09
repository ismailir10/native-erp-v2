import type { Db } from "@/lib/db";
import type { BankCode } from "@/lib/generated/prisma/enums";
import { parseStatementSections } from "@/lib/import/parsers";
import { PdfPasswordError } from "@/lib/import/parsers/pdf";
import type { RememberedLayout } from "@/lib/import/mapped";
import { ParseError, ScanError, UnreadableFileError, YearNeededError } from "@/lib/import/types";

/**
 * Reading a statement file without importing it: which account(s) of the client it belongs to and which period it covers. The batch
 * upload shows this for every file before anything is written. Nothing is stored, no AI is called.
 */

/** One account section of a file. `READY` can be imported into `bankAccountId`; `PICK` has no number to match, the accountant picks. */
export type PeekLine = {
  number: string | null;
  label: string;
  currency: string;
  /** The client's account the number points at (or the only account when the file names none); null for `PICK` and the refused. */
  bankAccountId: string | null;
  periodStart: string;
  periodEnd: string;
  rows: number;
  status: "READY" | "PICK" | "NO_ACCOUNT" | "FOREIGN" | "ERROR";
  /** Why the line can't be imported (status NO_ACCOUNT, FOREIGN, ERROR) or what Buku assumed (the only account). */
  note?: string;
};

export type PeekResult =
  | { ok: true; fileBank: BankCode; lines: PeekLine[] }
  | { ok: false; kind: "PASSWORD" | "YEAR" | "SCAN" | "UNREADABLE" | "ERROR"; error: string; yearGuess?: number | null };

const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
const day = (d: Date) => d.toISOString().slice(0, 10);

export async function peekStatement(db: Db, args: { clientId: string; fileName: string; data: Buffer; password?: string; year?: number }): Promise<PeekResult> {
  const client = await db.client.findUniqueOrThrow({ where: { id: args.clientId }, include: { entities: { include: { bankAccounts: true } } } });
  const accounts = client.entities.flatMap((e) => e.bankAccounts.map((b) => ({ ...b, functionalCurrency: e.functionalCurrency })));
  // The firm's Atur kolom layouts of the banks this client uses (Rupiah accounts only, as in `importStatement`).
  const banks = [...new Set(accounts.filter((a) => a.currency === "IDR" && a.functionalCurrency === "IDR").map((a) => a.bank))];
  const layouts = banks.length
    ? (await db.statementLayout.findMany({ where: { firmId: client.firmId, bank: { in: banks } }, select: { id: true, label: true, signature: true, mapping: true } })).map((l) => ({ ...l, mapping: l.mapping as unknown as RememberedLayout["mapping"] }))
    : [];
  let sections;
  try {
    sections = await parseStatementSections(args.fileName, args.data, { password: args.password, year: args.year, layouts });
  } catch (e) {
    if (e instanceof PdfPasswordError) return { ok: false, kind: "PASSWORD", error: e.message };
    if (e instanceof YearNeededError) return { ok: false, kind: "YEAR", error: e.message, yearGuess: e.guess };
    if (e instanceof ScanError) return { ok: false, kind: "SCAN", error: e.message };
    if (e instanceof UnreadableFileError) return { ok: false, kind: "UNREADABLE", error: e.message };
    if (e instanceof ParseError) return { ok: false, kind: "ERROR", error: e.message };
    throw e;
  }
  const only = accounts.length === 1 ? accounts[0] : null;
  const lines = sections.map((s): PeekLine => {
    const base = {
      number: s.accountNumber,
      label: s.section?.label ?? "",
      currency: s.section?.currency ?? "IDR",
      periodStart: day(s.periodStart),
      periodEnd: day(s.periodEnd),
      rows: s.rows.length,
    };
    if (s.error) return { ...base, bankAccountId: null, status: "ERROR", note: s.error };
    if (base.currency !== "IDR") return { ...base, bankAccountId: null, status: "FOREIGN", note: `Rekening ${s.accountNumber} dalam ${base.currency}. Rekening koran valas belum didukung; impor lewat buku besar dengan kurs.` };
    if (s.accountNumber) {
      const match = accounts.find((a) => digits(a.number) === digits(s.accountNumber));
      return match
        ? { ...base, bankAccountId: match.id, status: "READY" }
        : { ...base, bankAccountId: null, status: "NO_ACCOUNT", note: `Nomor ${s.accountNumber} bukan rekening klien ini. Tambahkan rekeningnya di klien atau pilih rekening yang sesuai.` };
    }
    return only
      ? { ...base, bankAccountId: only.id, status: "READY", note: "File tidak mencantumkan nomor rekening; dipasangkan ke satu-satunya rekening klien." }
      : { ...base, bankAccountId: null, status: "PICK", note: "File tidak mencantumkan nomor rekening. Pilih rekeningnya." };
  });
  return { ok: true, fileBank: sections[0].format, lines };
}
