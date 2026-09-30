import type { Db, Tx } from "@/lib/db";
import type { ClassifyMethod, Direction } from "@/lib/generated/prisma/enums";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { parseStatementSections } from "@/lib/import/parsers";
import { checkContinuity, isGenericKey, merchantKey, rowHash } from "@/lib/import/normalize";
import { AccountMismatchError, ParseError, type ParsedStatement } from "@/lib/import/types";
import { matchRule, sortRules } from "@/lib/classify/rules";
import { financingSuggestion, taxPaymentSuggestion } from "@/lib/classify/financing";
import { simpleGuess } from "@/lib/classify/fallback";
import { matchTransfers, type TransferCandidate } from "@/lib/classify/transfer";
import { AUTO_POST_CONFIDENCE, type Classification } from "@/lib/classify/types";
import { suggestWithAi } from "@/lib/ai/classify";
import type { AiProvider } from "@/lib/ai/provider";
import { postBankTransaction } from "@/lib/ledger/bank";
import { defaultTaxMonth } from "@/lib/tax/masa";
import { formatDate, formatPeriod } from "@/lib/format";

export type ImportSummary = {
  importId: string;
  rows: number;
  duplicates: number;
  posted: number;
  needsReview: number;
  byMethod: Record<ClassifyMethod, number>;
  ai: { calls: number; cacheHits: number; note?: string };
  continuityOk: boolean;
  continuityNote: string | null;
  /** Combined statements: the other account sections in the file, not imported into this bank account. */
  otherSections: string[];
  /** The same sections as data, so the form can offer "Impor juga ke …" for the client's matching accounts. */
  otherAccounts: { number: string; label: string; currency: string; imported: boolean }[];
  /** Lines of this client still waiting in Review after the import (any month), for the result's next step. */
  pendingReview: number;
  /** Choices the parser made (direction read from the balance, sheets joined): stored on the import and shown. */
  notes: string[];
  /** The months the statement covers ("Mei 2026"), first to last. */
  months: string[];
};

export async function importStatement(
  db: Db,
  args: { evidenceVersionId?: string; evidenceUnitKey?: string; bankAccountId: string; fileName: string; data: Buffer; provider: AiProvider | null; password?: string; year?: number; actorId?: string | null },
): Promise<ImportSummary> {
  const bankAccount = await db.bankAccount.findUniqueOrThrow({
    where: { id: args.bankAccountId },
    include: { entity: { include: { client: { include: { entities: true } } } } },
  });
  const entity = bankAccount.entity;
  const client = entity.client;

  const sections = await parseStatementSections(args.fileName, args.data, { password: args.password, year: args.year });
  const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
  const st = sections.length === 1 ? sections[0] : sections.find((s) => digits(s.accountNumber) === digits(bankAccount.number));
  if (!st) {
    const list = sections.map((s) => `${s.accountNumber}${s.section ? ` ${s.section.label} (${s.section.currency})` : ""}`).join(", ");
    throw new AccountMismatchError(`File ini berisi ${sections.length} rekening (${list}), tapi tidak ada nomor ${bankAccount.number}. Pilih rekening yang sesuai atau tambahkan rekeningnya di klien.`, sections.flatMap((s) => (s.accountNumber ? [s.accountNumber] : [])));
  }
  if (st.accountNumber && digits(st.accountNumber) !== digits(bankAccount.number)) {
    throw new AccountMismatchError(`Nomor rekening di file (${st.accountNumber}) berbeda dengan rekening terpilih (${bankAccount.number}).`, [st.accountNumber]);
  }
  if (st.section && st.section.currency !== "IDR") {
    throw new ParseError(`Rekening ${st.accountNumber} dalam ${st.section.currency}. Rekening koran valas belum didukung; impor lewat buku besar dengan kurs.`);
  }
  const others = sections.filter((s) => s !== st);
  const otherSections = others.map((s) => `${s.accountNumber} ${s.section?.label ?? ""} (${s.section?.currency ?? "IDR"}): tidak diimpor ke rekening ini`);
  // An account of this client already holding an import of the same period doesn't need "Impor juga ke …" again.
  const done = await db.statementImport.findMany({
    where: { bankAccount: { entity: { clientId: client.id } }, OR: others.map((s) => ({ periodStart: s.periodStart, periodEnd: s.periodEnd })) },
    select: { periodStart: true, periodEnd: true, bankAccount: { select: { number: true } } },
  });
  const otherAccounts = others.flatMap((s) =>
    s.accountNumber
      ? [{
          number: s.accountNumber,
          label: s.section?.label ?? "",
          currency: s.section?.currency ?? "IDR",
          imported: done.some((d) => digits(d.bankAccount.number) === digits(s.accountNumber) && +d.periodStart === +s.periodStart && +d.periodEnd === +s.periodEnd),
        }]
      : [],
  );
  const pendingReviewCount = () => db.bankTransaction.count({ where: { bankAccount: { entity: { clientId: client.id } }, status: "NEEDS_REVIEW" } });
  const continuity = checkContinuity(st);

  const locked = await db.period.findMany({ where: { clientId: client.id, status: "LOCKED" } });
  const lockedHit = st.rows.find((r) => locked.some((p) => p.year === r.date.getUTCFullYear() && p.month === r.date.getUTCMonth() + 1));
  if (lockedHit) {
    throw new ParseError(`Periode ${formatPeriod(lockedHit.date.getUTCFullYear(), lockedHit.date.getUTCMonth() + 1)} sudah ditutup. Buka periode dulu atau pilih file lain.`);
  }

  // Dedupe against what's already imported for this bank account (see `dedupe`); checked again under the account's lock when writing.
  const hashes = st.rows.map(rowHash);
  const seen = await dedupe(db, bankAccount.id, st, hashes);
  const fresh = st.rows.map((r, i) => ({ r, hash: hashes[i] })).filter((_, i) => !seen.duplicate[i]);
  const notes = [...(st.notes ?? []), ...seen.notes];

  // Saldo Awal already contains everything up to its date: a new row on or before it would be counted twice and break the bank
  // reconciliation. Only rows not yet imported count, so a statement that was imported before stays importable.
  const opening = await db.journalEntry.findFirst({ where: { entityId: entity.id, kind: "OPENING" }, orderBy: { date: "asc" }, select: { date: true } });
  const early = opening ? fresh.filter(({ r }) => +r.date <= +opening.date) : [];
  if (opening && early.length) {
    const first = early.reduce((a, b) => (+b.r.date < +a.r.date ? b : a)).r.date;
    throw new ParseError(`Saldo awal ${entity.shortName} dicatat per ${formatDate(opening.date)}, sudah termasuk transaksi sampai tanggal itu. File ini berisi ${early.length} transaksi bertanggal sampai ${formatDate(opening.date)} (paling awal ${formatDate(first)}). Pilih file yang mulai setelah tanggal itu, atau koreksi saldo awal lewat Jurnal Penyesuaian.`);
  }

  // Nothing new and the statement is already on file: no second history row claiming an import that changed nothing.
  if (fresh.length === 0 && !args.evidenceVersionId) {
    const existing = await db.statementImport.findFirst({ where: { bankAccountId: bankAccount.id, periodStart: { lte: st.periodEnd }, periodEnd: { gte: st.periodStart } }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (existing) {
      return {
        importId: existing.id,
        rows: st.rows.length,
        duplicates: st.rows.length,
        posted: 0,
        needsReview: 0,
        byMethod: { TRANSFER: 0, RULE: 0, MEMORY: 0, AI: 0, HEURISTIC: 0, MANUAL: 0 },
        ai: { calls: 0, cacheHits: 0 },
        continuityOk: continuity.ok,
        continuityNote: continuity.note,
        otherSections,
        otherAccounts,
        pendingReview: await pendingReviewCount(),
        notes,
        months: monthsOf(st.periodStart, st.periodEnd),
      };
    }
  }

  const items = fresh.map(({ r, hash }, i) => ({
    id: `new-${i}`,
    hash,
    row: r,
    entityId: entity.id,
    bankAccountId: bankAccount.id,
    date: r.date,
    description: r.description,
    merchantKey: merchantKey(r.description),
    direction: (r.amount >= 0n ? "IN" : "OUT") as Direction,
    amount: r.amount,
  }));

  // ---- classification (reads only; AI runs outside the write transaction) ----
  const window = items.length
    ? { gte: new Date(items[0].date.getTime() - 6 * 86_400_000), lte: new Date(items[items.length - 1].date.getTime() + 6 * 86_400_000) } // ≥ 2 business days across any weekend
    : undefined;
  const openCounterparts: TransferCandidate[] = window
    ? (
        await db.bankTransaction.findMany({
          where: { bankAccount: { entity: { clientId: client.id } }, matchedTxId: null, date: window, bankAccountId: { not: bankAccount.id } },
        })
      ).map((t) => ({ ...t, id: t.id }))
    : [];
  // Short names ("PT AND") are too collision-prone for substring matching; use distinctive names only.
  const ownNames = client.entities.map((e) => ({ entityId: e.id, names: [e.name, e.shortName].map((n) => n.toUpperCase()).filter((n) => n.length >= 8) }));
  const transfers = matchTransfers([...items, ...openCounterparts], ownNames);

  const rules = sortRules(await db.rule.findMany({ where: { firmId: client.firmId, OR: [{ clientId: client.id }, { clientId: null }] } }));
  const memories = await db.memory.findMany({ where: { clientId: client.id } });
  // Generic keys (no counterparty) were never meant to be learned; older books may still hold some — ignore them.
  const memoryMap = new Map(memories.filter((m) => !isGenericKey(m.merchantKey)).map((m) => [`${m.merchantKey}|${m.direction}`, m]));

  const accounts = await db.account.findMany({ where: { clientId: client.id }, orderBy: { code: "asc" } });
  const codes = new Set(accounts.map((a) => a.code));

  const result = new Map<string, Classification>();
  const pendingAi: { key: string; direction: Direction; sample: string }[] = [];
  for (const it of items) {
    const financing = financingSuggestion(it.description, it.direction) ?? taxPaymentSuggestion(it.description, it.direction);
    const c =
      transfers.get(it.id) ??
      matchRule(rules, it.description, it.direction, codes) ??
      (() => {
        const m = memoryMap.get(`${it.merchantKey}|${it.direction}`);
        return m
          ? ({ method: "MEMORY", accountCode: m.accountCode, taxTag: m.taxTag, confidence: 0.95, reason: `Pernah dikonfirmasi ${m.hits}× untuk "${m.merchantKey}"` } as Classification)
          : null;
      })() ??
      // Loans, capital, own-money moves and tax payments: a balance-sheet suggestion for review, no AI call (rules 13–14).
      (financing && codes.has(financing.accountCode) ? financing : null);
    if (c) result.set(it.id, c);
    else pendingAi.push({ key: it.merchantKey, direction: it.direction, sample: it.description });
  }

  const postable = accounts.filter((a) => !a.isBank && !a.isSuspense && !a.isRetained).map((a) => ({ code: a.code, name: a.name }));
  const ai = await suggestWithAi(db, {
    firmId: client.firmId,
    clientId: client.id,
    clientName: `${client.name} (${client.industry ?? "umum"})`,
    coaVersion: client.coaVersion,
    accounts: postable,
    pending: pendingAi,
    provider: args.provider,
  });
  for (const it of items) {
    if (result.has(it.id)) continue;
    result.set(it.id, ai.suggestions.get(`${it.merchantKey}|${it.direction}`) ?? simpleGuess(it.direction, entity.kind));
  }

  // ---- write: import + transactions + journals, all-or-nothing ----
  const byMethod = { TRANSFER: 0, RULE: 0, MEMORY: 0, AI: 0, HEURISTIC: 0, MANUAL: 0 } as Record<ClassifyMethod, number>;
  let needsReview = 0;
  const codeToId = new Map(accounts.map((a) => [a.code, a.id]));

  const importId = await db.$transaction(
    async (tx) => {
      // Two copies of a statement imported at once must not both pass the dedupe: serialise per bank account and look again.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`import:${bankAccount.id}`}, 0))::text`;
      const now = await dedupe(tx, bankAccount.id, st, hashes);
      if (now.duplicate.some((d, i) => d !== seen.duplicate[i])) throw new ParseError("Rekening ini baru saja menerima impor lain. Ulangi impor file ini.");
      const imp = await tx.statementImport.create({
        data: {
          firmId: client.firmId,
          bankAccountId: bankAccount.id,
          fileName: args.fileName,
          evidenceVersionId: args.evidenceVersionId,
          evidenceUnitKey: args.evidenceUnitKey,
          format: st.format,
          periodStart: st.periodStart,
          periodEnd: st.periodEnd,
          openingBalance: st.openingBalance,
          closingBalance: st.closingBalance,
          rowCount: st.rows.length,
          duplicateCount: st.rows.length - fresh.length,
          continuityOk: continuity.ok,
          continuityNote: continuity.note,
          parseNotes: notes,
          deposits: (st.deposits ?? []).map((d) => ({ ...d, idrBalance: d.idrBalance.toString() })),
          importedById: args.actorId ?? null,
        },
      });
      const idMap = new Map<string, string>();
      for (const it of items) {
        const c = result.get(it.id)!;
        const auto = c.method !== "AI" && c.method !== "HEURISTIC" && c.confidence >= AUTO_POST_CONFIDENCE;
        const created = await tx.bankTransaction.create({
          data: {
            firmId: client.firmId,
            importId: imp.id,
            bankAccountId: bankAccount.id,
            entityId: entity.id,
            date: it.date,
            description: it.description,
            merchantKey: it.merchantKey,
            direction: it.direction,
            amount: it.amount,
            balance: it.row.balance,
            rowNumber: it.row.rowNumber,
            sourceSheet: it.row.sheet ?? null,
            rawRow: it.row.rawRow,
            hash: it.hash,
            status: auto ? "POSTED" : "NEEDS_REVIEW",
            method: c.method,
            confidence: c.confidence,
            reason: c.reason,
            accountCode: auto ? c.accountCode : ACCOUNT_CODES.SUSPENSE,
            suggestedCode: c.accountCode,
            taxTag: c.taxTag,
            taxMonth: c.taxTag === "PPH_25" ? defaultTaxMonth(it.date) : null,
          },
        });
        idMap.set(it.id, created.id);
        byMethod[c.method]++;
        if (!auto) needsReview++;
        await postBankTransaction(tx, created.id, auto ? { accountCode: c.accountCode, taxTag: c.taxTag } : { accountCode: ACCOUNT_CODES.SUSPENSE }, { codeToId, actorId: args.actorId });
      }
      // Link transfer pairs (both new, or new ↔ previously imported open half).
      for (const [id, c] of transfers) {
        if (!c.matchedTxId) continue;
        const selfId = idMap.get(id) ?? id;
        const otherId = idMap.get(c.matchedTxId) ?? c.matchedTxId;
        if (id.startsWith("new-")) {
          await tx.bankTransaction.update({ where: { id: selfId }, data: { matchedTxId: otherId } });
        } else {
          // Previously imported half: link and move it onto the transfer account if it was elsewhere.
          const prev = await tx.bankTransaction.update({ where: { id: selfId }, data: { matchedTxId: otherId } });
          if (prev.accountCode !== c.accountCode) {
            await postBankTransaction(tx, prev.id, { accountCode: c.accountCode }, { codeToId, actorId: args.actorId });
            await tx.bankTransaction.update({
              where: { id: prev.id },
              data: { accountCode: c.accountCode, status: "POSTED", method: "TRANSFER", confidence: c.confidence, reason: c.reason, taxTag: null },
            });
          }
        }
      }
      return imp.id;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  return {
    importId,
    rows: st.rows.length,
    duplicates: st.rows.length - fresh.length,
    posted: items.length - needsReview,
    needsReview,
    byMethod,
    ai: ai.usage,
    continuityOk: continuity.ok,
    continuityNote: continuity.note,
    otherSections,
    otherAccounts,
    pendingReview: await pendingReviewCount(),
    notes,
    months: monthsOf(st.periodStart, st.periodEnd),
  };
}

function monthsOf(start: Date, end: Date): string[] {
  const index = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
  const out: string[] = [];
  for (let k = index(start); k <= index(end); k++) out.push(formatPeriod(Math.floor(k / 12), (k % 12) + 1));
  return out;
}

/**
 * Lines of `st` already in the books of the bank account. First the same row again (same file: same hash). Then, only when the file
 * covers what is already there — every line already imported within the file's statement period has a twin (same date and amount) in
 * the file — the same bank line from another source of that statement: a PDF and the accountant's Excel copy word descriptions
 * differently, and a PDF may print the balance only once a day. Twins are matched one to one; the balance only picks among them (a
 * source that missed a line has every later balance off). A file that doesn't cover the period (a supplement, a partial slice) keeps its
 * lines, with a note when some look like lines already there.
 */
async function dedupe(db: Db | Tx, bankAccountId: string, st: ParsedStatement, hashes: string[]) {
  const already = await db.bankTransaction.findMany({
    where: { bankAccountId, date: { gte: st.periodStart, lte: st.periodEnd } },
    select: { id: true, hash: true, date: true, amount: true, balance: true },
    orderBy: [{ date: "asc" }, { rowNumber: "asc" }],
  });
  const unmatched = new Set(already.map((t) => t.id));
  const duplicate = hashes.map((h) => {
    const same = already.find((t) => t.hash === h && unmatched.has(t.id));
    if (same) unmatched.delete(same.id);
    return !!same;
  });
  // Coverage: every remaining line already imported in the period must have a twin among the file's remaining lines.
  const key = (d: Date, a: bigint) => `${+d}|${a}`;
  const offered = new Map<string, number>();
  st.rows.forEach((r, i) => !duplicate[i] && offered.set(key(r.date, r.amount), (offered.get(key(r.date, r.amount)) ?? 0) + 1));
  const needed = new Map<string, number>();
  for (const t of already.filter((x) => unmatched.has(x.id))) needed.set(key(t.date, t.amount), (needed.get(key(t.date, t.amount)) ?? 0) + 1);
  const covers = [...needed].every(([k, n]) => (offered.get(k) ?? 0) >= n);
  let fromOtherSource = 0;
  let lookAlike = 0;
  st.rows.forEach((r, i) => {
    if (duplicate[i]) return;
    const twins = already.filter((t) => unmatched.has(t.id) && +t.date === +r.date && t.amount === r.amount);
    if (!twins.length) return;
    if (!covers) {
      lookAlike++;
      return;
    }
    const twin = twins.find((t) => t.balance !== null && t.balance === r.balance) ?? twins[0];
    unmatched.delete(twin.id);
    duplicate[i] = true;
    fromOtherSource++;
  });
  const notes = [
    ...(fromOtherSource ? [`${fromOtherSource} baris sama dengan mutasi yang sudah diimpor dari file lain (tanggal dan nominal sama, keterangan berbeda); dilewati.`] : []),
    ...(lookAlike ? [`${lookAlike} baris bertanggal dan bernominal sama dengan mutasi yang sudah ada, tetapi file ini tidak mencakup semua mutasi periodenya, jadi tetap diimpor. Periksa Rekonsiliasi bank bulan itu.`] : []),
  ];
  return { duplicate, notes };
}
