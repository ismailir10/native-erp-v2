import { prisma } from "@/lib/db";
import { appendLinkUpload, beginLinkUpload, finishLinkUpload, UploadLinkError } from "@/lib/upload-links";

/**
 * POST /kirim/<token>/upload?step=begin|append|finish — the client's chunked upload (I1d). No session: every call proves the token,
 * and the upload must belong to the link's inbox. Parts are 1 MiB (the platform's request limit).
 */
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = new URL(req.url);
  try {
    switch (url.searchParams.get("step")) {
      case "begin": {
        const body = (await req.json().catch(() => null)) as { name?: unknown; size?: unknown } | null;
        if (typeof body?.name !== "string" || typeof body.size !== "number") return json({ error: "Permintaan tidak valid." }, 400);
        return json({ id: await beginLinkUpload(prisma, token, body.name, body.size) });
      }
      case "append": {
        const offset = Number(url.searchParams.get("offset"));
        const bytes = Buffer.from(await req.arrayBuffer());
        return json({ received: await appendLinkUpload(prisma, token, url.searchParams.get("id") ?? "", offset, bytes) });
      }
      case "finish":
        return json(await finishLinkUpload(prisma, token, url.searchParams.get("id") ?? ""));
      default:
        return json({ error: "Permintaan tidak valid." }, 400);
    }
  } catch (e) {
    if (e instanceof UploadLinkError) return json({ error: e.message }, /tidak berlaku/.test(e.message) ? 404 : 400);
    console.error("kirim upload", e);
    return json({ error: "Unggahan gagal. Coba lagi." }, 500);
  }
}
export const runtime = "nodejs";
