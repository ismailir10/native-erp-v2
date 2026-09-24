import type { Tx } from "@/lib/db";
import type { BankCode, EntityKind } from "@/lib/generated/prisma/enums";
import { bankAccountCode, COA_TEMPLATE, overdraftAccountCode } from "@/lib/coa/template";
import { FIRM_RULES, type RuleLike } from "@/lib/classify/rules";

export type ClientSpec = {
  name: string;
  industry: string;
  entities: { name: string; shortName: string; kind: EntityKind; npwp?: string; functionalCurrency?: string; banks: { bank: BankCode; number: string; label: string; isOverdraft?: boolean }[] }[];
  rules?: Omit<RuleLike, "clientId">[];
};

export async function createFirm(tx: Tx, name: string) {
  const firm = await tx.firm.create({ data: { name } });
  await tx.rule.createMany({ data: FIRM_RULES.map((r) => ({ ...r, firmId: firm.id, source: "SEED" })) });
  return firm;
}

/** Client + COA template + one GL account per bank account + client rules. */
export async function createClient(tx: Tx, firmId: string, spec: ClientSpec) {
  const client = await tx.client.create({ data: { firmId, name: spec.name, industry: spec.industry } });
  await tx.account.createMany({ data: COA_TEMPLATE.map((a) => ({ ...a, firmId, clientId: client.id })) });
  let bankIndex = 0;
  let overdraftIndex = 0;
  const entities = [];
  for (const e of spec.entities) {
    const entity = await tx.entity.create({ data: { firmId, clientId: client.id, name: e.name, shortName: e.shortName, kind: e.kind, npwp: e.npwp, functionalCurrency: e.functionalCurrency ?? "IDR" } });
    const banks = [];
    for (const b of e.banks) {
      // PRK (overdraft) accounts are liabilities in 2201–2209; their statement balance is negative.
      const gl = await tx.account.create({
        data: b.isOverdraft
          ? { firmId, clientId: client.id, code: overdraftAccountCode(overdraftIndex++), name: `${b.label} (${e.shortName})`, type: "LIABILITAS", normalBalance: "CREDIT", fsLine: "UTANG_BANK", isBank: true }
          : { firmId, clientId: client.id, code: bankAccountCode(bankIndex++), name: `${b.label} (${e.shortName})`, type: "ASET", normalBalance: "DEBIT", fsLine: "KAS_SETARA_KAS", isBank: true },
      });
      banks.push(await tx.bankAccount.create({ data: { firmId, entityId: entity.id, accountId: gl.id, bank: b.bank, number: b.number, label: b.label, isOverdraft: Boolean(b.isOverdraft) } }));
    }
    entities.push({ entity, banks });
  }
  if (spec.rules?.length) {
    await tx.rule.createMany({ data: spec.rules.map((r) => ({ ...r, firmId, clientId: client.id, source: "SEED" })) });
  }
  return { client, entities };
}
