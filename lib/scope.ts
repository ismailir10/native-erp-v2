import { CURRENT } from "@/lib/demo/scenario";
import { periodBounds } from "@/lib/format";

/** URL state shared by client pages: ?period=2026-08&entity=<id>|combined */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function parsePeriod(v: string | string[] | undefined) {
  const m = typeof v === "string" ? v.match(/^(\d{4})-(\d{2})$/) : null;
  const year = m ? Number(m[1]) : CURRENT.year;
  const month = m ? Number(m[2]) : CURRENT.month;
  return { year, month, ...periodBounds(year, month), key: `${year}-${String(month).padStart(2, "0")}` };
}

export function resolveEntityScope(entityParam: string | string[] | undefined, entities: { id: string }[], defaultCombined = true) {
  const v = typeof entityParam === "string" ? entityParam : undefined;
  const found = entities.find((e) => e.id === v);
  if (found) return { mode: "entity" as const, entityIds: [found.id], value: found.id };
  if (entities.length === 1) return { mode: "entity" as const, entityIds: [entities[0].id], value: entities[0].id };
  if (v === "combined" || defaultCombined) return { mode: "combined" as const, entityIds: entities.map((e) => e.id), value: "combined" };
  return { mode: "entity" as const, entityIds: [entities[0].id], value: entities[0].id };
}

export function withParams(path: string, params: Record<string, string | undefined>) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return q ? `${path}?${q}` : path;
}
