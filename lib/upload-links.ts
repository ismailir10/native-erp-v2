import { createHash, randomBytes } from "node:crypto";
import { accessState } from "@/lib/access/grant";
import type { Db } from "@/lib/db";
import { recordEvent } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import { appendUpload, beginUpload, finishUpload } from "@/lib/evidence/store";
import { CHUNK_LIMIT, evidenceEnabled, FILE_LIMIT } from "@/lib/evidence/config";

/**
 * Tautan unggah klien (I1d, ADR 0014): a secret, expiring, revocable link through which a client drops files into one review inbox
 * (an `EvidenceIntake`) without an account. Upload only: the link reads nothing back, and nothing is imported or posted by the upload.
 * Only the token's sha256 is stored; the token is shown once, when the link is made.
 */
export const LINK_DAYS = [7, 14, 30] as const;
export type LinkDays = (typeof LINK_DAYS)[number];
export const LINK_FILE_LIMIT = 50;
export const ACCEPTED_FILES = /\.(pdf|csv|xls|xlsx)$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export class UploadLinkError extends Error {}

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const uploadPath = (token: string) => `/kirim/${token}`;

export async function createUploadLink(db: Db, input: { firmId: string; clientId: string; days: number; actorId?: string | null; now?: Date }) {
  const client = await db.client.findFirst({ where: { id: input.clientId, firmId: input.firmId }, select: { id: true, name: true } });
  if (!client) throw new UploadLinkError("Klien tidak ditemukan.");
  if (!LINK_DAYS.includes(input.days as LinkDays)) throw new UploadLinkError("Pilih masa berlaku 7, 14 atau 30 hari.");
  const now = input.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(+now + input.days * 86_400_000);
  const link = await db.$transaction(async (tx) => {
    const intake = await tx.evidenceIntake.create({ data: { firmId: input.firmId, clientId: client.id, name: `Kiriman klien · ${formatDate(now)}` } });
    const created = await tx.uploadLink.create({ data: { firmId: input.firmId, clientId: client.id, intakeId: intake.id, tokenHash: tokenHash(token), expiresAt, createdById: input.actorId ?? null } });
    await recordEvent(tx, { clientId: client.id, kind: "UPLOAD_LINK", subject: `upload-link:${created.id}`, summary: `Tautan unggah dibuat · berlaku s.d. ${formatDate(expiresAt)}`, after: { expiresAt: expiresAt.toISOString() }, actorId: input.actorId ?? null });
    return created;
  });
  return { link, token };
}

/**
 * The link behind a token, when it is still usable; null for an unknown, expired or revoked one (the caller shows one page for all).
 * A link of an organisation that is not ACTIVE right now (trial ended, revoked, suspended — ADR 0017) takes no files either.
 */
export async function resolveUploadLink(db: Db, token: string, now = new Date()) {
  // EVIDENCE_ENABLED=false (the inbox's kill switch) closes every link too.
  if (!evidenceEnabled() || !TOKEN.test(token)) return null;
  const link = await db.uploadLink.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!link || link.revokedAt || +link.expiresAt <= +now) return null;
  const [client, firm] = await Promise.all([
    db.client.findFirst({ where: { id: link.clientId, firmId: link.firmId }, select: { name: true } }),
    db.firm.findUnique({ where: { id: link.firmId }, select: { name: true, suspendedAt: true, grants: true } }),
  ]);
  if (!client || !firm || accessState(firm.grants, firm, now).state !== "ACTIVE") return null;
  return { ...link, clientName: client.name, firmName: firm.name };
}

export async function revokeUploadLink(db: Db, input: { firmId: string; clientId: string; linkId: string; actorId?: string | null }) {
  const link = await db.uploadLink.findFirst({ where: { id: input.linkId, firmId: input.firmId, clientId: input.clientId } });
  if (!link) throw new UploadLinkError("Tautan tidak ditemukan.");
  if (link.revokedAt) return link;
  return db.$transaction(async (tx) => {
    const updated = await tx.uploadLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
    await recordEvent(tx, { clientId: input.clientId, kind: "UPLOAD_LINK", subject: `upload-link:${link.id}`, summary: "Tautan unggah dicabut", actorId: input.actorId ?? null });
    return updated;
  });
}

export type UploadLinkView = { id: string; intakeId: string; createdAt: Date; expiresAt: Date; lastUsedAt: Date | null; files: number; active: boolean };

/** A client's links, newest first: the usable ones, and the rest of the last 30 days (so a just-expired link still shows its files). */
export async function uploadLinks(db: Db, clientId: string, now = new Date()): Promise<UploadLinkView[]> {
  const links = await db.uploadLink.findMany({
    where: { clientId, OR: [{ revokedAt: null, expiresAt: { gt: now } }, { createdAt: { gt: new Date(+now - 30 * 86_400_000) } }] },
    orderBy: { createdAt: "desc" },
  });
  const counts = await db.evidenceDocument.groupBy({ by: ["intakeId"], where: { intakeId: { in: links.map((l) => l.intakeId) } }, _count: { _all: true } });
  const files = new Map(counts.map((c) => [c.intakeId, c._count._all]));
  return links.map((l) => ({ id: l.id, intakeId: l.intakeId, createdAt: l.createdAt, expiresAt: l.expiresAt, lastUsedAt: l.lastUsedAt, files: files.get(l.intakeId) ?? 0, active: !l.revokedAt && +l.expiresAt > +now }));
}

/** What a file's first bytes say it is: the client's extension must agree (PDF, ZIP-based XLSX, OLE XLS, or text CSV). */
export function contentMatches(name: string, head: Buffer): boolean {
  const ext = name.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  const starts = (sig: number[]) => sig.every((b, i) => head[i] === b);
  if (ext === "pdf") return starts([0x25, 0x50, 0x44, 0x46]);
  if (ext === "xlsx") return starts([0x50, 0x4b, 0x03, 0x04]);
  if (ext === "xls") return starts([0xd0, 0xcf, 0x11, 0xe0]) || starts([0x50, 0x4b, 0x03, 0x04]);
  if (ext === "csv") return head.length > 0 && !head.subarray(0, 4096).includes(0);
  return false;
}

const invalid = () => new UploadLinkError("Tautan ini tidak berlaku lagi. Minta tautan baru ke kantor akuntan Anda.");

async function ownUpload(db: Db, link: { firmId: string; intakeId: string }, uploadId: string) {
  const upload = await db.evidenceUpload.findFirst({ where: { id: uploadId, firmId: link.firmId, intakeId: link.intakeId }, select: { id: true, name: true } });
  if (!upload) throw new UploadLinkError("Unggahan tidak ditemukan. Unggah kembali file.");
  return upload;
}

export async function beginLinkUpload(db: Db, token: string, name: string, size: number) {
  const link = await resolveUploadLink(db, token);
  if (!link) throw invalid();
  if (!ACCEPTED_FILES.test(name)) throw new UploadLinkError("Kirim file PDF, CSV, XLS atau XLSX.");
  if (!Number.isSafeInteger(size) || size < 1 || size > FILE_LIMIT) throw new UploadLinkError("Ukuran file maksimal 10 MiB. Pecah file yang lebih besar.");
  const [docs, pending] = await Promise.all([db.evidenceDocument.count({ where: { intakeId: link.intakeId } }), db.evidenceUpload.count({ where: { intakeId: link.intakeId } })]);
  if (docs + pending >= LINK_FILE_LIMIT) throw new UploadLinkError(`Tautan ini sudah menerima ${LINK_FILE_LIMIT} file. Minta tautan baru ke kantor akuntan Anda.`);
  try {
    return (await beginUpload(db, link.firmId, link.intakeId, name, size)).id;
  } catch (e) {
    throw new UploadLinkError(e instanceof Error ? e.message : "Unggahan gagal.");
  }
}

export async function appendLinkUpload(db: Db, token: string, uploadId: string, offset: number, bytes: Buffer) {
  const link = await resolveUploadLink(db, token);
  if (!link) throw invalid();
  await ownUpload(db, link, uploadId);
  if (bytes.length > CHUNK_LIMIT) throw new UploadLinkError("Bagian unggahan tidak valid.");
  try {
    return await appendUpload(db, link.firmId, uploadId, offset, bytes);
  } catch (e) {
    throw new UploadLinkError(e instanceof Error ? e.message : "Unggahan gagal.");
  }
}

export async function finishLinkUpload(db: Db, token: string, uploadId: string) {
  const link = await resolveUploadLink(db, token);
  if (!link) throw invalid();
  const upload = await ownUpload(db, link, uploadId);
  const [{ head }] = await db.$queryRaw<{ head: Buffer | null }[]>`SELECT substring("data" from 1 for 4096) AS head FROM "EvidenceUpload" WHERE id = ${upload.id}`;
  if (!contentMatches(upload.name, Buffer.from(head ?? []))) {
    await db.evidenceUpload.delete({ where: { id: upload.id } });
    throw new UploadLinkError(`Isi ${upload.name} tidak sesuai jenis filenya. Kirim file aslinya dari bank atau aplikasi akuntansi.`);
  }
  try {
    const doc = await finishUpload(db, link.firmId, uploadId);
    await db.uploadLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } });
    return { name: doc.name };
  } catch (e) {
    throw new UploadLinkError(e instanceof Error ? e.message : "Unggahan gagal.");
  }
}
