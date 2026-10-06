import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { resolveUploadLink } from "@/lib/upload-links";
import { AuthShell } from "@/app/login/shell";
import { LinkUploader } from "@/components/app/link-uploader";

// Public (no login): a client sends files to the firm's review inbox through a secret, expiring link (I1d). Nothing of the books shows.
export const metadata: Metadata = { title: "Kirim dokumen", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function SendFilesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveUploadLink(prisma, token);
  if (!link) notFound();
  return (
    <AuthShell
      title={`Kirim dokumen ke ${link.firmName}`}
      description={`Untuk ${link.clientName}. Kirim rekening koran, buku besar atau neraca saldo. File langsung diterima kantor akuntan Anda.`}
      footer={`Tautan ini berlaku sampai ${formatDate(link.expiresAt)}. Anda tidak perlu membuat akun, dan file yang sudah dikirim tidak ditampilkan lagi di sini.`}
    >
      <LinkUploader token={token} />
    </AuthShell>
  );
}
