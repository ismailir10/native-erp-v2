"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, TableProperties } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Money } from "@/components/app/money";
import { columnGridAction, mappedDraftAction, mappedPreviewAction, type GridPreview, type MappedPreview } from "@/app/actions";
import type { ColumnMapping } from "@/lib/import/mapped";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** What a column holds in the accountant's mapping. "none": not used. */
type Role = "none" | "date" | "desc" | "debit" | "credit" | "amount" | "direction" | "balance";
const ROLE_LABEL: Record<Role, string> = {
  none: "—",
  date: "Tanggal",
  desc: "Keterangan",
  debit: "Debet",
  credit: "Kredit",
  amount: "Jumlah",
  direction: "Arah (D/K)",
  balance: "Saldo",
};
const ROLES = Object.keys(ROLE_LABEL) as Role[];
/** Roles one column at most can hold (Keterangan may span several). */
const SINGLE: Role[] = ["date", "debit", "credit", "amount", "direction", "balance"];

const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);

function rolesOf(m: ColumnMapping, width: number): Role[] {
  const r: Role[] = Array(width).fill("none");
  const set = (c: number | null, role: Role) => {
    if (c !== null && c >= 0 && c < width) r[c] = role;
  };
  m.description.forEach((c) => set(c, "desc"));
  set(m.date, "date");
  set(m.balance, "balance");
  if (m.amount.style === "split") {
    set(m.amount.debit, "debit");
    set(m.amount.credit, "credit");
  } else {
    set(m.amount.column, "amount");
    set(m.amount.direction, "direction");
  }
  return r;
}

/** The mapping the roles describe; -1 where a role is missing (the server names what to pick). */
function mappingOf(
  roles: Role[],
  base: {
    sheet: string | null;
    firstRow: number;
    order: "DMY" | "MDY";
    year: number | null;
  },
): ColumnMapping {
  const at = (role: Role) => roles.indexOf(role);
  const split = at("debit") >= 0 || at("credit") >= 0;
  return {
    ...base,
    date: at("date"),
    description: roles.flatMap((r, i) => (r === "desc" ? [i] : [])),
    amount: split
      ? { style: "split", debit: at("debit"), credit: at("credit") }
      : {
          style: "signed",
          column: at("amount"),
          direction: at("direction") >= 0 ? at("direction") : null,
        },
    balance: at("balance"),
  };
}

/**
 * *Atur kolom*: a text file Buku's readers don't know, shown as Buku sees it. The accountant marks the first transaction row and what each
 * column holds; five rows read with that mapping show before every row is read into *Periksa baris*. The file stays in this page and is sent
 * again with each step (the server reads it, never cell text from here).
 */
export function ColumnMapper({
  clientId,
  bankId,
  file,
  password,
  reason,
  onCancel,
}: {
  clientId: string;
  bankId: string;
  file: File;
  password: string;
  reason: string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [grid, setGrid] = useState<GridPreview | null>(null);
  const [sheet, setSheet] = useState(0);
  const [roles, setRoles] = useState<Role[]>([]);
  const [firstRow, setFirstRow] = useState(1);
  const [order, setOrder] = useState<"DMY" | "MDY">("DMY");
  const [year, setYear] = useState("");
  const [needsYear, setNeedsYear] = useState(false);
  const [preview, setPreview] = useState<{ ok: true; data: MappedPreview } | { ok: false; error: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();
  const seq = useRef(0);

  const form = (extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("bankAccountId", bankId);
    fd.set("file", file);
    if (password) fd.set("password", password);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  };

  const apply = (g: GridPreview, i: number) => {
    const s = g.sheets[i];
    setSheet(i);
    setRoles(rolesOf(s.suggestion, s.width));
    setFirstRow(s.suggestion.firstRow);
    setOrder(s.suggestion.order);
  };

  useEffect(() => {
    let live = true;
    columnGridAction(form()).then((r) => {
      if (!live) return;
      setLoading(false);
      if (!r.ok) {
        toast.error(r.error);
        onCancel();
        return;
      }
      setGrid(r.grid);
      apply(r.grid, 0);
    });
    return () => {
      live = false;
    };
    // The file and account are fixed for this mapper's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = grid?.sheets[sheet] ?? null;
  const mapping = useMemo(
    () =>
      current
        ? mappingOf(roles, {
            sheet: grid!.kind === "XLSX" ? current.name : null,
            firstRow,
            order,
            year: year.length === 4 ? Number(year) : null,
          })
        : null,
    [current, grid, roles, firstRow, order, year],
  );

  // Every change reads the first five rows again (the last answer wins).
  useEffect(() => {
    if (!mapping) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await mappedPreviewAction(form({ mapping: JSON.stringify(mapping) }));
      if (n !== seq.current) return;
      if (r.ok) setPreview({ ok: true, data: r.preview });
      else {
        if (r.needsYear) setNeedsYear(true);
        setPreview({ ok: false, error: r.error });
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping]);

  // Giving a column a role takes it from the column that had it (one Tanggal, one Saldo …); Jumlah and Debet/Kredit exclude each other.
  const clashes = (role: Role, other: Role) =>
    (SINGLE.includes(role) && other === role) ||
    (role === "amount" && (other === "debit" || other === "credit")) ||
    ((role === "debit" || role === "credit") && (other === "amount" || other === "direction"));
  const setRole = (col: number, role: Role) => setRoles((rs) => rs.map((r, i) => (i === col ? role : clashes(role, r) ? "none" : r)));

  const readAll = () =>
    start(async () => {
      if (!mapping) return;
      const r = await mappedDraftAction(form({ mapping: JSON.stringify(mapping) }));
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      router.push(`/clients/${clientId}/import/ocr/${r.draftId}`);
    });

  return (
    <Card className="min-w-0 lg:col-span-5" data-testid="column-mapper">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TableProperties className="size-5 text-primary" aria-hidden /> Atur kolom · {file.name}
        </CardTitle>
        <CardDescription>
          Tunjuk baris transaksi pertama dan isi setiap kolom. Setiap baris lalu dibuktikan dengan saldo berjalan sebelum Anda mengimpornya, dan susunan ini
          diingat: file berikutnya dengan judul kolom yang sama langsung terbaca.
        </CardDescription>
        <p className="text-xs text-muted-foreground">Kenapa: {reason}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading || !grid || !current ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Membaca file…
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4">
              {grid.sheets.length > 1 && (
                <Field className="w-48">
                  <FieldLabel>Lembar</FieldLabel>
                  <Select value={String(sheet)} onValueChange={(v) => apply(grid, Number(v))}>
                    <SelectTrigger className="w-full" aria-label="Lembar">
                      <SelectValue>{current.name}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {grid.sheets.map((s, i) => (
                        <SelectItem key={s.name} value={String(i)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <Field className="w-44">
                <FieldLabel htmlFor="map-first-row">Baris transaksi pertama</FieldLabel>
                <Input
                  id="map-first-row"
                  inputMode="numeric"
                  className="num w-28"
                  value={String(firstRow)}
                  onChange={(e) => setFirstRow(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))}
                />
              </Field>
              <Field className="w-48">
                <FieldLabel>Urutan tanggal</FieldLabel>
                <Select value={order} onValueChange={(v) => setOrder(v as "DMY" | "MDY")}>
                  <SelectTrigger className="w-full" aria-label="Urutan tanggal">
                    <SelectValue>{order === "DMY" ? "Hari/bulan (31/08)" : "Bulan/hari (08/31)"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DMY">Hari/bulan (31/08)</SelectItem>
                    <SelectItem value="MDY">Bulan/hari (08/31)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {needsYear && (
                <Field className="w-36">
                  <FieldLabel htmlFor="map-year">Tahun bulan pertama</FieldLabel>
                  <Input
                    id="map-year"
                    inputMode="numeric"
                    maxLength={4}
                    className="num w-24"
                    value={year}
                    onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
                  />
                </Field>
              )}
            </div>
            <FieldDescription>
              Klik nomor baris untuk menandai baris transaksi pertama. Baris tanpa tanggal di bawah sebuah transaksi melanjutkan keterangannya; baris judul
              halaman dan total dilewati.
            </FieldDescription>

            <div className="overflow-x-auto rounded-lg border" data-testid="mapping-grid">
              <table className="w-max min-w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="eyebrow sticky left-0 bg-muted/50 px-2 py-2 text-left">Baris</th>
                    {Array.from({ length: current.width }, (_, c) => (
                      <th key={c} className="px-1.5 py-1.5 text-left font-normal">
                        <Select value={roles[c] ?? "none"} onValueChange={(v) => setRole(c, v as Role)}>
                          <SelectTrigger
                            size="sm"
                            className={cn("w-32", roles[c] && roles[c] !== "none" && "border-primary text-primary")}
                            aria-label={`Kolom ${letter(c)}`}
                          >
                            <SelectValue>{roles[c] && roles[c] !== "none" ? ROLE_LABEL[roles[c]] : `Kolom ${letter(c)}`}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r === "none" ? "Tidak dipakai" : ROLE_LABEL[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {current.rows.map((row, i) => {
                    const n = i + 1;
                    return (
                      <tr
                        key={n}
                        className={cn(
                          "border-t",
                          n < firstRow - 1 && "text-muted-foreground",
                          n === firstRow - 1 && "bg-muted/40 font-medium",
                          n === firstRow && "bg-primary-subtle",
                        )}
                        data-testid="mapping-row"
                      >
                        <td className="sticky left-0 bg-card px-2 py-1">
                          <button type="button" className="num drill" aria-label={`Mulai dari baris ${n}`} onClick={() => setFirstRow(n)}>
                            {n}
                          </button>
                        </td>
                        {Array.from({ length: current.width }, (_, c) => (
                          <td key={c} className={cn("max-w-64 truncate px-2 py-1", roles[c] && roles[c] !== "none" && n >= firstRow && "text-foreground")}>
                            {row[c] ?? ""}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {current.totalRows > current.rows.length && (
              <p className="text-xs text-muted-foreground">
                Ditampilkan {current.rows.length} dari {current.totalRows} baris; semua baris dibaca.
              </p>
            )}

            <div className="space-y-2" data-testid="mapping-preview">
              <div className="eyebrow">Lima baris pertama dengan pemetaan ini</div>
              {!preview ? (
                <p className="text-sm text-muted-foreground">Membaca…</p>
              ) : !preview.ok ? (
                <p role="alert" className="rounded-md bg-review-subtle px-3 py-2 text-sm">
                  {preview.error}
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="eyebrow hidden py-1.5 pr-2 sm:table-cell">Baris</th>
                          <th className="eyebrow py-1.5 pr-2">Tanggal</th>
                          <th className="eyebrow py-1.5 pr-2">Keterangan</th>
                          <th className="eyebrow py-1.5 pr-2 text-right">Mutasi</th>
                          <th className="eyebrow hidden py-1.5 text-right sm:table-cell">Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.data.rows.map((r) => (
                          <tr key={r.row} className="border-b align-top">
                            <td className="num hidden py-1.5 pr-2 text-muted-foreground sm:table-cell">{r.row}</td>
                            <td className="num py-1.5 pr-2 whitespace-nowrap">{formatDate(new Date(`${r.date}T00:00:00Z`))}</td>
                            <td className="py-1.5 pr-2">{r.description}</td>
                            <td className="py-1.5 pr-2 text-right">
                              <Money value={BigInt(r.amount)} />
                            </td>
                            <td className="hidden py-1.5 text-right sm:table-cell">
                              {r.balance === null ? <span className="text-muted-foreground">–</span> : <Money value={BigInt(r.balance)} />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {preview.data.total} transaksi terbaca · saldo awal <Money value={BigInt(preview.data.opening)} /> · mutasi keluar tampil dalam kurung.
                    {preview.data.notes.map((n) => ` ${n}`)}
                  </p>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={pending || !preview?.ok} onClick={readAll}>
                {pending ? <Loader2 className="animate-spin" /> : null} Baca semua baris
              </Button>
              <Button variant="ghost" disabled={pending} onClick={onCancel}>
                Batal
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
