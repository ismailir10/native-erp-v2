import { NextStep, PageHeader } from "@/components/app/page-header";
import { ClientForm } from "@/components/app/client-form";

export default function NewClientPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Tambah klien" description="Satu klien bisa punya beberapa perusahaan, masing-masing dengan pembukuan dan mata uangnya sendiri." />
      <NextStep>Isi nama klien dan perusahaannya, lalu simpan. Setelah itu Anda diarahkan ke Saldo Awal.</NextStep>
      <ClientForm />
    </div>
  );
}
