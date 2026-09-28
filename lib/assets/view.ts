import type { Db } from "@/lib/db";
import { assetCandidates, assetRegister, registerVsLedger, unregisteredSchedules } from "@/lib/assets/register";
import { FISCAL_METHOD_LABEL, TAX_GROUPS } from "@/lib/assets/fiscal";
import { formatDate, toIsoDate } from "@/lib/format";

/** Serialisable views of the register for the Aset Tetap page (bigint as string across the server → client boundary, rule 6). */

export type AssetRowView = {
  id: string;
  name: string;
  groupLabel: string;
  methodLabel: string;
  acquired: string;
  acquiredIso: string;
  account: string;
  /** For the drill to the ledger: the asset account and the accumulated-depreciation account (null for land). */
  assetCode: string;
  accumulatedCode: string | null;
  lifeMonths: number | null;
  cost: string;
  accumulated: string;
  bookValue: string;
  bookYtd: string;
  fiscalYtd: string | null;
  difference: string | null;
  unposted: number;
  disposed: string | null;
  proceeds: string | null;
};

export type EntityRegisterView = {
  entity: { id: string; name: string; shortName: string; currency: string };
  rows: AssetRowView[];
  totals: { cost: string; accumulated: string; bookValue: string; bookYtd: string; fiscalYtd: string | null; difference: string | null };
  ledger: { cost: string; accumulated: string; assetAccounts: string[]; accumulatedAccounts: string[]; equal: boolean } | null;
};

export type AssetCandidateView = { key: string; entryId: string; entityId: string; entity: string; currency: string; accountCode: string; account: string; date: string; dateIso: string; amount: string; description: string };
export type ScheduleLinkView = { id: string; entityId: string; entity: string; currency: string; memo: string; amount: string; months: number; start: string; expense: string; accumulated: string; accountCode: string | null; /** The purchase entry's date, when the schedule stored it. */ sourceDateIso: string | null };

const sum = (xs: bigint[]) => xs.reduce((t, x) => t + x, 0n);

export async function registerViews(db: Db, clientId: string, year: number, month: number, entities: { id: string; name: string; shortName: string; functionalCurrency: string; kind: string }[]): Promise<EntityRegisterView[]> {
  const ids = entities.map((e) => e.id);
  const [rows, ledger] = await Promise.all([assetRegister(db, clientId, year, month, ids), registerVsLedger(db, clientId, year, month, ids)]);
  // Companies first (PT/CV, then the owner).
  const ordered = [...entities].sort((a, b) => Number(a.kind === "PERORANGAN") - Number(b.kind === "PERORANGAN"));
  return ordered
    .map((e) => {
      const mine = rows.filter((r) => r.entity.id === e.id);
      const idr = e.functionalCurrency === "IDR";
      const cmp = ledger.find((l) => l.entityId === e.id);
      return {
        entity: { id: e.id, name: e.name, shortName: e.shortName, currency: e.functionalCurrency },
        rows: mine.map((r) => ({
          id: r.id,
          name: r.name,
          groupLabel: TAX_GROUPS[r.taxGroup].label,
          methodLabel: r.taxGroup === "TANAH" ? "–" : FISCAL_METHOD_LABEL[r.fiscalMethod],
          acquired: formatDate(r.acquiredOn),
          acquiredIso: toIsoDate(r.acquiredOn),
          account: `${r.assetAccount.code} ${r.assetAccount.name}`,
          assetCode: r.assetAccount.code,
          accumulatedCode: r.accumulatedAccount?.code ?? null,
          lifeMonths: r.usefulLifeMonths,
          cost: r.cost.toString(),
          accumulated: r.accumulated.toString(),
          bookValue: r.bookValue.toString(),
          bookYtd: r.bookYtd.toString(),
          fiscalYtd: r.fiscalYtd?.toString() ?? null,
          difference: r.difference?.toString() ?? null,
          unposted: r.unposted,
          disposed: r.disposedOn ? formatDate(r.disposedOn) : null,
          proceeds: r.proceeds?.toString() ?? null,
        })),
        totals: {
          cost: sum(mine.map((r) => r.cost)).toString(),
          accumulated: sum(mine.map((r) => r.accumulated)).toString(),
          bookValue: sum(mine.map((r) => r.bookValue)).toString(),
          bookYtd: sum(mine.map((r) => r.bookYtd)).toString(),
          fiscalYtd: idr ? sum(mine.map((r) => r.fiscalYtd ?? 0n)).toString() : null,
          difference: idr ? sum(mine.map((r) => r.difference ?? 0n)).toString() : null,
        },
        ledger: cmp ? { cost: cmp.ledger.cost.toString(), accumulated: cmp.ledger.accumulated.toString(), assetAccounts: cmp.assetAccounts, accumulatedAccounts: cmp.accumulatedAccounts, equal: cmp.equal } : null,
      };
    })
    .filter((v) => v.rows.length > 0);
}

export async function candidateViews(db: Db, clientId: string, entityIds: string[]): Promise<AssetCandidateView[]> {
  return (await assetCandidates(db, clientId, entityIds)).map((c) => ({
    key: `${c.entryId}:${c.account.code}`,
    entryId: c.entryId,
    entityId: c.entity.id,
    entity: c.entity.shortName,
    currency: c.entity.functionalCurrency,
    accountCode: c.account.code,
    account: `${c.account.code} ${c.account.name}`,
    date: formatDate(c.date),
    dateIso: toIsoDate(c.date),
    amount: c.amount.toString(),
    description: c.description,
  }));
}

export async function scheduleLinkViews(db: Db, clientId: string, entityIds: string[]): Promise<ScheduleLinkView[]> {
  return (await unregisteredSchedules(db, clientId, entityIds)).map((s) => ({
    id: s.id,
    entityId: s.entity.id,
    entity: s.entity.shortName,
    currency: s.entity.functionalCurrency,
    memo: s.memo,
    amount: s.amount.toString(),
    months: s.months,
    start: `${s.startYear}-${String(s.startMonth).padStart(2, "0")}`,
    expense: `${s.debitAccount.code} ${s.debitAccount.name}`,
    accumulated: `${s.creditAccount.code} ${s.creditAccount.name}`,
    accountCode: s.sourceAccount?.code ?? null,
    sourceDateIso: s.sourceEntry ? toIsoDate(s.sourceEntry.date) : null,
  }));
}
