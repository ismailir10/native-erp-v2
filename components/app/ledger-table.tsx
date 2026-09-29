"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccountPicker, type AccountOption } from "@/components/app/account-picker";
import { reviewAction } from "@/app/actions";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MethodBadge } from "@/components/app/status";
import { formatMoney } from "@/lib/money";

export type LedgerRow = {
  id: string;
  date: string;
  entity: string;
  memo: string;
  kind: string;
  /** "Nama · 27 Sep 2026, 14:02" — who posted the entry and when; "Sistem" for seeds. */
  postedBy?: string;
  debit: string;
  credit: string;
  balance: string;
  entry: { lines: { code: string; name: string; debit: string; credit: string }[] };
  source: null | { bankTxId: string; accountCode: string | null; taxTag: string | null; fileName: string; sheet: string | null; rowNumber: number; rawRow: string; description: string; amount: string; bank: string; method: string; reason: string; status: string };
  /** Ledger / Neraca import: file, entry rows, this line's row, the client's own account, and the original fx amount. */
  fileSource?: null | { fileName: string; entryRef: string; lineRef: string | null; sourceAccount: string | null; lineMemo: string | null; fx: string | null };
};

const KIND: Record<string, string> = { OPENING: "Saldo awal", BANK: "Mutasi bank", RECLASS: "Reklasifikasi", ADJUSTMENT: "Penyesuaian", IMPORTED: "Impor buku besar", INVOICE: "Faktur" };

/** Every GL line opens its source: the full journal and — for bank lines — the original statement row, for imports the file row. */
export function LedgerTable({ rows, opening, currency = "IDR", accounts }: { rows: LedgerRow[]; opening: string; currency?: string; accounts?: AccountOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<LedgerRow | null>(null);
  const [newCode, setNewCode] = useState("");
  const [saving, setSaving] = useState(false);
  const show = (r: LedgerRow | null) => {
    setOpen(r);
    setNewCode(r?.source?.accountCode ?? "");
  };
  // A bank line's classification can change after it was accepted: the reviewer's writer posts a RECLASS of the difference
  // (rule 3) and memory learns it; a locked month refuses with the lock message.
  const reclass = async () => {
    if (!open?.source || !newCode) return;
    setSaving(true);
    const r = await reviewAction({ bankTxId: open.source.bankTxId, accountCode: newCode, taxTag: open.source.taxTag as never });
    setSaving(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`Dipindah ke ${newCode}`, { description: "Reklasifikasi dicatat · Buku Besar diperbarui" });
    show(null);
    router.refresh();
  };
  const m = (s: string) => (BigInt(s) === 0n ? "" : formatMoney(BigInt(s), currency, { bare: true }));
  const acc = (s: string) => formatMoney(BigInt(s), currency, { bare: true, accounting: true });
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-6">Tanggal</TableHead>
            <TableHead>Keterangan</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Kredit</TableHead>
            <TableHead className="pr-6 text-right">Saldo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="bg-muted/40">
            <TableCell className="pl-6 text-muted-foreground" colSpan={4}>Saldo awal periode</TableCell>
            <TableCell className="num pr-6 text-right font-medium">{acc(opening)}</TableCell>
          </TableRow>
          {rows.map((r) => (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => show(r)} data-testid="ledger-row">
              <TableCell className="num pl-6 whitespace-nowrap text-muted-foreground">{r.date}</TableCell>
              <TableCell className="max-w-md">
                <button type="button" className="block max-w-full truncate text-left underline decoration-border underline-offset-4 hover:text-primary hover:decoration-primary" onClick={(e) => { e.stopPropagation(); show(r); }}>{r.memo}</button>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {KIND[r.kind]} · {r.entity}
                  {(r.source || r.fileSource) && <FileText className="size-3" aria-label="Ada sumber" />}
                </div>
              </TableCell>
              <TableCell className="num text-right">{m(r.debit)}</TableCell>
              <TableCell className="num text-right">{m(r.credit)}</TableCell>
              <TableCell className="num pr-6 text-right">{acc(r.balance)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Sheet open={Boolean(open)} onOpenChange={(o) => !o && show(null)}>
        <SheetContent className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>{KIND[open.kind]} · {open.date}</SheetTitle>
                <SheetDescription>{open.memo}{open.postedBy && <span className="mt-1 block text-xs">Dicatat oleh {open.postedBy}</span>}</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 px-4 pb-6">
                {open.source && (
                  <section data-testid="source-row">
                    <h3 className="mb-2 text-sm font-semibold">Sumber: baris rekening koran</h3>
                    <dl className="grid grid-cols-3 gap-y-1.5 text-sm">
                      <dt className="text-muted-foreground">Rekening</dt><dd className="col-span-2">{open.source.bank}</dd>
                      <dt className="text-muted-foreground">File</dt><dd className="col-span-2 font-mono text-xs">{open.source.fileName}, {open.source.sheet ? `lembar ${open.source.sheet}, ` : ""}baris {open.source.rowNumber}</dd>
                      <dt className="text-muted-foreground">Nominal</dt><dd className="num col-span-2">{formatMoney(BigInt(open.source.amount), currency)}</dd>
                      <dt className="text-muted-foreground">Klasifikasi</dt><dd className="col-span-2 flex items-center gap-2"><MethodBadge method={open.source.method} /> <span className="text-xs text-muted-foreground">{open.source.reason}</span></dd>
                    </dl>
                    <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">{open.source.rawRow}</pre>
                    {accounts && (
                      <div className="mt-4 space-y-2 border-t pt-4" data-testid="reclass">
                        <h4 className="text-sm font-semibold">Ubah akun</h4>
                        <p className="text-xs text-muted-foreground">Sisi bank tetap; Buku mencatat reklasifikasi selisihnya dan mengingat pilihan ini.</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <AccountPicker value={newCode} onChange={setNewCode} options={accounts} ariaLabel="Akun baru" className="w-80 max-w-full" />
                          <Button size="sm" disabled={saving || !newCode || newCode === open.source.accountCode} onClick={reclass}>Simpan</Button>
                        </div>
                      </div>
                    )}
                  </section>
                )}
                {open.fileSource && (
                  <section data-testid="file-source">
                    <h3 className="mb-2 text-sm font-semibold">Sumber: baris file impor</h3>
                    <dl className="grid grid-cols-3 gap-y-1.5 text-sm">
                      <dt className="text-muted-foreground">File</dt><dd className="col-span-2 font-mono text-xs break-all">{open.fileSource.fileName}</dd>
                      {open.fileSource.lineRef && (<><dt className="text-muted-foreground">Baris ini</dt><dd className="col-span-2 font-mono text-xs">{open.fileSource.lineRef}</dd></>)}
                      <dt className="text-muted-foreground">Jurnal dari baris</dt><dd className="col-span-2 font-mono text-xs break-all">{open.fileSource.entryRef}</dd>
                      {open.fileSource.sourceAccount && (<><dt className="text-muted-foreground">Akun di file</dt><dd className="col-span-2">{open.fileSource.sourceAccount}</dd></>)}
                      {open.fileSource.fx && (<><dt className="text-muted-foreground">Valas</dt><dd className="num col-span-2">{open.fileSource.fx}</dd></>)}
                      {open.fileSource.lineMemo && (<><dt className="text-muted-foreground">Keterangan</dt><dd className="col-span-2 text-xs">{open.fileSource.lineMemo}</dd></>)}
                    </dl>
                  </section>
                )}
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Jurnal</h3>
                  <Table className="table-fixed text-sm">
                    <TableHeader>
                      <TableRow><TableHead>Akun</TableHead><TableHead className="w-36 text-right">Debit</TableHead><TableHead className="w-36 text-right">Kredit</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {open.entry.lines.map((l, i) => (
                        <TableRow key={i}>
                          <TableCell className="truncate"><span className="num text-muted-foreground">{l.code}</span> {l.name}</TableCell>
                          <TableCell className="num text-right">{m(l.debit)}</TableCell>
                          <TableCell className="num text-right">{m(l.credit)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
