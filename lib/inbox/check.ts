import type { Db } from "@/lib/db";
import type { UploadItem, UploadKind, UploadStatus } from "@/lib/generated/prisma/client";
import { hash, json } from "@/lib/evidence/store";
import { postableTables } from "@/lib/evidence/extract";
import { parseStatementSections } from "@/lib/import/parsers/index";
import { PdfPasswordError } from "@/lib/import/parsers/pdf";
import { ScanError, SourceAmountError, SourceCurrencyError, SourceDateError, StatementRepairError, UnreadableFileError, YearNeededError, type ParsedStatement } from "@/lib/import/types";
import { sniffFile } from "@/lib/import/workbook";
import { addPassword, NeedsPasswordError, openWithKeyring } from "./keyring";
import { storeFile } from "./store";

/** One statement of a bank file as read (amounts in whole Rupiah as strings: JSON has no bigint). */
export type BankSection = {
  bank: string;
  number: string | null;
  holder: string | null;
  currency: string | null;
  periodStart: string;
  periodEnd: string;
  rows: number;
  opening: string;
  closing: string;
  error: string | null;
};
/** One table of a ledger / Neraca file the ledger import would read. */
export type LedgerSection = { sheet: string; mode: "LEDGER" | "NERACA"; rows: number; periodStart: string | null; periodEnd: string | null };

/** What the Unggah page shows for one file: no bytes, no password. */
export type InboxItem = {
  id: string;
  batchId: string;
  fileName: string;
  kind: UploadKind;
  status: UploadStatus;
  message: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  sections: BankSection[] | LedgerSection[];
  evidenceVersionId: string | null;
  statementImportIds: string[];
  ledgerImportId: string | null;
  createdAt: string;
};

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export function itemView(row: UploadItem): InboxItem {
  return {
    id: row.id,
    batchId: row.batchId,
    fileName: row.fileName,
    kind: row.kind,
    status: row.status,
    message: row.message,
    periodStart: day(row.periodStart),
    periodEnd: day(row.periodEnd),
    sections: row.sections as BankSection[] | LedgerSection[],
    evidenceVersionId: row.evidenceVersionId,
    statementImportIds: row.statementImportIds,
    ledgerImportId: row.ledgerImportId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The account holder printed on the statement. Remove the cast when #143 (bank-reader-fixes) lands and `holder` is on ParsedStatement. */
function holderOf(st: ParsedStatement): string | null {
  return (st as { holder?: string }).holder ?? null;
}

function bankSection(st: ParsedStatement): BankSection {
  return {
    bank: st.format,
    number: st.accountNumber,
    holder: holderOf(st),
    currency: st.section?.currency ?? st.currency ?? null,
    periodStart: day(st.periodStart)!,
    periodEnd: day(st.periodEnd)!,
    rows: st.rows.length,
    opening: st.openingBalance.toString(),
    closing: st.closingBalance.toString(),
    error: st.error ?? null,
  };
}

/** Tables the ledger import would read; none for PDFs and for files that aren't spreadsheets or CSV tables. */
async function ledgerSections(name: string, data: Buffer): Promise<LedgerSection[]> {
  if (sniffFile(data) === "PDF") return [];
  const tables = await postableTables(name, data);
  return [...tables].map(([sheet, t]) => ({ sheet, mode: t.mode, rows: t.rows, periodStart: t.periodStart, periodEnd: t.periodEnd }));
}

const span = (starts: (string | null)[], ends: (string | null)[]) => {
  const s = starts.filter((x): x is string => !!x).sort();
  const e = ends.filter((x): x is string => !!x).sort();
  return { periodStart: s[0] ? new Date(s[0]) : null, periodEnd: e.length ? new Date(e.at(-1)!) : null };
};

type Outcome = { kind: UploadKind; status: UploadStatus; message: string | null; sections: BankSection[] | LedgerSection[]; periodStart: Date | null; periodEnd: Date | null };
const outcome = (kind: UploadKind, status: UploadStatus, message: string | null): Outcome => ({ kind, status, message, sections: [], periodStart: null, periodEnd: null });
const KEPT = "Disimpan di Dokumen.";
const ledgerOutcome = (sections: LedgerSection[], message: string | null): Outcome => ({ kind: "LEDGER", status: "CHECKED", message, sections, ...span(sections.map((t) => t.periodStart), sections.map((t) => t.periodEnd)) });

/** A refusal that only a real bank statement produces: the reader's message is the answer (year, date order, amounts, currency). */
const statementRefusal = (e: unknown) => e instanceof YearNeededError || e instanceof SourceDateError || e instanceof SourceAmountError || e instanceof SourceCurrencyError;

async function classify(db: Db, input: CheckInput): Promise<Outcome> {
  const { name, data } = input;
  // Non-password errors come back as values: a password that opened the file still opened it, whatever the reader says next.
  const tryOpen = async (password?: string): Promise<{ sections: ParsedStatement[] } | { error: unknown }> => {
    try {
      return { sections: await parseStatementSections(name, data, { password }) };
    } catch (e) {
      if (e instanceof PdfPasswordError) throw e;
      return { error: e };
    }
  };
  let opened;
  try {
    opened = await openWithKeyring(db, { firmId: input.firmId, clientId: input.clientId }, tryOpen, { offered: input.password });
  } catch (e) {
    if (e instanceof NeedsPasswordError) return outcome(sniffFile(data) === "PDF" ? "BANK" : "OTHER", "NEEDS_PASSWORD", e.message);
    throw e;
  }
  let note: string | null = null;
  if (opened.usedOffered) {
    try {
      await addPassword(db, { firmId: input.firmId, clientId: input.clientId, password: input.password!, actorId: input.actorId });
    } catch (e) {
      note = e instanceof Error ? e.message : null;
    }
  }
  const read = opened.result;

  if ("sections" in read) {
    // A ledger with a balance column reads as a generic statement too: a postable ledger table wins over the generic reader.
    if (read.sections.every((st) => st.format === "GENERIC")) {
      const ledger = await ledgerSections(name, data);
      if (ledger.length) return ledgerOutcome(ledger, note);
    }
    const sections = read.sections.map(bankSection);
    const period = span(sections.map((s) => s.periodStart), sections.map((s) => s.periodEnd));
    const failed = sections.every((s) => s.error);
    return { kind: "BANK", status: failed ? "FAILED" : "CHECKED", message: failed ? sections[0].error : note, sections, ...period };
  }

  const e = read.error;
  if (e instanceof ScanError) return outcome("OTHER", "KEPT", e.message);
  if (statementRefusal(e)) return outcome("BANK", "FAILED", (e as Error).message);
  if (e instanceof UnreadableFileError) {
    const ledger = await ledgerSections(name, data);
    if (ledger.length) return ledgerOutcome(ledger, note);
    if (e instanceof StatementRepairError) return outcome("BANK", "FAILED", e.message);
  }
  return outcome("OTHER", "KEPT", KEPT);
}

type CheckInput = { firmId: string; clientId: string; batchId: string; name: string; data: Buffer; password?: string; actorId?: string | null };

/**
 * Stores one dropped file in the client's inbox and reads what it is — bank statement, ledger / Neraca, or another document — without
 * writing any journal. The outcome is an `UploadItem` row (the page's persistent per-file line); booking happens later (T3).
 */
export async function checkFile(db: Db, input: CheckInput): Promise<InboxItem> {
  const fileName = input.name.trim().slice(0, 240) || "file";
  const base = { firmId: input.firmId, clientId: input.clientId, batchId: input.batchId, fileName };
  let stored;
  try {
    stored = await storeFile(db, { firmId: input.firmId, clientId: input.clientId, name: fileName, data: input.data });
  } catch (e) {
    // A foreign or missing client is refused outright; a file the store refuses (size, capacity) still gets its line.
    if (e instanceof Error && e.message === "Klien tidak ditemukan.") throw e;
    const message = e instanceof Error ? e.message : "File tidak bisa disimpan.";
    return itemView(await db.uploadItem.create({ data: { ...base, sha256: hash(input.data), kind: "OTHER", status: "FAILED", message } }));
  }
  const result = await classify(db, { ...input, name: fileName });
  const row = await db.uploadItem.create({
    data: {
      ...base,
      sha256: stored.sha256,
      evidenceVersionId: stored.versionId,
      kind: result.kind,
      status: result.status,
      message: result.message,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      sections: json(result.sections),
    },
  });
  return itemView(row);
}
