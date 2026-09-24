import type { Db } from "@/lib/db";
import { createClient, createFirm } from "@/lib/setup";
import { importStatement } from "@/lib/import/pipeline";
import { reviewTransaction } from "@/lib/review";
import { postJournal } from "@/lib/ledger/post";
import { CLOSE_SIGNOFFS, lockPeriod, runControls } from "@/lib/controls";
import { DEMO_AI_MODEL, MockProvider } from "@/lib/ai/provider";
import { dateOnly } from "@/lib/format";
import { merchantKey } from "@/lib/import/normalize";
import { aiCacheKey } from "@/lib/ai/classify";
import { renderStatement } from "@/lib/demo/writers";
import { aiTable, DEMO_MONTHS, scenarios, statementFiles, type ClientScenario, type Truth } from "@/lib/demo/scenario";

export const OPENING_DATE = dateOnly(2026, 2, 28);
export const DEPRECIATION = { clientKey: "grup-ayam", entity: 0, monthly: 9_500_000n };

const lineKey = (accountNumber: string, date: Date, amount: bigint, description: string) =>
  `${accountNumber}|${date.toISOString().slice(0, 10)}|${amount}|${description}`;

/** Wipes all firm data. Keeps migrations and AppSetting (deployment config such as the AI key). */
export async function truncateAll(db: Db) {
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations', 'AppSetting')`,
  );
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`);
}

/**
 * Rebuilds the whole demo through the REAL pipeline: parse → classify → post → review → close.
 * Months ≤ closedThrough are reviewed with the generator's truth (simulating the accountant),
 * which also trains Memory — so AI usage falls month over month exactly as it would in real use.
 */
export async function seedDemo(db: Db, opts: { log?: (s: string) => void; liveAi?: boolean } = {}) {
  const log = opts.log ?? (() => {});
  await truncateAll(db);
  const firm = await db.$transaction((tx) => createFirm(tx, "KJA Demo & Rekan"));

  for (const sc of scenarios()) {
    const { client, entities } = await db.$transaction((tx) => createClient(tx, firm.id, sc.spec));
    log(`• ${client.name}`);
    await postOpenings(db, sc, client.id, entities);

    const truth = new Map<string, Truth>();
    for (const l of sc.lines) {
      const b = sc.banks[l.bankKey];
      truth.set(lineKey(sc.spec.entities[b.entity].banks[b.bank].number, l.date, l.amount, l.description), l.truth);
    }
    const openKeys = new Set(
      sc.lines.filter((l) => l.open).map((l) => {
        const b = sc.banks[l.bankKey];
        return lineKey(sc.spec.entities[b.entity].banks[b.bank].number, l.date, l.amount, l.description);
      }),
    );
    const table = aiTable(sc);
    const provider = new MockProvider(table, DEMO_AI_MODEL);
    const files = statementFiles(sc);

    for (const { year, month } of DEMO_MONTHS) {
      for (const f of files.filter((x) => x.year === year && x.month === month)) {
        if (sc.liveUpload && sc.liveUpload.bankKey === f.bankKey && sc.liveUpload.year === year && sc.liveUpload.month === month) continue;
        const b = sc.banks[f.bankKey];
        const bankAccount = entities[b.entity].banks[b.bank];
        const { fileName, data } = await renderStatement(f);
        const s = await importStatement(db, { bankAccountId: bankAccount.id, fileName, data, provider });
        log(`  ${fileName}: ${s.rows} baris, ${s.needsReview} review, AI ${s.ai.calls} panggilan`);
      }
      const closed = year < sc.closedThrough.year || (year === sc.closedThrough.year && month <= sc.closedThrough.month);
      // Review everything except the lines deliberately left open for the demo.
      const pending = await db.bankTransaction.findMany({
        where: { bankAccount: { entity: { clientId: client.id } }, status: "NEEDS_REVIEW" },
        include: { bankAccount: true },
      });
      for (const t of pending) {
        const key = lineKey(t.bankAccount.number, t.date, t.amount, t.description);
        if (openKeys.has(key) && !closed) continue;
        const tr = truth.get(key);
        if (!tr) throw new Error(`Seed: tidak ada truth untuk ${key}`);
        await reviewTransaction(db, { bankTxId: t.id, accountCode: tr.accountCode, taxTag: tr.taxTag });
      }
      if (sc.key === DEPRECIATION.clientKey && closed) await postDepreciation(db, client.id, entities[DEPRECIATION.entity].entity.id, year, month);
      if (closed) {
        const period = await db.period.upsert({
          where: { clientId_year_month: { clientId: client.id, year, month } },
          create: { firmId: firm.id, clientId: client.id, year, month },
          update: {},
        });
        await db.closeSignoff.createMany({ data: CLOSE_SIGNOFFS.map((s) => ({ periodId: period.id, key: s.key })) });
        const controls = await runControls(db, client.id, year, month);
        for (const c of controls.filter((c) => c.status === "REVIEW")) {
          await db.controlAck.create({ data: { periodId: period.id, controlKey: c.key, note: "Dicek, wajar (seed)" } });
        }
        await lockPeriod(db, client.id, year, month, "Ditutup oleh seed demo");
      }
    }

    // AI answers for the live-upload file are pre-cached so the demo never depends on network
    // or credit. Set DEMO_LIVE_AI=1 (with AI_API_KEY) to leave them uncached and see a real call.
    if (sc.liveUpload && !opts.liveAi) {
      const lu = sc.liveUpload;
      const chart = (await db.account.findMany({ where: { clientId: client.id }, orderBy: { code: "asc" } })).filter(a => !a.isBank && !a.isSuspense && !a.isRetained).map(a => ({ code: a.code, name: a.name }));
      for (const l of sc.lines.filter((l) => l.bankKey === lu.bankKey && l.ai && l.date.getUTCFullYear() === lu.year && l.date.getUTCMonth() + 1 === lu.month)) {
        const key = merchantKey(l.description);
        const direction = l.amount >= 0n ? "IN" : "OUT";
        const cacheKey = aiCacheKey(key, direction, client.coaVersion, { firmId: client.firmId, clientId: client.id, model: DEMO_AI_MODEL, clientName: `${client.name} (${client.industry ?? "umum"})`, accounts: chart, sample: l.description });
        await db.aiSuggestion.upsert({
          where: { cacheKey },
          create: { cacheKey, merchantKey: key, direction, accountCode: l.ai!.accountCode, confidence: l.ai!.confidence, taxTag: l.ai!.taxTag, reason: l.ai!.reason, model: DEMO_AI_MODEL },
          update: {},
        });
      }
    }
  }
  return firm;
}

async function postOpenings(db: Db, sc: ClientScenario, clientId: string, entities: Awaited<ReturnType<typeof createClient>>["entities"]) {
  const accounts = await db.account.findMany({ where: { clientId } });
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  for (let i = 0; i < entities.length; i++) {
    const nets = new Map<string, bigint>();
    const add = (accId: string, v: bigint) => nets.set(accId, (nets.get(accId) ?? 0n) + v);
    for (const [, b] of Object.entries(sc.banks).filter(([, b]) => b.entity === i)) add(entities[i].banks[b.bank].accountId, b.opening);
    for (const o of sc.openings[i] ?? []) add(id(o.code), o.amount);
    const plug = [...nets.values()].reduce((s, v) => s + v, 0n);
    add(id("3200"), -plug); // saldo laba balances the opening position
    const lines = [...nets.entries()].filter(([, v]) => v !== 0n).map(([accountId, v]) => (v > 0n ? { accountId, debit: v } : { accountId, credit: -v }));
    await db.$transaction((tx) => postJournal(tx, { entityId: entities[i].entity.id, date: OPENING_DATE, kind: "OPENING", memo: "Saldo awal per 28 Februari 2026", lines }));
  }
}

async function postDepreciation(db: Db, clientId: string, entityId: string, year: number, month: number) {
  const accounts = await db.account.findMany({ where: { clientId, code: { in: ["6180", "1219"] } } });
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  await db.$transaction((tx) =>
    postJournal(tx, {
      entityId,
      date: new Date(Date.UTC(year, month, 0)),
      kind: "ADJUSTMENT",
      memo: "Penyusutan aset tetap bulanan (garis lurus)",
      lines: [
        { accountId: id("6180"), debit: DEPRECIATION.monthly },
        { accountId: id("1219"), credit: DEPRECIATION.monthly },
      ],
    }),
  );
}

/** The held-back statement (for the live upload moment) as a file. */
export async function liveUploadFile() {
  const sc = scenarios().find((s) => s.liveUpload)!;
  const f = statementFiles(sc).find((x) => x.bankKey === sc.liveUpload!.bankKey && x.year === sc.liveUpload!.year && x.month === sc.liveUpload!.month)!;
  return renderStatement(f);
}
