import { beforeEach, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { runControls } from "@/lib/controls";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";

beforeEach(resetDb);

it("asks for a bank statement only from the month the books start", async () => {
  const g = await makeGroup();
  const acc = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
  // PT: Saldo Awal on 31 May → May needs no statement, June does.
  await db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 5, 31), kind: "OPENING", memo: "Saldo awal", lines: [{ accountId: await acc("1101"), debit: 1_000n }, { accountId: await acc("3200"), credit: 1_000n }] }));
  // Owner: no Saldo Awal, first statement from July → June needs none, August does.
  const bri = g.owner.banks[0];
  await db.statementImport.create({ data: { firmId: g.firm.id, bankAccountId: bri.id, fileName: "bri-jul.csv", format: "BRI", periodStart: dateOnly(2026, 7, 1), periodEnd: dateOnly(2026, 7, 31), openingBalance: 0n, closingBalance: 0n, rowCount: 0, continuityOk: true } });

  const bank = async (month: number, id: string) => (await runControls(db, g.client.id, 2026, month)).find((c) => c.key === `bank:${id}`)!;
  expect(await bank(5, g.pt.banks[0].id)).toMatchObject({ status: "PASS", detail: "Pembukuan rekening ini mulai 1 Jun 2026" });
  expect(await bank(6, g.pt.banks[0].id)).toMatchObject({ status: "REVIEW", detail: "Mutasi bulan ini belum diimpor" });
  expect(await bank(6, bri.id)).toMatchObject({ status: "PASS", detail: "Pembukuan rekening ini mulai 1 Jul 2026" });
  expect(await bank(8, bri.id)).toMatchObject({ status: "REVIEW", detail: "Mutasi bulan ini belum diimpor" });
});
