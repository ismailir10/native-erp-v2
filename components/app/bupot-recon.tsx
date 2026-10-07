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
import { deleteBupotAction, importBupotAction } from "@/app/actions";

/** Bukti potong Unifikasi (I5d) on Pajak Masa: Coretax slips against the withholding on bank lines. Amounts arrive as strings. */
export type SlipItem = { number: string; date: string; name: string; npwp: string | null; kind: string; pph: string; status: string };
export type WhtItem = { id: string; date: string; description: string; kind: string; pph: string; href: string };
export type BupotDirectionView = {
  direction: "DIBUAT" | "DITERIMA";
  label: string;
  imported: number;
  slipPph: string;
  bookPph: string;
  difference: string;
  status: "NONE" | "MATCH" | "DIFF";
  matched: number;
  kindDiffers: { slip: SlipItem; book: WhtItem }[];
  unmatchedSlips: SlipItem[];
  unmatchedBook: WhtItem[];
  notCounted: number;
};

export function BupotRecon({ clientId, entityId, year, month, label, directions }: { clientId: string; entityId: string; year: number; month: number; label: string; directions: BupotDirectionView[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("entityId", entityId);
    fd.set("file", file);
    setBusy(true);
    const r = await importBupotAction(fd);
    setBusy(false);
    if (!r.ok) return void setError(r.error);
    setError(null);
    setFile(null);
    const other = r.masas.filter((m) => m !== `${year}-${String(month).padStart(2, "0")}`);
    toast.success(`${r.direction === "DIBUAT" ? "Bukti potong dibuat" : "Bukti potong diterima"}: ${r.created} baru, ${r.updated} berubah`, {
      description: [other.length ? `Termasuk masa lain: ${other.join(", ")}` : "", ...r.notes].filter(Boolean).join(" · ") || undefined,
    });
    router.refresh();
  }

  async function remove(direction: "DIBUAT" | "DITERIMA") {
    const r = await deleteBupotAction({ clientId, entityId, direction, year, month });
    if (!r.ok) return void toast.error(r.error);
    toast.success(`${r.count} bukti potong dihapus`);
    router.refresh();
  }

  return (
    <div className="space-y-6 border-t pt-6" data-testid="bupot-recon">
      <div className="space-y-2">
        <p className="font-medium">Cocokkan dengan Coretax</p>
        <div className="flex flex-wrap items-center gap-3">
          <Input type="file" accept=".xlsx,.xls,.csv" aria-label="File bukti potong Coretax" className="max-w-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button variant="outline" onClick={upload} disabled={busy || !file} data-testid="bupot-upload">
            <Upload /> {busy ? "Membaca…" : "Unggah bukti potong"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Dari Coretax: eBupot Unifikasi, daftar bukti potong masa {label} (yang dibuat, atau yang diterima dari pelanggan), unduh ke Excel. Jenisnya dibaca dari kolom penerima penghasilan atau
          pemotong.
        </p>
        {error && <p role="alert" className="text-sm text-fail" data-testid="bupot-error">{error}</p>}
      </div>

      {directions.map((d) => (
        <section key={d.direction} className="space-y-3" data-testid={`bupot-${d.direction}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{d.label}</h3>
            {d.status !== "NONE" && <StatusPill status={d.status === "MATCH" ? "PASS" : "REVIEW"} />}
          </div>
          {d.status === "NONE" ? (
            <p className="text-sm text-muted-foreground">Belum ada {d.label.toLowerCase()} masa {label} yang diunggah.</p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="eyebrow text-muted-foreground">PPh bukti potong</dt>
                  <dd><Money value={BigInt(d.slipPph)} /></dd>
                </div>
                <div>
                  <dt className="eyebrow text-muted-foreground">PPh di buku</dt>
                  <dd><Money value={BigInt(d.bookPph)} /></dd>
                </div>
                <div>
                  <dt className="eyebrow text-muted-foreground">Selisih</dt>
                  <dd><Money value={BigInt(d.difference)} /></dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                {d.matched} bukti potong cocok dengan pemotongan di buku per nominal PPh.{d.notCounted ? ` ${d.notCounted} dibatalkan atau diganti tidak dihitung.` : ""}
              </p>
              {d.kindDiffers.length > 0 && (
                <div data-testid={`bupot-kind-${d.direction}`}>
                  <p className="eyebrow mb-1 text-muted-foreground">Jenis PPh berbeda</p>
                  <ul className="space-y-1 text-sm">
                    {d.kindDiffers.map((p) => (
                      <li key={p.slip.number}>
                        <span className="num">{p.slip.number}</span> · {p.slip.name}: bukti potong {p.slip.kind}, di buku {p.book.kind} (<Money value={BigInt(p.slip.pph)} />)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.unmatchedSlips.length > 0 && (
                <div data-testid={`bupot-unbooked-${d.direction}`}>
                  <p className="eyebrow mb-1 text-muted-foreground">Bukti potong tanpa pemotongan di buku</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="eyebrow">Nomor</TableHead>
                        <TableHead className="eyebrow hidden sm:table-cell">Tanggal</TableHead>
                        <TableHead className="eyebrow hidden md:table-cell">Lawan transaksi</TableHead>
                        <TableHead className="eyebrow hidden sm:table-cell">Jenis</TableHead>
                        <TableHead className="eyebrow text-right">PPh</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.unmatchedSlips.map((s) => (
                        <TableRow key={s.number}>
                          <TableCell className="num">{s.number}<div className="text-xs text-muted-foreground md:hidden">{s.name}</div></TableCell>
                          <TableCell className="num hidden sm:table-cell">{s.date}</TableCell>
                          <TableCell className="hidden md:table-cell">{s.name}</TableCell>
                          <TableCell className="hidden sm:table-cell">{s.kind}</TableCell>
                          <TableCell className="text-right"><Money value={BigInt(s.pph)} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {d.unmatchedBook.length > 0 && (
                <div data-testid={`bupot-noslip-${d.direction}`}>
                  <p className="eyebrow mb-1 text-muted-foreground">Pemotongan di buku tanpa bukti potong</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="eyebrow hidden sm:table-cell">Tanggal</TableHead>
                        <TableHead className="eyebrow">Mutasi bank</TableHead>
                        <TableHead className="eyebrow hidden sm:table-cell">Jenis</TableHead>
                        <TableHead className="eyebrow text-right">PPh</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.unmatchedBook.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="num hidden sm:table-cell">{b.date}</TableCell>
                          <TableCell className="whitespace-normal"><Link href={b.href} className="hover:text-primary">{b.description}</Link></TableCell>
                          <TableCell className="hidden sm:table-cell">{b.kind}</TableCell>
                          <TableCell className="text-right"><Money value={BigInt(b.pph)} /></TableCell>
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
                    <AlertDialogAction variant="destructive" onClick={() => remove(d.direction)}>Hapus bukti potong</AlertDialogAction>
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
