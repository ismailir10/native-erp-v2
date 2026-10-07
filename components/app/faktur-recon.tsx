"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Money } from "@/components/app/money";
import { StatusPill } from "@/components/app/status";
import { bookFakturAction, deleteFakturAction, importFakturAction } from "@/app/actions";
import { SimpleSelect } from "@/components/app/simple-select";

/** Ekualisasi PPN (I5c) on Pajak Masa: faktur from Coretax against the books, the unmatched lines both ways. Amounts arrive as strings. */
export type FakturItem = { id: string; number: string; date: string; npwp: string | null; name: string; ppn: string; status: string; sourceRef: string };
export type BookItem = { key: string; date: string; label: string; ppn: string; kind: "BANK" | "INVOICE" | "JOURNAL" };
export type DirectionView = {
  direction: "KELUARAN" | "MASUKAN";
  label: string;
  account: string;
  imported: number;
  fakturPpn: string;
  bookPpn: string;
  difference: string;
  status: "NONE" | "MATCH" | "DIFF";
  matched: number;
  unmatchedFaktur: FakturItem[];
  unmatchedBook: BookItem[];
  notCounted: FakturItem[];
  uncredited: FakturItem[];
};

const SOURCE: Record<BookItem["kind"], string> = { BANK: "Mutasi bank", INVOICE: "Faktur di Piutang & Utang", JOURNAL: "Jurnal" };

type Account = { code: string; name: string };

/** Records one faktur that isn't in the books as a receivable (keluaran) or payable (masukan), against the account the accountant picks. */
function BookFaktur({ clientId, faktur, direction, accounts, preferred }: { clientId: string; faktur: FakturItem; direction: "KELUARAN" | "MASUKAN"; accounts: Account[]; preferred: string }) {
  const router = useRouter();
  const [code, setCode] = useState(accounts.find((a) => a.code === preferred)?.code ?? accounts[0]?.code ?? "");
  const sales = direction === "KELUARAN";
  async function book() {
    const r = await bookFakturAction({ clientId, fakturId: faktur.id, counterCode: code });
    if (!r.ok) return void toast.error(r.error);
    toast.success(`Faktur ${r.number} dicatat sebagai ${sales ? "piutang" : "utang"}`);
    router.refresh();
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>{sales ? "Catat piutang" : "Catat utang"}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Catat faktur {faktur.number} sebagai {sales ? "piutang" : "utang"}?</AlertDialogTitle>
          <AlertDialogDescription>
            {faktur.name || "Lawan transaksi tanpa nama"}, {faktur.date}: jurnal {sales ? "piutang usaha ke pendapatan dan PPN keluaran" : "beban atau aset dan PPN masukan ke utang usaha"} dari DPP dan PPN faktur. Pembayarannya nanti dicocokkan di Piutang & Utang.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <SimpleSelect label={sales ? "Akun pendapatan" : "Akun beban atau aset"} value={code} onChange={setCode} options={accounts.map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }))} placeholder="Pilih akun" />
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction disabled={!code} onClick={book}>{sales ? "Catat piutang" : "Catat utang"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function FakturRecon({ clientId, entityId, year, month, label, ledgerHref, directions, accounts }: { clientId: string; entityId: string; year: number; month: number; label: string; ledgerHref: Record<"KELUARAN" | "MASUKAN", string>; directions: DirectionView[]; accounts: Record<"KELUARAN" | "MASUKAN", Account[]> }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new key empties the file picker after an upload, so it never shows a file that is already in.
  const [picker, setPicker] = useState(0);

  async function upload() {
    if (!file) return;
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("entityId", entityId);
    fd.set("file", file);
    setBusy(true);
    const r = await importFakturAction(fd);
    setBusy(false);
    if (!r.ok) return void setError(r.error);
    setError(null);
    setFile(null);
    setPicker((n) => n + 1);
    const other = r.masas.filter((m) => m !== `${year}-${String(month).padStart(2, "0")}`);
    toast.success(`${r.direction === "KELUARAN" ? "Faktur keluaran" : "Faktur masukan"}: ${r.created} baru, ${r.updated} berubah`, {
      description: [other.length ? `Termasuk masa lain: ${other.join(", ")}` : "", ...r.notes].filter(Boolean).join(" · ") || undefined,
    });
    router.refresh();
  }

  async function remove(direction: "KELUARAN" | "MASUKAN") {
    const r = await deleteFakturAction({ clientId, entityId, direction, year, month });
    if (!r.ok) return void toast.error(r.error);
    toast.success(`${r.count} faktur dihapus`);
    router.refresh();
  }

  return (
    <div className="space-y-6" data-testid="faktur-recon">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Input key={picker} type="file" accept=".xlsx,.xls,.csv" aria-label="File faktur Coretax" className="max-w-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button variant="outline" onClick={upload} disabled={busy || !file} data-testid="faktur-upload">
            <Upload /> {busy ? "Membaca…" : "Unggah faktur"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Dari Coretax: Faktur Keluaran atau Pajak Masukan, pilih masa {label}, lalu unduh daftarnya ke Excel. Jenisnya dibaca dari kolom pembeli atau penjual. Mengunggah ulang memperbarui
          status faktur yang sama.
        </p>
        {error && <p role="alert" className="text-sm text-fail" data-testid="faktur-error">{error}</p>}
      </div>

      {directions.map((d) => (
        <section key={d.direction} className="space-y-3" data-testid={`faktur-${d.direction}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">
              {d.label} <span className="text-xs text-muted-foreground">{d.account}</span>
            </h3>
            {d.status !== "NONE" && <StatusPill status={d.status === "MATCH" ? "PASS" : "REVIEW"} />}
          </div>
          {d.status === "NONE" ? (
            <p className="text-sm text-muted-foreground">Belum ada {d.label.toLowerCase()} masa {label} yang diunggah.</p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="eyebrow text-muted-foreground">PPN faktur</dt>
                  <dd className="text-right sm:text-left"><Money value={BigInt(d.fakturPpn)} /></dd>
                </div>
                <div>
                  <dt className="eyebrow text-muted-foreground">PPN di buku</dt>
                  <dd className="text-right sm:text-left"><Link href={ledgerHref[d.direction]} className="hover:text-primary"><Money value={BigInt(d.bookPpn)} /></Link></dd>
                </div>
                <div>
                  <dt className="eyebrow text-muted-foreground">Selisih</dt>
                  <dd className="text-right sm:text-left"><Money value={BigInt(d.difference)} /></dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                {d.matched} faktur cocok dengan buku per nominal PPN.
                {d.notCounted.length ? ` ${d.notCounted.length} faktur batal, diganti atau ditolak tidak dihitung.` : ""}
                {d.uncredited.length ? ` ${d.uncredited.length} faktur masukan belum dikreditkan (${d.uncredited.map((f) => f.number).join(", ")}).` : ""}
              </p>
              {d.unmatchedFaktur.length > 0 && (
                <div data-testid={`faktur-unbooked-${d.direction}`}>
                  <p className="eyebrow mb-1 text-muted-foreground">Faktur belum ada di buku</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="eyebrow">Nomor faktur</TableHead>
                        <TableHead className="eyebrow hidden sm:table-cell">Tanggal</TableHead>
                        <TableHead className="eyebrow hidden md:table-cell">Lawan transaksi</TableHead>
                        <TableHead className="eyebrow text-right">PPN</TableHead>
                        <TableHead className="hidden w-0 sm:table-cell"><span className="sr-only">Catat</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.unmatchedFaktur.map((f) => (
                        <TableRow key={f.number}>
                          <TableCell className="num whitespace-normal">
                            {f.number}
                            <div className="text-xs text-muted-foreground md:hidden">{f.name}</div>
                            {/* On a phone the action sits under the faktur, so the PPN column stays on screen. */}
                            <div className="mt-1 sm:hidden">
                              <BookFaktur clientId={clientId} faktur={f} direction={d.direction} accounts={accounts[d.direction]} preferred={d.direction === "KELUARAN" ? "4100" : "5100"} />
                            </div>
                          </TableCell>
                          <TableCell className="num hidden sm:table-cell">{f.date}</TableCell>
                          <TableCell className="hidden md:table-cell">{f.name}{f.npwp && <span className="num ml-1 text-xs text-muted-foreground">{f.npwp}</span>}</TableCell>
                          <TableCell className="text-right"><Money value={BigInt(f.ppn)} /></TableCell>
                          <TableCell className="hidden text-right sm:table-cell">
                            <BookFaktur clientId={clientId} faktur={f} direction={d.direction} accounts={accounts[d.direction]} preferred={d.direction === "KELUARAN" ? "4100" : "5100"} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {d.unmatchedBook.length > 0 && (
                <div data-testid={`faktur-unfaktured-${d.direction}`}>
                  <p className="eyebrow mb-1 text-muted-foreground">PPN di buku tanpa faktur</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="eyebrow hidden sm:table-cell">Tanggal</TableHead>
                        <TableHead className="eyebrow">Sumber</TableHead>
                        <TableHead className="eyebrow text-right">PPN</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.unmatchedBook.map((b) => (
                        <TableRow key={b.key}>
                          <TableCell className="num hidden sm:table-cell">{b.date}</TableCell>
                          <TableCell className="whitespace-normal">
                            <Link href={ledgerHref[d.direction]} className="hover:text-primary">{b.label}</Link>
                            <div className="text-xs text-muted-foreground">{SOURCE[b.kind]}</div>
                          </TableCell>
                          <TableCell className="text-right"><Money value={BigInt(b.ppn)} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
                  <Trash2 /> Hapus {d.label.toLowerCase()} masa ini
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Hapus {d.imported} {d.label.toLowerCase()} masa {label}?</AlertDialogTitle>
                    <AlertDialogDescription>Buku besar tidak berubah. Unggah lagi file yang benar dari Coretax setelah ini.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => remove(d.direction)}>Hapus faktur</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </section>
      ))}
    </div>
  );
}
