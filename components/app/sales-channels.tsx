"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/app/money";
import { setContactChannelAction } from "@/app/actions";

export type ChannelSalesView = {
  currency: string;
  channels: { channel: string; month: string; ytd: string; customers: { id: string; name: string; month: string; ytd: string }[] }[];
  total: { month: string; ytd: string };
};

const share = (part: string, whole: string) => (BigInt(whole) === 0n ? "" : `${(Number((BigInt(part) * 1000n) / BigInt(whole)) / 10).toLocaleString("id-ID")}%`);

/**
 * Penjualan per channel (UC-B5): DPP of the month and the year to date by channel, then by customer. A customer's channel is set here
 * (suggestions plus the channels already used); without one they sit under *Tanpa channel*.
 */
export function SalesChannels({ clientId, views, monthLabel, yearLabel, suggestions, noChannel }: { clientId: string; views: ChannelSalesView[]; monthLabel: string; yearLabel: string; suggestions: string[]; noChannel: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string; name: string; channel: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const used = [...new Set([...suggestions, ...views.flatMap((v) => v.channels.map((c) => c.channel).filter((c) => c !== noChannel))])];

  async function save(channel: string) {
    if (!editing) return;
    setBusy(true);
    const r = await setContactChannelAction({ clientId, contactId: editing.id, channel });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.channel ? `${editing.name}: ${r.channel}` : `Channel ${editing.name} dihapus`);
    setEditing(null);
    router.refresh();
  }

  return (
    <>
      {views.map((v) => (
        <Card key={v.currency} data-testid="sales-channels">
          <CardHeader>
            <CardTitle>Penjualan per channel</CardTitle>
            <CardDescription>DPP faktur penjualan {monthLabel} dan tahun buku {yearLabel} sampai bulan ini, per channel lalu per pelanggan. Faktur yang dikeluarkan dan rincian saldo awal tidak dihitung.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Channel / pelanggan</TableHead>
                  <TableHead className="text-right">{monthLabel}</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Tahun berjalan</TableHead>
                  <TableHead className="pr-6 text-right">Porsi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {v.channels.map((c) => (
                  <Fragment key={c.channel}>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell className={c.channel === noChannel ? "pl-6 font-medium text-review" : "pl-6 font-medium"}>{c.channel}</TableCell>
                      <TableCell className="text-right"><Money strong value={BigInt(c.month)} currency={v.currency} /></TableCell>
                      <TableCell className="hidden text-right sm:table-cell"><Money strong value={BigInt(c.ytd)} currency={v.currency} /></TableCell>
                      <TableCell className="num pr-6 text-right">{share(c.ytd, v.total.ytd)}</TableCell>
                    </TableRow>
                    {c.customers.map((x) => (
                      <TableRow key={x.id}>
                        <TableCell className="pl-10 whitespace-normal">
                          {x.name}
                          <Button variant="ghost" size="icon-xs" className="ml-1 align-middle" aria-label={`Ubah channel ${x.name}`} onClick={() => setEditing({ id: x.id, name: x.name, channel: c.channel === noChannel ? "" : c.channel })}>
                            <Pencil />
                          </Button>
                        </TableCell>
                        <TableCell className="text-right"><Money value={BigInt(x.month)} currency={v.currency} /></TableCell>
                        <TableCell className="hidden text-right sm:table-cell"><Money value={BigInt(x.ytd)} currency={v.currency} /></TableCell>
                        <TableCell className="num pr-6 text-right text-muted-foreground">{share(x.ytd, v.total.ytd)}</TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-6 font-medium">Jumlah</TableCell>
                  <TableCell className="text-right"><Money strong value={BigInt(v.total.month)} currency={v.currency} /></TableCell>
                  <TableCell className="hidden text-right sm:table-cell"><Money strong value={BigInt(v.total.ytd)} currency={v.currency} /></TableCell>
                  <TableCell className="pr-6" />
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      ))}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Channel {editing?.name}</DialogTitle>
            <DialogDescription>Dari mana pelanggan ini membeli. Berlaku untuk semua fakturnya, termasuk yang lalu.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="channel-name">Channel</FieldLabel>
            <Input id="channel-name" maxLength={40} value={editing?.channel ?? ""} onChange={(e) => setEditing((x) => (x ? { ...x, channel: e.target.value } : x))} placeholder="Mis. Marketplace" />
            <div className="flex flex-wrap gap-1.5">
              {used.map((u) => (
                <Button key={u} type="button" variant={editing?.channel === u ? "secondary" : "outline"} size="xs" onClick={() => setEditing((x) => (x ? { ...x, channel: u } : x))}>{u}</Button>
              ))}
            </div>
            <FieldDescription>Kosongkan untuk memindahkan ke {noChannel}.</FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Batal</Button>
            <Button disabled={busy} onClick={() => save(editing?.channel ?? "")} data-testid="channel-save">Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
