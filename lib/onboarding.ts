import { z } from "zod";
import type { Db } from "@/lib/db";
import { createClient, type ClientSpec } from "@/lib/setup";

/**
 * "Tambah klien": a real client with its entities (PT/CV/owner) and bank accounts. Reuses createClient(),
 * so the client gets the template COA and one GL bank account (1101–1109) per bank account.
 */
export class OnboardingError extends Error {}

const text = (max: number) => z.string().trim().min(1).max(max);
const schema = z.object({
  name: text(120),
  industry: z.string().trim().max(120),
  entities: z
    .array(
      z.object({
        name: text(160),
        shortName: z.string().trim().max(40),
        kind: z.enum(["PT", "CV", "PERORANGAN"]),
        npwp: z.string().trim().max(30),
        banks: z.array(z.object({ bank: z.enum(["BCA", "MANDIRI", "BRI", "GENERIC"]), number: z.string().trim(), label: text(60) })).min(1),
      }),
    )
    .min(1),
});
export type NewClientInput = z.input<typeof schema>;

export function validateNewClient(input: NewClientInput): ClientSpec {
  const r = schema.safeParse(input);
  if (!r.success) {
    const path = r.error.issues[0]?.path ?? [];
    if (path[0] === "name") throw new OnboardingError("Isi nama klien.");
    if (path.includes("banks") && path.length <= 3) throw new OnboardingError("Setiap entitas butuh minimal satu rekening bank.");
    if (path.includes("label")) throw new OnboardingError("Isi nama rekening, misalnya “BCA Giro”.");
    if (path.includes("name")) throw new OnboardingError("Isi nama setiap entitas.");
    throw new OnboardingError("Data klien belum lengkap. Periksa isian yang kosong.");
  }
  const v = r.data;
  const numbers = v.entities.flatMap((e) => e.banks.map((b) => b.number.replace(/[\s.-]/g, "")));
  const bad = numbers.find((n) => !/^\d{6,20}$/.test(n));
  if (bad !== undefined) throw new OnboardingError(`Nomor rekening “${bad || "(kosong)"}” tidak valid. Isi 6–20 angka.`);
  if (new Set(numbers).size !== numbers.length) throw new OnboardingError("Ada nomor rekening yang dimasukkan dua kali.");
  if (numbers.length > 9) throw new OnboardingError("Maksimal 9 rekening bank per klien.");
  // Companies first, then owners — the order every list in the app uses.
  const rank = { PT: 0, CV: 1, PERORANGAN: 2 } as const;
  return {
    name: v.name,
    industry: v.industry,
    entities: [...v.entities]
      .sort((a, b) => rank[a.kind] - rank[b.kind])
      .map((e) => ({
        name: e.name,
        shortName: e.shortName || e.name,
        kind: e.kind,
        npwp: e.npwp || undefined,
        banks: e.banks.map((b) => ({ bank: b.bank, number: b.number.replace(/[\s.-]/g, ""), label: b.label })),
      })),
  };
}

export async function addClient(db: Db, firmId: string, input: NewClientInput) {
  const spec = validateNewClient(input);
  const { client } = await db.$transaction((tx) => createClient(tx, firmId, spec));
  return client;
}
