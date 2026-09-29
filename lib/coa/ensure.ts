import type { Tx } from "@/lib/db";
import { LedgerError } from "@/lib/ledger/post";
import { COA_TEMPLATE } from "@/lib/coa/template";

/**
 * The client's accounts for the codes, creating template accounts added after the client was set up (tax pack, CKPN) on first use when the
 * code is free. A code the client uses for something else is refused, naming it, rather than posting into it.
 */
export async function templateAccounts(tx: Tx, clientId: string, codes: string[]) {
  const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
  const out = new Map<string, string>();
  for (const code of [...new Set(codes)]) {
    const seed = COA_TEMPLATE.find((a) => a.code === code);
    const found = await tx.account.findFirst({ where: { clientId, code } });
    if (found) {
      if (seed && (found.fsLine !== seed.fsLine || found.type !== seed.type)) throw new LedgerError(`Akun ${code} dipakai untuk "${found.name}", bukan ${seed.name}. Ubah kode akun itu dulu.`);
      out.set(code, found.id);
    } else if (seed) {
      out.set(code, (await tx.account.create({ data: { ...seed, firmId: client.firmId, clientId } })).id);
    } else throw new LedgerError(`Akun ${code} tidak ada di bagan akun klien.`);
  }
  return out;
}
