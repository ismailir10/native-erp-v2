import { PageHeader } from "@/components/app/page-header";
import { ClientForm } from "@/components/app/client-form";

export default function NewClientPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Tambah klien" description="Setelah disimpan, isi saldo awal lalu impor rekening koran pertama." />
      <ClientForm />
    </div>
  );
}
