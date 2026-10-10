import { exactLegacyStatement } from "@/lib/import/revalidate";
import { readValidation, type StatementValidation } from "@/lib/import/validation";
import type { Db, Tx } from "@/lib/db";
import { ParseError, type ParsedStatement } from "@/lib/import/types";

/** Exact source identity first; date/amount similarity alone never removes or doubles a payment. */
export async function dedupeStatement(db: Db | Tx, bankAccountId: string, st: ParsedStatement, hashes: string[], written: (string | null)[] = [], sourceHash?: string, validation?: StatementValidation) {
  const range = st.rows.reduce((r, row) => ({ start: Math.min(r.start, +row.date), end: Math.max(r.end, +row.date) }), { start: +st.periodStart, end: +st.periodEnd });
  const already = await db.bankTransaction.findMany({
    where: { bankAccountId, OR: [
      { date: { gte: new Date(range.start), lte: new Date(range.end) } },
      { hash: { in: [...new Set(written.filter((h): h is string => h !== null))] } },
    ] },
    select: { id: true, hash: true, date: true, amount: true, balance: true, import: { select: { sourceValidation: true } } },
  });
  // Sparse balances and same-day cycles cannot prove individual cross-source
  // rows. A unique, unchanged complete legacy owner can prove the whole source.
  // Use the caller's pre-filter validation so discarded zero rows cannot erase a
  // source conflict. The write/attestation paths recheck under the account lock.
  if (validation && already.some((row) => row.import.sourceValidation === null)
    && await exactLegacyStatement(db, bankAccountId, st, hashes, validation)) {
    return { duplicate: hashes.map(() => true), notes: [] as string[] };
  }
  type Existing = typeof already[number];
  const byHash = new Map(already.map((row) => [row.hash, row]));
  const key = (row: { date: Date; amount: bigint }) => `${+row.date}|${row.amount}`;
  const byMovement = new Map<string, Set<Existing>>();
  const byBalance = new Map<string, Set<Existing>>();
  for (const row of already) {
    for (const [map, value] of [[byMovement, key(row)], [byBalance, `${key(row)}|${row.balance}`]] as const) {
      let bucket = map.get(value);
      if (!bucket) map.set(value, bucket = new Set());
      bucket.add(row);
    }
  }
  const consume = (row: Existing) => {
    byHash.delete(row.hash);
    byMovement.get(key(row))!.delete(row);
    byBalance.get(`${key(row)}|${row.balance}`)!.delete(row);
  };
  let asWritten = 0;
  const duplicate = hashes.map((h, i) => {
    const exact = byHash.get(h);
    // A row hash is not a file identity: fees can repeat after a same-day balance
    // cycle. Only the exact source bytes bypass independent balance evidence.
    const sameSource = exact && sourceHash && readValidation(exact.import.sourceValidation)?.sourceHash === sourceHash ? exact : undefined;
    const legacyWritten = written[i] && written[i] !== h ? byHash.get(written[i]!) : undefined;
    const same = sameSource ?? legacyWritten;
    if (same) consume(same);
    if (same && same.hash !== h) asWritten++;
    return !!same;
  });

  // Row numbers and IDs are not ordering evidence across imports. Each day must
  // have one connected balance chain, with no branches, cycles or repeated balances.
  type ChainRow = { date: Date; amount: bigint; balance: bigint | null };
  const dailyChains = (rows: ChainRow[]) => {
    const days = new Map<number, ChainRow[]>();
    for (const row of rows) {
      const day = +row.date;
      let group = days.get(day);
      if (!group) days.set(day, group = []);
      group.push(row);
    }
    const chains = new Map<number, { proved: boolean; closing: bigint | null }>();
    for (const [day, group] of days) {
      const from = new Map<bigint, ChainRow>();
      const to = new Map<bigint, ChainRow>();
      let possible = true;
      for (const row of group) {
        if (row.balance === null) { possible = false; break; }
        const opening = row.balance - row.amount;
        if (from.has(opening) || to.has(row.balance)) { possible = false; break; }
        from.set(opening, row);
        to.set(row.balance, row);
      }
      const ends = possible ? group.filter((r) => !from.has(r.balance!)) : [];
      const visited = new Set<ChainRow>();
      if (ends.length === 1) {
        let row: ChainRow | undefined = ends[0];
        while (row && !visited.has(row)) {
          visited.add(row);
          row = to.get(row.balance! - row.amount);
        }
      }
      chains.set(day, { proved: ends.length === 1 && visited.size === group.length, closing: ends.length === 1 ? ends[0].balance : null });
    }
    return chains;
  };
  const storedChains = dailyChains(already);
  const incomingChains = dailyChains(st.rows);
  const firstDate = st.rows.reduce((d, r) => Math.min(d, +r.date), Infinity);
  const finalDate = already.reduce((d, r) => Math.max(d, +r.date), -Infinity);
  const finalChain = storedChains.get(finalDate);
  const continues = st.provenance?.opening === "PRINTED" && finalChain?.proved && finalChain.closing === st.openingBalance && finalDate <= firstDate;
  let otherSource = 0;
  st.rows.forEach((r, i) => {
    if (duplicate[i]) return;
    const twins = byMovement.get(key(r));
    if (!twins?.size) return;
    const proved = r.balance === null ? undefined : byBalance.get(`${key(r)}|${r.balance}`);
    const unambiguous = storedChains.get(+r.date)?.proved && incomingChains.get(+r.date)?.proved;
    if (proved?.size === 1 && unambiguous) {
      consume(proved.values().next().value!);
      duplicate[i] = true;
      otherSource++;
      return;
    }
    if (continues && incomingChains.get(+r.date)?.proved && r.balance !== null && !byBalance.get(`${key(r)}|null`)?.size && !proved?.size) return;
    throw new ParseError(`Baris ${r.sheet ? `${r.sheet}!` : ""}${r.rowNumber} mungkin sama dengan mutasi yang sudah diimpor (tanggal dan nominal sama), tetapi saldo tidak membuktikan identitasnya. Impor dibatalkan tanpa perubahan. Periksa kedua file; bila file baru mengoreksi file lama, hapus impor lama terlebih dahulu lalu impor file lengkap yang benar.`);
  });
  return {
    duplicate,
    notes: [
      ...(asWritten ? [`${asWritten} baris sudah diimpor sebelumnya seperti tertulis di file, sebelum diperbaiki; dilewati. Untuk memakai perbaikannya, hapus impor lama lalu impor ulang file ini.`] : []),
      ...(otherSource ? [`${otherSource} baris dari file lain dikenali dari tanggal, nominal, dan saldo yang sama; dilewati.`] : []),
    ],
  };
}
