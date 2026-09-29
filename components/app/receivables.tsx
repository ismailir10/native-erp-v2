"use client";

import { Fragment, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SimpleSelect } from "@/components/app/simple-select";
import { Money } from "@/components/app/money";
import { StatusPill } from "@/components/app/status";
import { createInvoiceAction, settleAction, settleCandidatesAction, unsettleAction } from "@/app/actions";
import { BUCKETS, BUCKET_LABEL } from "@/lib/receivables/aging";
import { formatMoney, parseMoney, PPN_EFFECTIVE_PERCENT } from "@/lib/money";
import type { AgingView, CandidateView, ComparisonView, InvoiceView, UnsettledLineView } from "@/lib/receivables/view";

type Account = { code: string; name: string };
type Direction = "SALES" | "PURCHASE";
type InvoiceForm = { entityId: string; contactName: string; number: string; issueDate: string; dueDate: string; description: string; dpp: string; ppn: string; counterCode: string; arApCode: string; opening: boolean };

const WORDS = {
  SALES: { party: "Pelanggan", doc: "Faktur", docLower: "faktur", newDoc: "Faktur baru", counter: "Akun pendapatan", arAp: "Akun piutang", money: "penerimaan", lines: "Penerimaan di akun piutang belum dicocokkan" },
  PURCHASE: { party: "Pemasok", doc: "Tagihan", docLower: "tagihan", newDoc: "Tagihan baru", counter: "Akun beban / aset", arAp: "Akun utang", money: "pembayaran", lines: "Pembayaran di akun utang belum dicocokkan" },
} as const;

/** Receivables or payables of the page's scope: aging, invoices with their settlements, and the forms (accounting-rules 5c). */
export function Receivables(props: {
  clientId: string;
  direction: Direction;
  entities: { id: string; name: string; currency: string }[];
  invoices: InvoiceView[];
  aging: AgingView[];
  comparison: ComparisonView[];
  unsettled: UnsettledLineView[];
  contacts: string[];
  accounts: { counter: Account[]; arAp: Account[] };
  defaultDate: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const w = WORDS[props.direction];
  const [form, setForm] = useState<InvoiceForm | null>(null);
  const [matching, setMatching] = useState<{ invoice: InvoiceView; candidates: CandidateView[] | null } | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<InvoiceForm>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const currency = props.entities.find((e) => e.id === form?.entityId)?.currency ?? "IDR";

  const blank = (): InvoiceForm => ({
    entityId: props.entities[0]?.id ?? "",
    contactName: "",
    number: "",
    issueDate: props.defaultDate,
    dueDate: "",
    description: "",
    dpp: "",
    ppn: "",
    counterCode: props.accounts.counter.find((a) => a.code === (props.direction === "SALES" ? "4100" : "6190"))?.code ?? props.accounts.counter[0]?.code ?? "",
    arApCode: props.accounts.arAp[0]?.code ?? "",
    opening: false,
  });

  let total = "";
  let amountError = "";
  try {
    const dpp = form?.dpp ? parseMoney(form.dpp, currency) : 0n;
    const ppn = form?.ppn ? parseMoney(form.ppn, currency) : 0n;
    if (dpp + ppn > 0n) total = formatMoney(dpp + ppn, currency);
  } catch (e) {
    amountError = (e as Error).message;
  }
  const ppnFromDpp = () => {
    try {
      const dpp = parseMoney(form?.dpp ?? "", currency);
      set({ ppn: formatMoney((2n * dpp * PPN_EFFECTIVE_PERCENT + 100n) / 200n, currency, { bare: true }) });
    } catch {
      toast.error("Isi DPP dulu.");
    }
  };

  const submit = async () => {
    if (!form) return;
    setBusy(true);
    const r = await createInvoiceAction({ clientId: props.clientId, direction: props.direction, ...form, dueDate: form.dueDate || null, ppn: form.ppn || null });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`${w.doc} ${form.number} dicatat`);
    setForm(null);
    router.refresh();
  };

  const openMatching = async (invoice: InvoiceView) => {
    setMatching({ invoice, candidates: null });
    const r = await settleCandidatesAction(props.clientId, invoice.id);
    if (!r.ok) return void toast.error(r.error);
    setAmounts(Object.fromEntries(r.candidates.map((c) => [c.bankTransactionId, formatMoney(BigInt(c.free) < BigInt(invoice.open) ? BigInt(c.free) : BigInt(invoice.open), invoice.currency, { bare: true })])));
    setMatching({ invoice, candidates: r.candidates });
  };

  const doSettle = async (c: CandidateView) => {
    if (!matching) return;
    setBusy(true);
    const r = await settleAction({ clientId: props.clientId, invoiceId: matching.invoice.id, bankTransactionId: c.bankTransactionId, amount: amounts[c.bankTransactionId] || null });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`${matching.invoice.number} dicocokkan dengan ${w.money} ${c.date}`);
    setMatching(null);
    router.refresh();
  };

  const doUnsettle = async (id: string) => {
    setBusy(true);
    const r = await unsettleAction(props.clientId, id);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Pencocokan dihapus");
    router.refresh();
  };

  const switchTab = (v: string) => {
    const p = new URLSearchParams(params.toString());
    p.set("tab", v);
    router.push(`${pathname}?${p.toString()}`);
  };

  const openInvoices = props.invoices.filter((i) => BigInt(i.open) > 0n);
  const paid = props.invoices.filter((i) => BigInt(i.open) === 0n);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={props.direction === "SALES" ? "piutang" : "utang"} onValueChange={(v) => switchTab(v as string)}>
          <TabsList>
            <TabsTrigger value="piutang">Piutang</TabsTrigger>
            <TabsTrigger value="utang">Utang</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setForm({ ...blank(), opening: true })}>{w.doc} saldo awal</Button>
          <Button variant="outline" size="sm" onClick={() => setForm(blank())}><Plus /> {w.newDoc}</Button>
        </div>
      </div>

      {props.aging.map((a) => {
        const cmp = props.comparison.find((c) => c.entityId === a.entityId);
        return (
          <Card key={a.entityId} data-testid={`aging-${a.entity}`}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle>Umur {props.direction === "SALES" ? "piutang" : "utang"} · {a.entity}</CardTitle>
                <CardDescription>Sisa per {w.party.toLowerCase()} menurut hari lewat jatuh tempo (rinciannya di layar lebar).</CardDescription>
              </div>
              {cmp && <StatusPill status={cmp.equal ? "PASS" : "REVIEW"} label={cmp.equal ? "Cocok dengan buku besar" : "Beda dengan buku besar"} />}
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">{w.party}</TableHead>
                    {BUCKETS.map((b) => <TableHead key={b} className="hidden text-right md:table-cell">{BUCKET_LABEL[b]}</TableHead>)}
                    <TableHead className="pr-6 text-right">Jumlah</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {a.rows.map((r) => (
                    <TableRow key={r.contact}>
                      <TableCell className="pl-6 whitespace-normal">{r.contact} <span className="text-xs text-muted-foreground">· {r.count} {w.docLower}</span></TableCell>
                      {BUCKETS.map((b) => <TableCell key={b} className="hidden text-right md:table-cell"><Money value={BigInt(r.buckets[b])} currency={a.currency} /></TableCell>)}
                      <TableCell className="pr-6 text-right"><Money strong value={BigInt(r.total)} currency={a.currency} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="pl-6 font-medium">Jumlah</TableCell>
                    {BUCKETS.map((b) => <TableCell key={b} className="hidden text-right md:table-cell"><Money strong value={BigInt(a.totals[b])} currency={a.currency} /></TableCell>)}
                    <TableCell className="pr-6 text-right"><Money strong value={BigInt(a.totals.total)} currency={a.currency} /></TableCell>
                  </TableRow>
                  {cmp && (
                    <TableRow data-testid="subledger-ledger">
                      <TableCell className="pl-6 text-muted-foreground whitespace-normal" colSpan={1}>Buku besar ({cmp.accounts.join(", ")})</TableCell>
                      <TableCell className="hidden md:table-cell" colSpan={BUCKETS.length} />
                      <TableCell className="pr-6 text-right"><Money muted value={BigInt(cmp.ledger)} currency={cmp.currency} /></TableCell>
                    </TableRow>
                  )}
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        );
      })}

      {props.unsettled.length > 0 && (
        <Card data-testid="unsettled-lines">
          <CardHeader>
            <CardTitle>{w.lines}</CardTitle>
            <CardDescription>Mutasi bank yang sudah dicatat ke akun {props.direction === "SALES" ? "piutang" : "utang"} tapi belum dikaitkan ke {w.docLower}. Buka {w.docLower}nya lalu pilih Cocokkan.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y px-0">
            {props.unsettled.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-2.5">
                <div className="min-w-0 flex-1 basis-64">
                  <div className="text-sm">{l.description}</div>
                  <div className="text-xs text-muted-foreground">{l.entity} · {l.date} · {l.accountCode}</div>
                </div>
                <Money className="text-sm" value={BigInt(l.free)} currency={l.currency} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card data-testid="invoices">
        <CardHeader>
          <CardTitle>{w.doc} terbuka</CardTitle>
          <CardDescription>Yang paling lama lewat jatuh tempo di atas. Buka panah di ujung baris untuk melihat pelunasannya.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {openInvoices.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">Tidak ada {w.docLower} terbuka per tanggal ini.</p>
          ) : (
            <InvoiceTable rows={openInvoices} w={w} open={open} setOpen={setOpen} onMatch={openMatching} onUnsettle={doUnsettle} busy={busy} />
          )}
        </CardContent>
      </Card>
      {paid.length > 0 && (
        <Card data-testid="invoices-paid">
          <CardHeader>
            <CardTitle>{w.doc} lunas</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <InvoiceTable rows={paid} w={w} open={open} setOpen={setOpen} onUnsettle={doUnsettle} busy={busy} />
          </CardContent>
        </Card>
      )}

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form?.opening ? `${w.doc} saldo awal` : w.newDoc}</DialogTitle>
            <DialogDescription>
              {form?.opening
                ? `Rincian ${props.direction === "SALES" ? "piutang" : "utang"} yang sudah ada di Saldo Awal. Tidak dijurnal lagi; tanggalnya paling lambat tanggal Saldo Awal.`
                : props.direction === "SALES"
                  ? "Dijurnal saat disimpan: piutang di debit, pendapatan dan PPN Keluaran di kredit."
                  : "Dijurnal saat disimpan: beban atau aset dan PPN Masukan di debit, utang di kredit."}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-4 sm:grid-cols-2">
              {props.entities.length > 1 && (
                <Field className="sm:col-span-2">
                  <FieldLabel>Entitas</FieldLabel>
                  <SimpleSelect label="Entitas" value={form.entityId} onChange={(v) => set({ entityId: v })} options={props.entities.map((e) => ({ value: e.id, label: e.name }))} />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="inv-contact">{w.party}</FieldLabel>
                <Input id="inv-contact" list="inv-contacts" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} placeholder="Nama sesuai dokumen" />
                <datalist id="inv-contacts">{props.contacts.map((c) => <option key={c} value={c} />)}</datalist>
              </Field>
              <Field>
                <FieldLabel htmlFor="inv-number">Nomor {w.docLower}</FieldLabel>
                <Input id="inv-number" value={form.number} onChange={(e) => set({ number: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="inv-date">Tanggal {w.docLower}</FieldLabel>
                <Input id="inv-date" type="date" value={form.issueDate} onChange={(e) => set({ issueDate: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="inv-due">Jatuh tempo</FieldLabel>
                <Input id="inv-due" type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
                <FieldDescription>Kosongkan bila jatuh tempo saat itu juga.</FieldDescription>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="inv-desc">Keterangan (opsional)</FieldLabel>
                <Input id="inv-desc" value={form.description} onChange={(e) => set({ description: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="inv-dpp">DPP{currency === "IDR" ? "" : ` (${currency})`}</FieldLabel>
                <Input id="inv-dpp" inputMode="decimal" className="num text-right" value={form.dpp} onChange={(e) => set({ dpp: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="inv-ppn">PPN (opsional)</FieldLabel>
                <div className="flex gap-2">
                  <Input id="inv-ppn" inputMode="decimal" className="num text-right" value={form.ppn} onChange={(e) => set({ ppn: e.target.value })} />
                  <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={ppnFromDpp}>Hitung 11%</Button>
                </div>
                <FieldDescription>Sesuai faktur pajak; 11 % = tarif efektif (12 % × 11/12).</FieldDescription>
              </Field>
              {!form.opening && (
                <Field>
                  <FieldLabel>{w.counter}</FieldLabel>
                  <SimpleSelect label={w.counter} value={form.counterCode} onChange={(v) => set({ counterCode: v })} options={props.accounts.counter.map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }))} placeholder="Pilih akun" />
                </Field>
              )}
              <Field>
                <FieldLabel>{w.arAp}</FieldLabel>
                <SimpleSelect label={w.arAp} value={form.arApCode} onChange={(v) => set({ arApCode: v })} options={props.accounts.arAp.map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }))} />
              </Field>
              <div className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox id="inv-opening" checked={form.opening} onCheckedChange={(v) => set({ opening: v === true })} />
                <label htmlFor="inv-opening">{w.doc} saldo awal (sudah termasuk di Saldo Awal, tidak dijurnal)</label>
              </div>
              <p className="text-sm text-muted-foreground sm:col-span-2">{amountError ? <span className="text-destructive">{amountError}</span> : total ? `Total ${total}` : "Isi DPP dan PPN."}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Batal</Button>
            <Button disabled={busy || !form?.contactName.trim() || !form?.number.trim() || !total || (!form?.opening && !form?.counterCode)} onClick={submit}>{busy ? "Menyimpan…" : `Simpan ${w.docLower}`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={matching !== null} onOpenChange={(o) => !o && setMatching(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cocokkan {w.money} · {matching?.invoice.number}</DialogTitle>
            <DialogDescription>
              Sisa {matching ? formatMoney(BigInt(matching.invoice.open), matching.invoice.currency) : ""} dari {matching?.invoice.contact}. Yang nominalnya sama dan menyebut nama atau nomornya di atas. Mutasi yang belum dicatat ke akun {matching?.invoice.arApCode} diklasifikasikan ke sana sekalian.
            </DialogDescription>
          </DialogHeader>
          {matching?.candidates === null ? (
            <p className="text-sm text-muted-foreground">Mencari mutasi…</p>
          ) : matching?.candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada mutasi bank entitas ini yang bisa dicocokkan sejak tanggal {w.docLower}. Impor rekening korannya dulu.</p>
          ) : (
            <div className="divide-y rounded-lg border" data-testid="settle-candidates">
              {matching?.candidates.map((c) => (
                <div key={c.bankTransactionId} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="text-sm">{c.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.date} · sisa <span className="num">{formatMoney(BigInt(c.free), matching.invoice.currency)}</span>
                      {c.exact ? " · nominal sama" : ""}{c.named ? " · nama/nomor cocok" : ""}{c.onAccount ? "" : ` · akan diklasifikasikan ke ${matching.invoice.arApCode}`}
                    </div>
                  </div>
                  <Input aria-label={`Nominal ${c.date}`} inputMode="decimal" className="num w-36 text-right" value={amounts[c.bankTransactionId] ?? ""} onChange={(e) => setAmounts({ ...amounts, [c.bankTransactionId]: e.target.value })} />
                  <Button size="sm" variant={c.exact && c.named ? "default" : "outline"} disabled={busy} onClick={() => doSettle(c)}>Cocokkan</Button>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatching(null)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvoiceTable(props: { rows: InvoiceView[]; w: (typeof WORDS)[Direction]; open: string | null; setOpen: (id: string | null) => void; onMatch?: (i: InvoiceView) => void; onUnsettle: (id: string) => void; busy: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">{props.w.doc}</TableHead>
          <TableHead className="hidden md:table-cell">Jatuh tempo</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Total</TableHead>
          <TableHead className="text-right">Sisa</TableHead>
          <TableHead className="w-28 pr-6"><span className="sr-only">Aksi</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.rows.map((i) => (
          <Fragment key={i.id}>
            <TableRow className="cursor-pointer" onClick={() => props.setOpen(props.open === i.id ? null : i.id)} data-testid={`invoice-${i.number}`}>
              <TableCell className="pl-6 whitespace-normal">
                <div className="font-medium">{i.number} · {i.contact}</div>
                <div className="text-xs text-muted-foreground">{i.entity} · {i.issued}{i.opening ? " · saldo awal" : ""} · {i.description}</div>
              </TableCell>
              <TableCell className={i.daysPastDue > 0 && BigInt(i.open) > 0n ? "hidden text-review md:table-cell" : "hidden text-muted-foreground md:table-cell"}>
                {i.due}{i.daysPastDue > 0 && BigInt(i.open) > 0n ? ` · lewat ${i.daysPastDue} hari` : ""}
              </TableCell>
              <TableCell className="hidden text-right sm:table-cell"><Money value={BigInt(i.total)} currency={i.currency} /></TableCell>
              <TableCell className="text-right"><Money strong value={BigInt(i.open)} currency={i.currency} /></TableCell>
              <TableCell className="pr-6 text-right whitespace-nowrap">
                {props.onMatch && <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); props.onMatch!(i); }}>Cocokkan</Button>}
                <Button variant="ghost" size="icon-sm" aria-label={`Pelunasan ${i.number}`} aria-expanded={props.open === i.id} onClick={(e) => { e.stopPropagation(); props.setOpen(props.open === i.id ? null : i.id); }}>
                  <ChevronDown className={props.open === i.id ? "rotate-180" : ""} />
                </Button>
              </TableCell>
            </TableRow>
            {props.open === i.id && (
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableCell colSpan={5} className="px-6 py-3 whitespace-normal">
                  {i.settlements.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Belum ada pelunasan.</p>
                  ) : (
                    <ul className="space-y-1.5 text-sm">
                      {i.settlements.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-x-3">
                          <span className="text-muted-foreground">{s.date}</span>
                          <span className="min-w-0 flex-1 truncate">{s.description}</span>
                          <Money value={BigInt(s.amount)} currency={i.currency} />
                          <Button variant="ghost" size="sm" disabled={props.busy} onClick={() => props.onUnsettle(s.id)}>Hapus</Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}
