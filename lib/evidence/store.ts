import { createHash, randomUUID } from "node:crypto";
import type { Db, Tx } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { CHUNK_LIMIT, FILE_COUNT_LIMIT, FILE_LIMIT, INTAKE_LIMIT } from "./config";

export const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
export async function intakeForFirm(db: Db | Tx, firmId: string, id: string) {
  const intake = await db.evidenceIntake.findFirst({ where: { id, firmId } });
  if (!intake) throw new Error("Kumpulan dokumen tidak ditemukan.");
  if (intake.clientId && !(await db.client.findFirst({ where: { id: intake.clientId, firmId }, select: { id: true } }))) throw new Error("Klien tidak ditemukan.");
  return intake;
}
export async function lockIntake(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`evidence:${id}`}, 0))::text`;
}
export async function createIntake(db: Db, firmId: string, clientId?: string) {
  if (clientId && !(await db.client.findFirst({ where: { id: clientId, firmId } }))) throw new Error("Klien tidak ditemukan.");
  return db.evidenceIntake.create({ data: { firmId, clientId: clientId || null, name: "Dokumen baru" } });
}

export async function capacity(tx: Tx, firmId: string, intakeId: string, bytes: number, files = 1) {
  const [versions, uploads, count, pendingCount] = await Promise.all([
    tx.evidenceVersion.aggregate({ where: { firmId, document: { intakeId } }, _sum: { size: true } }),
    tx.evidenceUpload.aggregate({ where: { firmId, intakeId }, _sum: { totalBytes: true } }),
    tx.evidenceDocument.count({ where: { firmId, intakeId } }),
    tx.evidenceUpload.count({ where: { firmId, intakeId } }),
  ]);
  if ((versions._sum.size ?? 0) + (uploads._sum.totalBytes ?? 0) + bytes > INTAKE_LIMIT) throw new Error("Batas 100 MiB tercapai. Buat kumpulan dokumen lain untuk melanjutkan.");
  if (count + pendingCount + files > FILE_COUNT_LIMIT) throw new Error("Batas 500 file tercapai. Tambahkan subfolder sebagai kumpulan terpisah.");
}

export async function beginUpload(db: Db, firmId: string, intakeId: string, name: string, totalBytes: number) {
  if (!name.trim() || name.length > 240 || !Number.isSafeInteger(totalBytes) || totalBytes < 1) throw new Error("Pilih file berukuran 1 byte sampai 10 MiB.");
  const markLimit = async (message: string) => db.$transaction(async tx => {
    await lockIntake(tx, intakeId);
    await intakeForFirm(tx, firmId, intakeId);
    await tx.evidenceIntake.update({ where: { id: intakeId }, data: { status: "PARTIAL", issue: `${name.slice(0, 120)}: ${message}` } });
  });
  if (totalBytes > FILE_LIMIT) {
    const message = "File melebihi batas 10 MiB. Pecah file sebelum mengunggah.";
    await markLimit(message);
    throw new Error(message);
  }
  try { return await db.$transaction(async tx => {
    await lockIntake(tx, intakeId);
    await intakeForFirm(tx, firmId, intakeId);
    // Abandoned upload reservations expire without touching completed source snapshots.
    await tx.evidenceUpload.deleteMany({ where: { firmId, intakeId, createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } } });
    await capacity(tx, firmId, intakeId, totalBytes);
    return tx.evidenceUpload.create({ data: { firmId, intakeId, name: name.replace(/[/\\]/g, "_"), totalBytes, data: Buffer.alloc(0) } });
  }); } catch (error) {
    if (error instanceof Error && /^Batas (?:100 MiB|500 file)/.test(error.message)) await markLimit(error.message);
    throw error;
  }
}
export async function appendUpload(db: Db, firmId: string, uploadId: string, offset: number, bytes: Buffer) {
  if (!bytes.length || bytes.length > CHUNK_LIMIT || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Bagian unggahan tidak valid.");
  return db.$transaction(async tx => {
    const initial = await tx.evidenceUpload.findFirst({ where: { id: uploadId, firmId } });
    if (!initial) throw new Error("Unggahan tidak ditemukan. Unggah kembali file.");
    await lockIntake(tx, initial.intakeId);
    const upload = await tx.evidenceUpload.findFirstOrThrow({ where: { id: uploadId, firmId } });
    await intakeForFirm(tx, firmId, upload.intakeId);
    if (offset < upload.receivedBytes && Buffer.from(upload.data).subarray(offset, offset + bytes.length).equals(bytes)) return upload.receivedBytes;
    if (offset !== upload.receivedBytes || offset + bytes.length > upload.totalBytes) throw new Error("Urutan unggahan berubah. Unggah kembali file.");
    const updated = await tx.evidenceUpload.update({ where: { id: uploadId }, data: { data: Buffer.concat([upload.data, bytes]), receivedBytes: offset + bytes.length } });
    return updated.receivedBytes;
  });
}
export async function finishUpload(db: Db, firmId: string, uploadId: string) {
  return db.$transaction(async tx => {
    const initial = await tx.evidenceUpload.findFirst({ where: { id: uploadId, firmId } });
    if (!initial) throw new Error("Unggahan tidak ditemukan.");
    await lockIntake(tx, initial.intakeId);
    const up = await tx.evidenceUpload.findFirstOrThrow({ where: { id: uploadId, firmId } });
    const intake = await intakeForFirm(tx, firmId, up.intakeId);
    if (up.receivedBytes !== up.totalBytes) throw new Error("Unggahan belum lengkap.");
    const digest = hash(Buffer.from(up.data));
    const existing = await tx.evidenceDocument.findUnique({ where: { intakeId_sourceKey: { intakeId: up.intakeId, sourceKey: `upload:${digest}` } } });
    if (existing) { await tx.evidenceUpload.delete({ where: { id: uploadId } }); return existing; }
    const doc = await tx.evidenceDocument.create({ data: { firmId, intakeId: up.intakeId, sourceKey: `upload:${digest}`, name: up.name, path: up.name, mimeType: "", versions: { create: { firmId, hash: digest, name: up.name, data: up.data, size: up.totalBytes } } } });
    await tx.evidenceUpload.delete({ where: { id: uploadId } });
    // A completed upload does not finish a truncated or failed Drive inventory.
    await tx.evidenceIntake.update({ where: { id: up.intakeId }, data: { status: intake.status === "PARTIAL" ? "PARTIAL" : "READY", contextVersion: { increment: 1 } } });
    return doc;
  });
}
/** One processing step at a time per intake; the lease must outlast the step's slowest external call. */
export async function claimStep(db: Db, firmId: string, intakeId: string, leaseMs = 90_000) {
  const token = randomUUID();
  return db.$transaction(async tx => {
    // Serialize claims with exclusion and metadata decisions, not only other workers.
    await lockIntake(tx, intakeId);
    await intakeForFirm(tx, firmId, intakeId);
    const claimed = await tx.evidenceIntake.updateMany({ where: { id: intakeId, firmId, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + leaseMs) } });
    return claimed.count ? token : null;
  });
}
export async function assertLease(tx: Tx, firmId: string, intakeId: string, token: string) {
  const row = await tx.evidenceIntake.findFirst({ where: { id: intakeId, firmId, leaseToken: token, leaseUntil: { gt: new Date() } } });
  if (!row) throw new Error("Langkah sudah diambil sesi lain. Muat ulang untuk melanjutkan.");
}
export async function releaseStep(db: Db, firmId: string, intakeId: string, token: string) {
  await db.evidenceIntake.updateMany({ where: { id: intakeId, firmId, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } });
}
