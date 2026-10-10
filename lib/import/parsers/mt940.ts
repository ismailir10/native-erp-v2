import { bankName, bankOfBic } from "@/lib/banks";
import type { BankCode } from "@/lib/generated/prisma/enums";
import { dateOnly } from "@/lib/format";
import { parseRupiah } from "@/lib/money";
import { ParseError, type ParsedRow, type ParsedStatement } from "@/lib/import/types";
import { SenWatch } from "@/lib/import/parsers/common";

/**
 * SWIFT MT940 customer statements — what BCA, Mandiri, BRI, CIMB Niaga, Maybank, UOB, OCBC, DBS, HSBC, Citi and Bank Jatim deliver to
 * business clients (download, SFTP or SWIFT). One reader for all of them:
 * - `:20:` opens a statement, `:25:` names the account (`CENAIDJA/0000012345` or just the number), `:28C:` the page;
 * - `:60F:`/`:60M:` the opening balance (`C|D`, `YYMMDD`, currency, comma decimals), `:62F:`/`:62M:` the closing;
 * - `:61:` one transaction: value date `YYMMDD`, optional booking date `MMDD`, `C`/`D` (or `RC`/`RD`, a reversal: the other way),
 *   an optional funds code, the amount, the type code (`NTRF`, `FMSC` …), the references;
 * - `:86:` the narrative of the `:61:` above it, over several lines: the description.
 * A file may hold many statements (one per day or per page); they are joined per account and currency, and each statement's closing
 * is printed on its last row, so the running-balance check (rule 12) sees a gap between days. Several accounts or a foreign currency
 * become sections, like a combined PDF. MT940 prints no balance per row; the bank comes from the BIC in the header or in `:25:`.
 */
export function isMt940(text: string): boolean {
  const head = text.slice(0, 4000);
  return /^:20:/m.test(head) && /^:25:/m.test(head) && /^:(60[FM]|61):/m.test(text);
}

type Tag = { tag: string; value: string; line: number };
type Block = { account: string; currency: string; opening: bigint; openingDate: Date; closing: bigint | null; closingDate: Date | null; rows: ParsedRow[]; page: string | null; line: number; openingTag: string; closingTag: string | null; exactOpening: string; exactClosing: string | null; movements: string[] };

const BALANCE = /^([CD])(\d{2})(\d{2})(\d{2})([A-Z]{3})(\d+(?:,\d*)?)$/;
// Value date, booking date, mark, funds code, amount, transaction type, customer reference [//bank reference].
const STATEMENT_LINE = /^(\d{2})(\d{2})(\d{2})(\d{4})?(RC|RD|C|D)([A-Z])?(\d+,\d*)([NSF][A-Z0-9]{3})(.*)$/;

const dateOf = (yy: string, mm: string, dd: string, line: number) => {
  const d = dateOnly(2000 + Number(yy), Number(mm), Number(dd));
  if (d.getUTCFullYear() !== 2000 + Number(yy) || d.getUTCMonth() + 1 !== Number(mm) || d.getUTCDate() !== Number(dd)) throw new ParseError(`Tanggal MT940 tidak ada di kalender di baris ${line}: ${dd}/${mm}/${yy}`);
  return d;
};

function balanceOf(t: Tag): { amount: bigint; date: Date; currency: string; exact: string } {
  const m = t.value.replace(/\s+/g, "").match(BALANCE);
  if (!m) throw new ParseError(`Saldo MT940 :${t.tag}: di baris ${t.line} tidak bisa dibaca: "${t.value.slice(0, 40)}"`);
  const amount = parseRupiah(m[6]);
  return { amount: m[1] === "D" ? -amount : amount, date: dateOf(m[2], m[3], m[4], t.line), currency: m[5], exact: `${m[1] === "D" ? "-" : ""}${m[6]}` };
}

/** The SWIFT basic, application and user header blocks at the start of a line (block 3 nests `{108:…}`). */
const ENVELOPE = /^(?:\{[1-3]:(?:[^{}]|\{[^{}]*\})*\})+/;

/** The tags of the text block, each with its continuation lines; header blocks `{1:…}{2:…}{4:` and the `-}` trailer are dropped. */
function tags(text: string): Tag[] {
  const out: Tag[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    // Every message of a multi-message export repeats its envelope ({1:…}{2:…}{3:{…}}{4:) and ends with "-}" (maybe "-}{5:{CHK:…}}").
    const line = raw.replace(ENVELOPE, "").replace(/^\{4:/, "").replace(/\s+$/, "");
    if (!line || /^-\}?(\{5:.*)?$/.test(line) || /^\{5:/.test(line)) return;
    const m = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (m) out.push({ tag: m[1], value: m[2], line: i + 1 });
    else if (out.length) out[out.length - 1].value += `\n${line}`;
  });
  return out;
}

/** The bank of a file: a BIC in the SWIFT header blocks or in front of the account number. */
function bankOf(text: string, accounts: string[]): BankCode {
  const header = text.slice(0, 400).match(/\{[12]:[^}]*\}/g)?.join(" ") ?? "";
  for (const candidate of [...header.matchAll(/[A-Z]{4}ID[A-Z0-9]{2}/g)].map((m) => m[0]).concat(accounts.map((a) => a.split("/")[0]))) {
    const bank = bankOfBic(candidate);
    if (bank) return bank;
  }
  return "GENERIC";
}

/** "CENAIDJA/0000012345", "0000012345", "IDR 0000 012 345" → the account number as the bank prints it on statements. */
function accountNumber(raw: string): string {
  const tail = raw.split("/").pop()!.trim();
  const digits = tail.replace(/[\s.-]/g, "");
  return /^\d{6,}$/.test(digits) ? digits : tail.replace(/^[A-Z]{3}(?=\d)/, "").replace(/\s+/g, "");
}

export function parseMt940(text: string): ParsedStatement[] {
  const all = tags(text.replace(/^﻿/, ""));
  const blocks: Block[] = [];
  const sen = new SenWatch();
  let block: Block | null = null;
  let account = "";
  let page: string | null = null;
  let last: ParsedRow | null = null;
  let messageLine: number | null = null;
  const requireOpening = () => {
    if (messageLine !== null && !block) throw new ParseError(`Pernyataan MT940 di baris ${messageLine} terpotong: saldo awal (:60F: atau :60M:) tidak ditemukan.`);
  };
  for (const t of all) {
    switch (t.tag) {
      case "20":
        requireOpening();
        messageLine = t.line;
        block = null;
        account = "";
        page = null;
        last = null;
        break;
      case "25":
        if (account) throw new ParseError(`Nomor rekening MT940 berulang di baris ${t.line}.`);
        account = t.value.split("\n")[0].trim();
        break;
      case "28C":
      case "28":
        if (page || block) throw new ParseError(`Urutan halaman MT940 tidak sesuai di baris ${t.line}.`);
        page = t.value.trim();
        if (!/^\d{1,5}(?:\/\d{1,5})?$/.test(page) || page.split("/").some((n) => Number(n) < 1)) throw new ParseError(`Nomor pernyataan/halaman MT940 tidak valid di baris ${t.line}.`);
        break;
      case "60F":
      case "60M": {
        if (block) throw new ParseError(`Saldo awal MT940 berulang sebelum pernyataan baru di baris ${t.line}.`);
        if (!account) throw new ParseError(`MT940 tanpa nomor rekening (:25:) sebelum saldo awal di baris ${t.line}.`);
        const b = balanceOf(t);
        block = { account, currency: b.currency, opening: b.amount, openingDate: b.date, closing: null, closingDate: null, rows: [], page, line: t.line, openingTag: t.tag, closingTag: null, exactOpening: b.exact, exactClosing: null, movements: [] };
        blocks.push(block);
        last = null;
        break;
      }
      case "61": {
        if (!block) throw new ParseError(`Transaksi MT940 (:61:) di baris ${t.line} muncul sebelum saldo awal (:60F:).`);
        if (block.closing !== null) throw new ParseError(`Transaksi MT940 muncul setelah saldo akhir di baris ${t.line}.`);
        const [first, ...extra] = t.value.split("\n");
        const m = first.replace(/\s+/g, "").match(STATEMENT_LINE);
        if (!m) throw new ParseError(`Baris transaksi MT940 :61: di baris ${t.line} tidak bisa dibaca: "${first.slice(0, 50)}"`);
        const [, yy, mm, dd, booking, mark, , amountText, type, refs] = m;
        const value = dateOf(yy, mm, dd, t.line);
        let date = value;
        if (booking) {
          // The booking date carries no year: the value date's, one later or earlier across a year end.
          const bm = Number(booking.slice(0, 2));
          const y = 2000 + Number(yy) + (bm === 1 && Number(mm) === 12 ? 1 : bm === 12 && Number(mm) === 1 ? -1 : 0);
          date = dateOf(String(y - 2000).padStart(2, "0"), booking.slice(0, 2), booking.slice(2), t.line);
        }
        sen.check(amountText, t.line);
        const amount = parseRupiah(amountText);
        // C = credit (in), D = debit (out); a reversal of a credit (RC) takes money out, of a debit (RD) puts it back.
        const out = mark === "D" || mark === "RC";
        block.movements.push(`${out ? "-" : ""}${amountText}`);
        const reference = [refs.replace(/^NONREF/, "").replace(/\/\//, " "), ...extra].join(" ").replace(/\s+/g, " ").trim();
        last = {
          date,
          description: `${type.slice(1)} ${reference}`.trim(),
          amount: out ? -amount : amount,
          balance: null,
          rowNumber: t.line,
          rawRow: `:61:${t.value.replace(/\n/g, " ")}`,
        };
        block.rows.push(last);
        break;
      }
      case "86":
        if (last) {
          last.description = t.value.replace(/\n/g, " ").replace(/\s+/g, " ").trim() || last.description;
          last.rawRow += ` / :86:${t.value.replace(/\n/g, " ")}`;
        }
        break;
      case "62F":
      case "62M": {
        if (!block) throw new ParseError(`Saldo akhir MT940 (:${t.tag}:) di baris ${t.line} tanpa saldo awal.`);
        const b = balanceOf(t);
        if (block.closing !== null) throw new ParseError(`Saldo akhir MT940 berulang di baris ${t.line}.`);
        if (b.currency !== block.currency) throw new ParseError(`Mata uang saldo awal dan akhir MT940 berbeda di baris ${t.line}.`);
        block.closingTag = t.tag;
        block.exactClosing = b.exact;
        block.closing = b.amount;
        block.closingDate = b.date;
        // The statement's closing is the balance after its last row: the chain is checked across statements.
        if (block.rows.length) block.rows[block.rows.length - 1].balance = b.amount;
        last = null;
        break;
      }
      default:
        break;
    }
  }
  requireOpening();
  if (!blocks.length) throw new ParseError("File MT940 tidak berisi saldo awal (:60F:).");

  // Validate source decimals before IDR rounding: foreign-currency sections remain
  // inspectable, but their source totals must still agree exactly.
  const exactUnits = (value: string, scale: number): bigint => {
    const [whole, fraction = ""] = value.replace(/^-/, "").split(",");
    const units = BigInt(whole + fraction.padEnd(scale, "0"));
    return value.startsWith("-") ? -units : units;
  };
  const equalAmounts = (left: string, right: string) => {
    const scale = Math.max(...[left, right].map((v) => v.split(",")[1]?.length ?? 0));
    return exactUnits(left, scale) === exactUnits(right, scale);
  };
  for (const b of blocks) {
    if (b.closing === null || !b.closingDate || b.exactClosing === null) throw new ParseError(`Pernyataan MT940 di baris ${b.line} tidak memiliki saldo akhir (:62F: atau :62M:).`);
    if (+b.closingDate < +b.openingDate) throw new ParseError(`Tanggal saldo akhir MT940 mendahului saldo awal di baris ${b.line}.`);
    if (b.rows.some((r) => +r.date < +b.openingDate || +r.date > +b.closingDate!)) throw new ParseError(`Tanggal transaksi MT940 di luar periode saldo awal dan akhir pada baris ${b.line}.`);
    const values = [b.exactOpening, ...b.movements, b.exactClosing];
    const scale = values.reduce((max, v) => Math.max(max, v.split(",")[1]?.length ?? 0), 0);
    const total = [b.exactOpening, ...b.movements].reduce((sum, v) => sum + exactUnits(v, scale), 0n);
    if (total !== exactUnits(b.exactClosing, scale)) throw new ParseError(`Saldo MT940 tidak sesuai di baris ${b.line}: saldo awal ditambah transaksi tidak sama dengan saldo akhir tercetak.`);
  }

  // One statement per account and currency, its blocks in file order.
  const groups = new Map<string, Block[]>();
  for (const b of blocks) {
    const key = `${accountNumber(b.account)}|${b.currency}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  const fileBank = bankOf(text, blocks.map((b) => b.account));
  // A statement's bank: the BIC in front of its own account ("BMRIIDJA/…"), else the file's header — one file may forward several banks.
  const bankOfGroup = (group: Block[]) => (group[0].account.includes("/") ? bankOfBic(group[0].account.split("/")[0]) : null) ?? fileBank;
  const statements = [...groups.values()].map((group): ParsedStatement => {
    const format = bankOfGroup(group);
    const first = group[0];
    const lastBlock = group[group.length - 1];
    if (first.openingTag !== "60F" || lastBlock.closingTag !== "62F") throw new ParseError(`Halaman MT940 rekening ${accountNumber(first.account)} tidak lengkap: diperlukan saldo awal :60F: dan saldo akhir :62F:.`);
    if (first.page && Number(first.page.split("/")[1] ?? 1) !== 1) throw new ParseError(`Halaman pertama MT940 tidak lengkap di baris ${first.line}.`);
    for (let k = 1; k < group.length; k++) {
      const prev = group[k - 1];
      const current = group[k];
      if (+current.openingDate < +prev.closingDate!) throw new ParseError(`Urutan tanggal pernyataan MT940 tidak sesuai di baris ${current.line}.`);
      if (+current.openingDate > +prev.closingDate!) throw new ParseError(`Periode MT940 terputus di baris ${current.line}: tanggal saldo awal tidak menyambung saldo akhir sebelumnya. Lengkapi pernyataan untuk selang tanggal yang hilang.`);
      if ((prev.closingTag === "62M") !== (current.openingTag === "60M")) throw new ParseError(`Urutan saldo antara MT940 tidak sesuai di baris ${current.line}.`);
      if (prev.page && current.page) {
        const [previousStatement, previousPage = 1] = prev.page.split("/").map(Number);
        const [statement, pageNumber = 1] = current.page.split("/").map(Number);
        const continuation = statement === previousStatement && pageNumber === previousPage + 1;
        const nextStatement = pageNumber === 1 && (statement === previousStatement + 1 || (statement === 1 && current.openingDate.getUTCFullYear() > prev.openingDate.getUTCFullYear()));
        if (!continuation && !nextStatement) throw new ParseError(`Urutan pernyataan/halaman MT940 terputus di baris ${current.line}.`);
      }
      if (!equalAmounts(current.exactOpening, prev.exactClosing!)) {
        throw new ParseError(`Saldo MT940 rekening ${accountNumber(first.account)} tidak nyambung: pernyataan ${group[k].page ?? k + 1} dibuka ${group[k].opening.toLocaleString("id-ID")}, pernyataan sebelumnya ditutup ${prev.closing!.toLocaleString("id-ID")}.`);
      }
    }
    const rows = group.flatMap((b) => b.rows);
    const closing = lastBlock.closing!;
    const start = new Date(+first.openingDate + 86_400_000);
    const end = lastBlock.closingDate!;
    // An opening dated on the first booking day is also valid; do not exclude that row.
    const earliestRow = rows.reduce((earliest, row) => +row.date < +earliest ? row.date : earliest, start);
    const notes = ["Dibaca sebagai MT940 (SWIFT). File ini tanpa saldo per baris; saldo dicek dari saldo awal dan saldo akhir setiap pernyataan."];
    if (group.length > 1) notes.push(`${group.length} pernyataan MT940 rekening ini digabung menjadi satu rekening koran.`);
    const senNote = sen.note();
    if (senNote) notes.push(senNote);
    return {
      format,
      accountNumber: accountNumber(first.account),
      currency: first.currency,
      provenance: { period: "DECLARED", opening: "PRINTED", closing: "PRINTED" },
      periodStart: +earliestRow <= +end ? earliestRow : end,
      periodEnd: end,
      openingBalance: first.opening,
      closingBalance: closing,
      rows,
      notes,
    };
  });
  const keys = [...groups.keys()];
  if (statements.length === 1 && keys[0].endsWith("|IDR")) return statements;
  // The section's name: its bank (the number is printed beside it already).
  return statements.map((st, k) => ({ ...st, section: { label: st.format === "GENERIC" ? "MT940" : bankName(st.format), currency: keys[k].split("|")[1] } }));
}
