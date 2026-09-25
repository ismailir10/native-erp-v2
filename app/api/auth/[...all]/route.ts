import { authConfigured, getAuth } from "@/lib/auth";
export const runtime = "nodejs";
async function handle(request: Request) {
  if (!authConfigured()) return Response.json({ message: "Akses belum siap. Hubungi pengelola Buku." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return getAuth().handler(request);
}
export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
