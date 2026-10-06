import type { Db } from "@/lib/db";
import { COA_TEMPLATE } from "@/lib/coa/template";
import { formatDate, toIsoDate } from "@/lib/format";
import { valuation } from "@/lib/benefits/valuation";

/** Serialisable views for the Imbalan Kerja (PSAK 24) page (bigint as string across the server → client boundary, rule 6). */

const pct = (bp: number) => (bp / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 });

export type BenefitEntityView = {
  entity: { id: string; name: string; shortName: string; currency: string };
  setting: { mortalityTableId: string; discount: string; salary: string; retirementAge: string; disability: string; resign: string; resignFlatUntil: string; resignZeroAge: string; saved: boolean };
  employees: { id: string; name: string; employeeNo: string; ptkpStatus: string; sex: "MALE" | "FEMALE"; birthDate: string; hireDate: string; leftOn: string; wage: string; birth: string; hire: string; left: string | null; age: string | null; service: string | null; dbo: string | null; newHire: boolean }[];
  valuation: {
    blocker: string | null;
    tableName: string | null;
    dbo: string;
    serviceCost: string;
    interestCost: string;
    sensitivity: { discountUp: string; discountDown: string; salaryUp: string; salaryDown: string } | null;
    opening: { at: string; dbo: string; serviceCost: string; interestCost: string };
    expenseTarget: string;
    ledger: { liability: string; expenseYtd: string };
    firstYear: boolean;
    lines: { code: string; name: string; amount: string }[];
    later: string | null;
  };
};

export async function benefitViews(db: Db, clientId: string, year: number, month: number, entities: { id: string; name: string; shortName: string; functionalCurrency: string; kind: string }[]): Promise<BenefitEntityView[]> {
  const names = new Map((await db.account.findMany({ where: { clientId }, select: { code: true, name: true } })).map((a) => [a.code, a.name]));
  const out: BenefitEntityView[] = [];
  for (const e of entities.filter((x) => x.kind !== "PERORANGAN")) {
    const [setting, employees, v] = await Promise.all([
      db.benefitSetting.findUnique({ where: { entityId: e.id } }),
      db.employee.findMany({ where: { clientId, entityId: e.id }, orderBy: [{ leftOn: { sort: "desc", nulls: "first" } }, { hireDate: "asc" }, { name: "asc" }] }),
      valuation(db, clientId, e.id, year, month),
    ]);
    const valued = new Map(v.employees.map((x) => [x.id, x]));
    const s = (b: bigint) => b.toString();
    out.push({
      entity: { id: e.id, name: e.name, shortName: e.shortName, currency: e.functionalCurrency },
      setting: setting
        ? { mortalityTableId: setting.mortalityTableId ?? "", discount: pct(setting.discountBp), salary: pct(setting.salaryBp), retirementAge: String(setting.retirementAge), disability: pct(setting.disabilityBp), resign: pct(setting.resignBp), resignFlatUntil: String(setting.resignFlatUntil), resignZeroAge: String(setting.resignZeroAge), saved: true }
        : { mortalityTableId: "", discount: "", salary: "", retirementAge: "56", disability: "10", resign: "5", resignFlatUntil: "30", resignZeroAge: "55", saved: false },
      employees: employees.map((x) => {
        const val = valued.get(x.id);
        return {
          id: x.id,
          name: x.name,
          employeeNo: x.employeeNo ?? "",
          ptkpStatus: x.ptkpStatus ?? "",
          sex: x.sex,
          birthDate: toIsoDate(x.birthDate),
          hireDate: toIsoDate(x.hireDate),
          leftOn: x.leftOn ? toIsoDate(x.leftOn) : "",
          wage: s(x.wage),
          birth: formatDate(x.birthDate),
          hire: formatDate(x.hireDate),
          left: x.leftOn ? formatDate(x.leftOn) : null,
          age: val ? val.age.toLocaleString("id-ID", { maximumFractionDigits: 1 }) : null,
          service: val ? val.service.toLocaleString("id-ID", { maximumFractionDigits: 1 }) : null,
          dbo: val ? s(val.dbo) : null,
          newHire: val?.newHire ?? false,
        };
      }),
      valuation: {
        blocker: v.blocker,
        tableName: v.tableName,
        dbo: s(v.dbo),
        serviceCost: s(v.serviceCost),
        interestCost: s(v.interestCost),
        sensitivity: v.sensitivity ? { discountUp: s(v.sensitivity.discountUp), discountDown: s(v.sensitivity.discountDown), salaryUp: s(v.sensitivity.salaryUp), salaryDown: s(v.sensitivity.salaryDown) } : null,
        opening: { at: formatDate(v.opening.at), dbo: s(v.opening.dbo), serviceCost: s(v.opening.serviceCost), interestCost: s(v.opening.interestCost) },
        expenseTarget: s(v.expenseTarget),
        ledger: { liability: s(v.ledger.liability), expenseYtd: s(v.ledger.expenseYtd) },
        firstYear: v.firstYear,
        lines: v.lines.map((l) => ({ code: l.code, name: names.get(l.code) ?? COA_TEMPLATE.find((a) => a.code === l.code)?.name ?? l.code, amount: s(l.amount) })),
        later: v.later ? formatDate(v.later) : null,
      },
    });
  }
  return out;
}
