"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SimpleSelect } from "@/components/app/simple-select";
import { Money } from "@/components/app/money";
import { StatusPill } from "@/components/app/status";
import { deleteEmployeeAction, importCensusAction, postBenefitsAction, saveBenefitSettingAction, saveEmployeeAction, uploadMortalityAction } from "@/app/actions";
import { formatMoney } from "@/lib/money";
import type { BenefitEntityView } from "@/lib/benefits/view";
import { PTKP_LABEL, PTKP_STATUSES, type PtkpStatus } from "@/lib/tax/ter";

type Result = { ok: true } | { ok: false; error: string };
type EmployeeForm = { employeeId: string | null; name: string; employeeNo: string; ptkpStatus: string; sex: "MALE" | "FEMALE"; birthDate: string; hireDate: string; wage: string; leftOn: string };

/** PSAK 219 of the scope's companies (accounting-rules 5g): assumptions, census, valuation and its journal. */
export function EmployeeBenefits(props: { clientId: string; year: number; month: number; periodKey: string; periodLabel: string; tables: { id: string; name: string }[]; entities: BenefitEntityView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [forms, setForms] = useState(() => Object.fromEntries(props.entities.map((e) => [e.entity.id, e.setting])));
  const [employee, setEmployee] = useState<{ entityId: string; form: EmployeeForm } | null>(null);
  const [table, setTable] = useState<{ name: string; file: File | null } | null>(null);
  const censusInput = useRef<HTMLInputElement>(null);
  const [censusEntity, setCensusEntity] = useState<string>("");

  const run = async (action: () => Promise<Result>, done: string, after?: () => void) => {
    setBusy(true);
    const r = await action();
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(done);
    after?.();
    router.refresh();
  };
  const upload = (fields: Record<string, string | File>) => {
    const fd = new FormData();
    fd.set("clientId", props.clientId);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  return (
    <div className="space-y-6">
      {props.entities.length === 0 && <Card><CardContent className="pt-6 text-sm text-muted-foreground">Imbalan kerja PSAK 219 hanya untuk badan usaha; cakupan ini tidak berisi badan usaha.</CardContent></Card>}

      {props.entities.map((ev) => {
        const cur = ev.entity.currency;
        // An entity the scope switched to after this component mounted starts from its saved setting.
        const f = forms[ev.entity.id] ?? ev.setting;
        const set = (patch: Partial<typeof f>) => setForms({ ...forms, [ev.entity.id]: { ...f, ...patch } });
        const dirty = JSON.stringify(f) !== JSON.stringify(ev.setting) || !ev.setting.saved;
        const v = ev.valuation;
        const pctField = (key: "discount" | "salary" | "disability" | "resign", label: string, hint?: string) => (
          <Field>
            <FieldLabel htmlFor={`eb-${key}-${ev.entity.id}`}>{label}</FieldLabel>
            <div className="flex items-center gap-1">
              <Input id={`eb-${key}-${ev.entity.id}`} inputMode="decimal" className="num w-24 text-right" value={f[key]} onChange={(e) => set({ [key]: e.target.value })} />
              <span className="text-muted-foreground">%</span>
            </div>
            {hint && <FieldDescription>{hint}</FieldDescription>}
          </Field>
        );
        const ageField = (key: "retirementAge" | "resignFlatUntil" | "resignZeroAge", label: string) => (
          <Field>
            <FieldLabel htmlFor={`eb-${key}-${ev.entity.id}`}>{label}</FieldLabel>
            <div>
              <Input id={`eb-${key}-${ev.entity.id}`} inputMode="numeric" className="num w-24 text-right" value={f[key]} onChange={(e) => set({ [key]: e.target.value.replace(/\D/g, "") })} />
            </div>
          </Field>
        );
        return (
          <div key={ev.entity.id} className="space-y-4" data-testid={`benefits-${ev.entity.shortName}`}>
            <h2 className="text-base font-semibold">{ev.entity.name}</h2>

            <Card>
              <CardHeader>
                <CardTitle>Asumsi aktuaria</CardTitle>
                <CardDescription>Metode Projected Unit Credit; manfaat PP 35/2021 (pensiun 1,75 × pesangon + UPMK; meninggal / cacat 2 × pesangon + UPMK).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="flex flex-wrap items-end gap-3">
                  <Field className="w-72">
                    <FieldLabel>Tabel mortalita</FieldLabel>
                    <SimpleSelect label="Tabel mortalita" value={f.mortalityTableId} onChange={(id) => set({ mortalityTableId: id })} options={[{ value: "", label: props.tables.length ? "Pilih tabel" : "Belum ada tabel" }, ...props.tables.map((t) => ({ value: t.id, label: t.name }))]} />
                  </Field>
                  <Button variant="outline" size="sm" onClick={() => setTable({ name: "TMI IV (2019)", file: null })}><Upload /> Unggah tabel mortalita</Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {pctField("discount", "Tingkat diskonto per tahun", "Imbal hasil obligasi pemerintah bertenor serupa")}
                  {pctField("salary", "Kenaikan gaji per tahun")}
                  {ageField("retirementAge", "Usia pensiun normal")}
                  {pctField("disability", "Tingkat cacat", "% dari tingkat mortalita")}
                  {pctField("resign", "Tingkat pengunduran diri per tahun")}
                  {ageField("resignFlatUntil", "Tetap sampai usia")}
                  {ageField("resignZeroAge", "Turun ke 0% pada usia")}
                </div>
                {dirty && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !f.discount || !f.salary}
                    onClick={() => run(() => saveBenefitSettingAction({ clientId: props.clientId, entityId: ev.entity.id, mortalityTableId: f.mortalityTableId || null, discount: f.discount, salary: f.salary, retirementAge: Number(f.retirementAge), disability: f.disability, resign: f.resign, resignFlatUntil: Number(f.resignFlatUntil), resignZeroAge: Number(f.resignZeroAge) }), "Asumsi disimpan")}
                  >
                    Simpan asumsi
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <CardTitle>Sensus karyawan</CardTitle>
                  <CardDescription>Upah = gaji pokok + tunjangan tetap per bulan. Impor dari Excel / CSV: karyawan dengan nomor sama diperbarui, sisanya ditambahkan.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => { setCensusEntity(ev.entity.id); censusInput.current?.click(); }}><Upload /> Impor sensus</Button>
                  <Button variant="outline" size="sm" onClick={() => setEmployee({ entityId: ev.entity.id, form: { employeeId: null, name: "", employeeNo: "", ptkpStatus: "", sex: "MALE", birthDate: "", hireDate: "", wage: "", leftOn: "" } })}><Plus /> Karyawan</Button>
                </div>
              </CardHeader>
              <CardContent className="px-0">
                {ev.employees.length === 0 ? (
                  <p className="px-6 text-sm text-muted-foreground">Belum ada karyawan.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Karyawan</TableHead>
                        <TableHead className="hidden text-right md:table-cell">Usia</TableHead>
                        <TableHead className="hidden text-right md:table-cell">Masa kerja</TableHead>
                        <TableHead className="hidden text-right sm:table-cell">Upah</TableHead>
                        <TableHead className="pr-6 text-right">Liabilitas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ev.employees.map((x) => (
                        <TableRow key={x.id} data-testid={`employee-${x.name}`}>
                          <TableCell className="pl-6 whitespace-normal">
                            <button type="button" className="text-left font-medium hover:text-primary" onClick={() => setEmployee({ entityId: ev.entity.id, form: { employeeId: x.id, name: x.name, employeeNo: x.employeeNo, ptkpStatus: x.ptkpStatus, sex: x.sex, birthDate: x.birthDate, hireDate: x.hireDate, wage: formatMoney(BigInt(x.wage), cur, { bare: true }), leftOn: x.leftOn } })}>{x.name}</button>
                            <div className="text-xs text-muted-foreground">
                              {x.employeeNo ? `${x.employeeNo} · ` : ""}{x.sex === "MALE" ? "L" : "P"}{x.ptkpStatus ? ` · ${PTKP_LABEL[x.ptkpStatus as PtkpStatus]}` : ""} · lahir {x.birth} · masuk {x.hire}{x.left ? ` · keluar ${x.left}` : ""}{x.newHire ? " · baru tahun ini" : ""}
                            </div>
                          </TableCell>
                          <TableCell className="num hidden text-right md:table-cell">{x.age ?? "–"}</TableCell>
                          <TableCell className="num hidden text-right md:table-cell">{x.service ?? "–"}</TableCell>
                          <TableCell className="hidden text-right sm:table-cell"><Money value={BigInt(x.wage)} currency={cur} /></TableCell>
                          <TableCell className="pr-6 text-right">{x.dbo === null ? <span className="text-xs text-muted-foreground">{x.left ? "keluar" : "–"}</span> : <Money value={BigInt(x.dbo)} currency={cur} />}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    {!v.blocker && (
                      <TableFooter>
                        <TableRow>
                          <TableCell className="pl-6 font-medium">Liabilitas imbalan kerja</TableCell>
                          <TableCell className="hidden md:table-cell" colSpan={2} />
                          <TableCell className="hidden sm:table-cell" />
                          <TableCell className="pr-6 text-right"><Money strong value={BigInt(v.dbo)} currency={cur} /></TableCell>
                        </TableRow>
                      </TableFooter>
                    )}
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card data-testid={`valuation-${ev.entity.shortName}`}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <CardTitle>Valuasi per {props.periodLabel}</CardTitle>
                  <CardDescription>{v.tableName ? `Tabel mortalita ${v.tableName}. ` : ""}Estimasi untuk kertas kerja; bukan laporan aktuaris berlisensi.</CardDescription>
                </div>
                {!v.blocker && <StatusPill status={v.lines.length ? "REVIEW" : "PASS"} label={v.lines.length ? "Belum dijurnal" : "Sesuai buku besar"} />}
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {v.blocker ? (
                  <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900" data-testid="eb-blocker">{v.blocker}</p>
                ) : (
                  <>
                    <div className="grid gap-x-8 sm:grid-cols-2">
                      <div>
                        {[
                          ["Liabilitas imbalan kerja (DBO)", v.dbo, true],
                          ["Biaya jasa kini tahun depan", v.serviceCost, false],
                          ["Biaya bunga tahun depan", v.interestCost, false],
                          [`Valuasi ${v.opening.at}`, v.opening.dbo, false],
                          [`Beban ${props.year} s.d. ${props.periodLabel} (6105)`, v.expenseTarget, false],
                        ].map(([label, amount, strong]) => (
                          <div key={label as string} className={`flex items-baseline justify-between gap-4 py-1 ${strong ? "font-medium" : ""}`} data-testid={strong ? "eb-dbo" : undefined}>
                            <span>{label as string}</span>
                            <Money strong={strong as boolean} value={BigInt(amount as string)} currency={cur} />
                          </div>
                        ))}
                        <div className="flex items-baseline justify-between gap-4 border-t py-1">
                          <Link href={`/clients/${props.clientId}/ledger/2310?entity=${ev.entity.id}&period=${props.periodKey}`} className="hover:text-primary">Buku besar 2310</Link>
                          <Money value={BigInt(v.ledger.liability)} currency={cur} />
                        </div>
                      </div>
                      {v.sensitivity && (
                        <div className="mt-4 sm:mt-0">
                          <div className="pb-1 text-xs font-medium text-muted-foreground">Sensitivitas DBO</div>
                          {[
                            ["Diskonto +1%", v.sensitivity.discountUp],
                            ["Diskonto −1%", v.sensitivity.discountDown],
                            ["Kenaikan gaji +1%", v.sensitivity.salaryUp],
                            ["Kenaikan gaji −1%", v.sensitivity.salaryDown],
                          ].map(([label, amount]) => (
                            <div key={label} className="flex items-baseline justify-between gap-4 py-1">
                              <span>{label}</span>
                              <Money value={BigInt(amount)} currency={cur} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {v.later ? (
                      <p className="text-muted-foreground">Imbalan kerja sudah dijurnal per {v.later}. Buka bulan itu atau sesudahnya untuk mencatat perubahan.</p>
                    ) : v.lines.length ? (
                      <div className="space-y-2">
                        <div className="max-w-xl rounded-md border">
                          {v.lines.map((l) => (
                            <div key={l.code} className="flex items-baseline justify-between gap-4 border-b px-3 py-1.5 last:border-b-0">
                              <span className="min-w-0">{l.code} {l.name}</span>
                              <span className="num shrink-0">{BigInt(l.amount) > 0n ? "Debit " : "Kredit "}{formatMoney(BigInt(l.amount) < 0n ? -BigInt(l.amount) : BigInt(l.amount), cur, { bare: true })}</span>
                            </div>
                          ))}
                        </div>
                        {v.firstYear && v.lines.some((l) => l.code === "3200") && <p className="text-xs text-muted-foreground">Tahun pertama di Buku: liabilitas per {v.opening.at} yang belum tercatat masuk Saldo Laba (periode lalu).</p>}
                        <Button disabled={busy} onClick={() => run(() => postBenefitsAction({ clientId: props.clientId, entityId: ev.entity.id, year: props.year, month: props.month }), "Jurnal imbalan kerja dicatat")}>
                          Catat jurnal imbalan kerja per {props.periodLabel}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">Liabilitas di buku besar sudah sesuai valuasi.</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        );
      })}

      <input
        ref={censusInput}
        type="file"
        className="hidden"
        accept=".xlsx,.xls,.csv"
        data-testid="census-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          importCensusAction(upload({ entityId: censusEntity || props.entities[0]?.entity.id || "", file })).then((r) => {
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`Sensus diimpor: ${r.added} ditambahkan, ${r.updated} diperbarui`);
            router.refresh();
          });
        }}
      />

      <Dialog open={employee !== null} onOpenChange={(o) => !o && setEmployee(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{employee?.form.employeeId ? "Ubah karyawan" : "Tambah karyawan"}</DialogTitle>
            <DialogDescription>Isi tanggal keluar untuk karyawan yang berhenti; ia tidak lagi dihitung sejak tanggal itu.</DialogDescription>
          </DialogHeader>
          {employee && (() => {
            const e = employee.form;
            const set = (patch: Partial<EmployeeForm>) => setEmployee({ ...employee, form: { ...e, ...patch } });
            return (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field><FieldLabel htmlFor="emp-name">Nama</FieldLabel><Input id="emp-name" value={e.name} onChange={(x) => set({ name: x.target.value })} /></Field>
                <Field><FieldLabel htmlFor="emp-no">Nomor karyawan</FieldLabel><Input id="emp-no" value={e.employeeNo} onChange={(x) => set({ employeeNo: x.target.value })} /></Field>
                <Field><FieldLabel>Jenis kelamin</FieldLabel><SimpleSelect label="Jenis kelamin" value={e.sex} onChange={(x) => set({ sex: x as EmployeeForm["sex"] })} options={[{ value: "MALE", label: "Laki-laki" }, { value: "FEMALE", label: "Perempuan" }]} /></Field>
                <Field><FieldLabel htmlFor="emp-wage">Upah per bulan</FieldLabel><Input id="emp-wage" inputMode="decimal" className="num text-right" value={e.wage} onChange={(x) => set({ wage: x.target.value })} /></Field>
                <Field><FieldLabel htmlFor="emp-birth">Tanggal lahir</FieldLabel><Input id="emp-birth" type="date" value={e.birthDate} onChange={(x) => set({ birthDate: x.target.value })} /></Field>
                <Field><FieldLabel htmlFor="emp-hire">Tanggal masuk</FieldLabel><Input id="emp-hire" type="date" value={e.hireDate} onChange={(x) => set({ hireDate: x.target.value })} /></Field>
                <Field><FieldLabel>Status PTKP (untuk cek PPh 21)</FieldLabel><SimpleSelect label="Status PTKP" value={e.ptkpStatus || "NONE"} onChange={(x) => set({ ptkpStatus: x === "NONE" ? "" : x })} options={[{ value: "NONE", label: "Belum diisi" }, ...PTKP_STATUSES.map((p) => ({ value: p, label: PTKP_LABEL[p] }))]} /></Field>
                <Field><FieldLabel htmlFor="emp-left">Tanggal keluar (opsional)</FieldLabel><Input id="emp-left" type="date" value={e.leftOn} onChange={(x) => set({ leftOn: x.target.value })} /></Field>
              </div>
            );
          })()}
          <DialogFooter>
            {employee?.form.employeeId && (
              <Button variant="ghost" className="mr-auto" disabled={busy} onClick={() => employee && run(() => deleteEmployeeAction(props.clientId, employee.form.employeeId!), "Karyawan dihapus", () => setEmployee(null))}>Hapus</Button>
            )}
            <Button variant="outline" onClick={() => setEmployee(null)}>Batal</Button>
            <Button
              disabled={busy || !employee?.form.name.trim() || !employee?.form.birthDate || !employee?.form.hireDate || !employee?.form.wage}
              onClick={() => employee && run(() => saveEmployeeAction({ clientId: props.clientId, entityId: employee.entityId, ...employee.form, leftOn: employee.form.leftOn || null, ptkpStatus: employee.form.ptkpStatus || null }), "Karyawan disimpan", () => setEmployee(null))}
            >
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={table !== null} onOpenChange={(o) => !o && setTable(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unggah tabel mortalita</DialogTitle>
            <DialogDescription>Excel / CSV dengan kolom Usia, Pria, Wanita (qx 0–1), usia 0 sampai sedikitnya 99. Dipakai semua klien kantor; nama yang sama diganti.</DialogDescription>
          </DialogHeader>
          {table && (
            <div className="grid gap-4">
              <Field><FieldLabel htmlFor="mt-name">Nama tabel</FieldLabel><Input id="mt-name" value={table.name} onChange={(e) => setTable({ ...table, name: e.target.value })} /></Field>
              <Field><FieldLabel htmlFor="mt-file">File</FieldLabel><Input id="mt-file" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setTable({ ...table, file: e.target.files?.[0] ?? null })} /></Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTable(null)}>Batal</Button>
            <Button disabled={busy || !table?.file || !table?.name.trim()} onClick={() => table?.file && run(() => uploadMortalityAction(upload({ name: table.name, file: table.file! })), `Tabel ${table.name} diunggah`, () => setTable(null))}>Unggah</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
