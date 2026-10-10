import { redirect } from "next/navigation";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { ClientForm } from "@/components/app/client-form";
import { requireWorkspaceSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { companyClient, isCompany } from "@/lib/org";

export const metadata = { title: "Tambah klien" };

export default async function NewClientPage() {
  // A company has one set of books (ADR 0017 §1): once it exists, this page leads back to it.
  const { firm } = await requireWorkspaceSession();
  const books = await companyClient(prisma, firm);
  if (books) redirect(`/clients/${books.id}`);
  const company = isCompany(firm);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={company ? "Siapkan buku perusahaan" : "Tambah klien"} description={company ? "Perusahaan Anda beserta perusahaan anak atau pemilik, masing-masing dengan pembukuan dan mata uangnya sendiri." : "Satu klien bisa punya beberapa perusahaan, masing-masing dengan pembukuan dan mata uangnya sendiri."} />
      <NextStep>{company ? "Isi nama perusahaan dan entitasnya, lalu simpan." : "Isi nama klien dan perusahaannya, lalu simpan."} Setelah itu Anda diarahkan ke Impor untuk mengunggah rekening koran pertama.</NextStep>
      <ClientForm />
    </div>
  );
}
