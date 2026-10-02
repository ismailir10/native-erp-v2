"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SimpleSelect } from "@/components/app/simple-select";
import { Money } from "@/components/app/money";
import { StatusPill } from "@/components/app/status";
import { cancelLeaseAction, createLeaseAction, postLeaseMonthsAction } from "@/app/actions";
import { formatMoney } from "@/lib/money";
import type { LeaseRegisterView, LeaseRowView } from "@/lib/leases/view";

type Result = { ok: true } | { ok: false; error: string };
type Form = { entityId: string; name: string; lessor: string; start: string; months: string; payment: string; intervalMonths: string; timing: "ADVANCE" | "ARREARS"; rate: string };

/** "Sewa Gudang" stays as is; "Gudang Cikarang" becomes "Sewa Gudang Cikarang" (no "Sewa Sewa …"). */
const leaseLabel = (name: string) => (/^sewa\b/i.test(name.trim()) ? name.trim() : `Sewa ${name.trim()}`);
const STATUS: Record<LeaseRowView["status"], string> = { AKTIF: "aktif", SELESAI: "selesai", BELUM_MULAI: "belum mulai", DIBATALKAN: "dibatalkan" };

/** The lease register of the scope (PSAK 116, accounting-rules 5f): contracts, carrying amounts at the month-end, schedules, journals. */
export function LeaseRegister(props: { clientId: string; year: number; month: number; periodKey: string; periodLabel: string; entities: { id: string; name: string; currency: string }[]; registers: LeaseRegisterView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [cancelling, setCancelling] = useState<LeaseRowView | null>(null);

  const run = async (action: () => Promise<Result>, done: string, after?: () => void) => {
    setBusy(true);
    const r = await action();
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(done);
    after?.();
    router.refresh();
  };
  const blank = (): Form => ({ entityId: props.entities[0]?.id ?? "", name: "", lessor: "", start: props.periodKey, months: "36", payment: "", intervalMonths: "1", timing: "ADVANCE", rate: "" });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setForm(blank())}><Plus /> Sewa baru</Button>
      </div>

      {props.registers.length === 0 && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">Belum ada sewa terdaftar untuk cakupan ini. Sewa lebih dari 12 bulan dicatat sebagai aset hak guna dan liabilitas sewa (PSAK 116).</CardContent></Card>
      )}

      {props.registers.map((reg) => {
        const cur = reg.entity.currency;
        const ledger = (code: string, node: React.ReactNode) => <Link href={`/clients/${props.clientId}/ledger/${code}?entity=${reg.entity.id}&period=${props.periodKey}`} className="underline-offset-2 hover:text-primary hover:underline">{node}</Link>;
        return (
          <Card key={reg.entity.id} data-testid={`leases-${reg.entity.shortName}`}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle>Daftar Sewa · {reg.entity.name}</CardTitle>
                <CardDescription>Posisi per akhir {props.periodLabel}, dengan anggapan jurnal bulanan sudah dicatat dan pembayaran dilakukan sesuai jadwal.</CardDescription>
              </div>
              {reg.ledger && <StatusPill status={reg.ledger.equal ? "PASS" : "REVIEW"} label={reg.ledger.equal ? "Cocok dengan buku besar" : "Beda dengan buku besar"} />}
            </CardHeader>
            <CardContent className="space-y-4 px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Sewa</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Aset hak guna</TableHead>
                    <TableHead className="text-right">Nilai buku</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Jangka pendek</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Jangka panjang</TableHead>
                    <TableHead className="pr-6 text-right">Liabilitas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reg.rows.map((r) => (
                    <Fragment key={r.id}>
                      <TableRow data-testid={`lease-${r.name}`}>
                        <TableCell className="pl-6 whitespace-normal">
                          <button type="button" className="inline-flex items-center gap-1 text-left font-medium hover:text-primary" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                            {open === r.id ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
                            {r.name}
                          </button>
                          <div className="text-xs text-muted-foreground">
                            {r.lessor} · {r.start} – {r.end} ({r.months} bulan) · {formatMoney(BigInt(r.payment), cur)} {r.interval} {r.timing} · diskonto {r.rate} · {STATUS[r.status]}
                            {r.cancelled ? ` ${r.cancelled}` : ""}
                          </div>
                          {r.due > 0 && <div className="text-xs text-review">{r.due} jurnal bulanan belum dicatat</div>}
                          {r.canCancel && <Button variant="ghost" size="sm" className="-ml-2 h-6 px-2 text-xs" onClick={() => setCancelling(r)}>Batalkan</Button>}
                        </TableCell>
                        <TableCell className="hidden text-right md:table-cell"><Money value={BigInt(r.rou)} currency={cur} /></TableCell>
                        <TableCell className="text-right"><Money value={BigInt(r.carrying)} currency={cur} /></TableCell>
                        <TableCell className="hidden text-right lg:table-cell"><Money value={BigInt(r.current)} currency={cur} /></TableCell>
                        <TableCell className="hidden text-right lg:table-cell"><Money value={BigInt(r.nonCurrent)} currency={cur} /></TableCell>
                        <TableCell className="pr-6 text-right"><Money value={BigInt(r.liability)} currency={cur} /></TableCell>
                      </TableRow>
                      {open === r.id && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/30 px-0 py-0 whitespace-normal">
                            <div className="max-h-96 overflow-auto" data-testid={`lease-schedule-${r.name}`}>
                              <table className="w-full min-w-[320px] text-xs">
                                <thead className="sticky top-0 bg-muted text-muted-foreground">
                                  <tr>
                                    <th className="px-2 py-1.5 text-left font-medium sm:pl-6">Bulan</th>
                                    <th className="px-2 py-1.5 text-right font-medium">Bayar</th>
                                    <th className="px-2 py-1.5 text-right font-medium">Bunga</th>
                                    <th className="px-2 py-1.5 text-right font-medium">Liabilitas</th>
                                    <th className="hidden px-2 py-1.5 text-right font-medium sm:table-cell">Penyusutan</th>
                                    <th className="hidden px-2 py-1.5 text-right font-medium sm:table-cell sm:pr-6">Nilai buku</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.schedule.map((m) => (
                                    <tr key={m.k} className="border-t">
                                      <td className="px-2 py-1 sm:pl-6">{m.period}{m.posted ? " ✓" : ""}</td>
                                      <td className="px-2 py-1 text-right"><Money value={BigInt(m.payment)} currency={cur} /></td>
                                      <td className="px-2 py-1 text-right"><Money value={BigInt(m.interest)} currency={cur} /></td>
                                      <td className="px-2 py-1 text-right"><Money value={BigInt(m.closing)} currency={cur} /></td>
                                      <td className="hidden px-2 py-1 text-right sm:table-cell"><Money value={BigInt(m.depreciation)} currency={cur} /></td>
                                      <td className="hidden px-2 py-1 text-right sm:table-cell sm:pr-6"><Money value={BigInt(m.carrying)} currency={cur} /></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="pl-6 font-medium">Jumlah</TableCell>
                    <TableCell className="hidden text-right md:table-cell"><Money strong value={BigInt(reg.totals.rou)} currency={cur} /></TableCell>
                    <TableCell className="text-right"><Money strong value={BigInt(reg.totals.carrying)} currency={cur} /></TableCell>
                    <TableCell className="hidden text-right lg:table-cell"><Money strong value={BigInt(reg.totals.current)} currency={cur} /></TableCell>
                    <TableCell className="hidden text-right lg:table-cell"><Money strong value={BigInt(reg.totals.nonCurrent)} currency={cur} /></TableCell>
                    <TableCell className="pr-6 text-right"><Money strong value={BigInt(reg.totals.liability)} currency={cur} /></TableCell>
                  </TableRow>
                  {reg.ledger && (
                    <TableRow data-testid="leases-ledger">
                      <TableCell className="pl-6 text-muted-foreground whitespace-normal">Buku besar (1230, 1239, 2170 + 2400)</TableCell>
                      <TableCell className="hidden text-right md:table-cell">{ledger("1230", <Money muted value={BigInt(reg.ledger.rou)} currency={cur} />)}</TableCell>
                      <TableCell className="text-right">{ledger("1239", <Money muted value={BigInt(reg.ledger.rou) - BigInt(reg.ledger.accumulated)} currency={cur} />)}</TableCell>
                      <TableCell className="hidden lg:table-cell" colSpan={2} />
                      <TableCell className="pr-6 text-right">{ledger("2170", <Money muted value={BigInt(reg.ledger.liability)} currency={cur} />)}</TableCell>
                    </TableRow>
                  )}
                </TableFooter>
              </Table>
              <div className="space-y-2 px-6">
                {reg.due > 0 ? (
                  <Button disabled={busy} onClick={() => run(() => postLeaseMonthsAction({ clientId: props.clientId, entityId: reg.entity.id, year: props.year, month: props.month }), "Jurnal sewa dicatat")}>
                    Catat {reg.due} jurnal sewa s.d. {props.periodLabel}
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">Semua jurnal bulanan sewa s.d. {props.periodLabel} sudah dicatat.</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Jurnal bulanan: penyusutan 6181 / 1239, bunga 7195 / 2170, dan reklasifikasi bagian jangka panjang (2400) yang jatuh tempo dalam 12 bulan ke 2170.
                  Pembayaran sewa di rekening koran diklasifikasikan ke 2170 di Review.
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Daftarkan sewa</DialogTitle>
            <DialogDescription>Liabilitas sewa = nilai kini pembayaran; aset hak guna sebesar itu, disusutkan garis lurus. Jurnal pengakuan awal dicatat saat disimpan.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-4 sm:grid-cols-2">
              {props.entities.length > 1 && (
                <Field className="sm:col-span-2">
                  <FieldLabel>Entitas</FieldLabel>
                  <SimpleSelect label="Entitas" value={form.entityId} onChange={(v) => setForm({ ...form, entityId: v })} options={props.entities.map((e) => ({ value: e.id, label: e.name }))} />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="lease-name">Nama sewa</FieldLabel>
                <Input id="lease-name" placeholder="Sewa kantor Jl. Sudirman" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="lease-lessor">Pihak yang menyewakan</FieldLabel>
                <Input id="lease-lessor" value={form.lessor} onChange={(e) => setForm({ ...form, lessor: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="lease-start">Bulan mulai</FieldLabel>
                <Input id="lease-start" type="month" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
                <FieldDescription>Sewa yang sudah berjalan: mulai dari bulan pertama di Buku, dengan sisa pembayaran dan sisa masa sewa.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="lease-months">Masa sewa (bulan)</FieldLabel>
                <Input id="lease-months" inputMode="numeric" className="num text-right" value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value.replace(/\D/g, "") })} />
                <FieldDescription>Lebih dari 12 bulan; sewa jangka pendek langsung dibebankan.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="lease-payment">Pembayaran per interval</FieldLabel>
                <Input id="lease-payment" inputMode="decimal" className="num text-right" value={form.payment} onChange={(e) => setForm({ ...form, payment: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel>Interval pembayaran</FieldLabel>
                <SimpleSelect label="Interval pembayaran" value={form.intervalMonths} onChange={(v) => setForm({ ...form, intervalMonths: v })} options={[{ value: "1", label: "Bulanan" }, { value: "3", label: "Triwulanan" }, { value: "6", label: "Semesteran" }, { value: "12", label: "Tahunan" }]} />
              </Field>
              <Field>
                <FieldLabel>Waktu pembayaran</FieldLabel>
                <SimpleSelect label="Waktu pembayaran" value={form.timing} onChange={(v) => setForm({ ...form, timing: v as Form["timing"] })} options={[{ value: "ADVANCE", label: "Di muka (awal interval)" }, { value: "ARREARS", label: "Di akhir interval" }]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="lease-rate">Suku bunga diskonto (% per tahun)</FieldLabel>
                <Input id="lease-rate" inputMode="decimal" className="num text-right" placeholder="mis. 10" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
                <FieldDescription>Suku bunga pinjaman inkremental klien.</FieldDescription>
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Batal</Button>
            <Button
              disabled={busy || !form?.name.trim() || !form?.lessor.trim() || !form?.payment || !form?.rate || !form?.months}
              onClick={() => form && run(() => createLeaseAction({ clientId: props.clientId, entityId: form.entityId, name: form.name, lessor: form.lessor, start: form.start, months: Number(form.months), payment: form.payment, intervalMonths: Number(form.intervalMonths), timing: form.timing, rate: form.rate }), `${leaseLabel(form.name)} didaftarkan`, () => setForm(null))}
            >
              Simpan sewa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelling !== null} onOpenChange={(o) => !o && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batalkan sewa {cancelling?.name}?</DialogTitle>
            <DialogDescription>Jurnal pengakuan awalnya dibalik (tanggal sama). Pakai ini hanya untuk sewa yang salah didaftarkan; sewa tetap tercantum sebagai dibatalkan.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>Kembali</Button>
            <Button variant="destructive" disabled={busy} onClick={() => cancelling && run(() => cancelLeaseAction(props.clientId, cancelling.id), `${leaseLabel(cancelling.name)} dibatalkan`, () => setCancelling(null))}>Batalkan sewa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
