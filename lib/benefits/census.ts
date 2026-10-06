import type { Db } from "@/lib/db";
import type { PtkpStatus, Sex } from "@/lib/generated/prisma/enums";
import { parsePtkp } from "@/lib/tax/ter";
import { LedgerError } from "@/lib/ledger/post";
import { ParseError } from "@/lib/import/types";
import { cellDate, cellText, readSheets } from "@/lib/ledger-import/read";
import type { RawCell, RawSheet } from "@/lib/ledger-import/types";
import { dateOnly, percentToBp } from "@/lib/format";
import { MoneyError, parseMinor, parseMoney } from "@/lib/money";

/**
 * The PSAK 24 inputs an accountant keeps (accounting-rules 5g): the entity's census (imported from Excel / CSV or typed), the firm's
 * mortality table (uploaded — Buku ships none it can't verify) and the entity's assumptions. Nothing here posts.
 */

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// ─── Header detection ─────────────────────────────────────────────────────────

type Key = "name" | "no" | "sex" | "birth" | "hire" | "wage" | "basic" | "allowance" | "left" | "ptkp";
const HEADERS: Record<Key, RegExp> = {
  name: /^(nama|nama karyawan|nama pegawai|nama lengkap|name|employee name)$/,
  no: /^(nik|nip|no\.?|nomor|id|no\.? (karyawan|pegawai|induk)|nomor (karyawan|pegawai|induk)|employee (no\.?|id|number))$/,
  sex: /^(jenis kelamin|jk|l\/p|kelamin|gender|sex)$/,
  birth: /^(tanggal lahir|tgl\.? lahir|tgl lahir|date of birth|dob|birth date)$/,
  hire: /^(tanggal masuk|tgl\.? masuk|tanggal mulai kerja|tanggal bergabung|mulai kerja|tmt|hire date|join date|date joined)$/,
  wage: /^(upah|upah bulanan|total upah|total gaji|gaji \+ tunjangan tetap|gaji dan tunjangan tetap|salary|monthly salary|wage)$/,
  basic: /^(gaji|gaji pokok|basic salary)$/,
  allowance: /^(tunjangan tetap|fixed allowance)$/,
  left: /^(tanggal keluar|tgl\.? keluar|tanggal berhenti|resign date|termination date|exit date)$/,
  ptkp: /^(ptkp|status ptkp|status pajak|status pph 21|tax status)$/,
};

function findHeader(sheets: RawSheet[], required: string[], headers: Record<string, RegExp>) {
  for (const sheet of sheets) {
    for (let r = 0; r < Math.min(sheet.rows.length, 30); r++) {
      const cols: Partial<Record<string, number>> = {};
      (sheet.rows[r] ?? []).forEach((c, i) => {
        const t = norm(cellText(c));
        const key = Object.keys(headers).find((k) => cols[k] === undefined && headers[k].test(t));
        if (key) cols[key] = i;
      });
      if (required.every((k) => cols[k] !== undefined)) return { sheet, row: r, cols };
    }
  }
  return null;
}

const SEX: Record<string, Sex> = { l: "MALE", "laki-laki": "MALE", "laki laki": "MALE", pria: "MALE", m: "MALE", male: "MALE", p: "FEMALE", perempuan: "FEMALE", wanita: "FEMALE", f: "FEMALE", female: "FEMALE" };

/** `ptkpStatus` is undefined when the file has no PTKP column, so an import never clears a status typed in Buku. */
export type CensusRow = { line: number; name: string; employeeNo: string | null; sex: Sex; birthDate: Date; hireDate: Date; wage: bigint; leftOn: Date | null; ptkpStatus?: PtkpStatus | null };

/** Rows of a census file; every unreadable row is named, and none is imported while any is. */
export async function readCensus(fileName: string, data: Buffer, currency: string): Promise<CensusRow[]> {
  const sheets = await readSheets(fileName, data);
  const h = findHeader(sheets, ["name", "sex", "birth", "hire"], HEADERS);
  if (!h || (h.cols.wage === undefined && h.cols.basic === undefined)) {
    throw new ParseError("Kolom sensus tidak ditemukan. Perlu kolom: Nama, Jenis Kelamin (L/P), Tanggal Lahir, Tanggal Masuk, dan Upah (atau Gaji Pokok + Tunjangan Tetap).");
  }
  const at = (row: RawCell[], k: Key) => (h.cols[k] === undefined ? undefined : row[h.cols[k]!]);
  const money = (c: RawCell | undefined) => (c === null || c === undefined || cellText(c) === "" ? 0n : typeof c === "number" ? parseMinor(c, currency) : parseMoney(cellText(c), currency));
  const out: CensusRow[] = [];
  const errors: string[] = [];
  for (let r = h.row + 1; r < h.sheet.rows.length; r++) {
    const row = h.sheet.rows[r] ?? [];
    const name = cellText(at(row, "name"));
    if (!name) continue;
    const line = r + 1;
    const fail = (why: string) => errors.push(`Baris ${line} (${name}): ${why}`);
    const sex = SEX[norm(cellText(at(row, "sex")))];
    const birthDate = cellDate(at(row, "birth"));
    const hireDate = cellDate(at(row, "hire"));
    const leftText = cellText(at(row, "left"));
    const leftOn = leftText ? cellDate(at(row, "left")) : null;
    const ptkpText = cellText(at(row, "ptkp"));
    const ptkpStatus = h.cols.ptkp === undefined ? undefined : ptkpText ? parsePtkp(ptkpText) : null;
    let wage = 0n;
    try {
      wage = h.cols.wage !== undefined ? money(at(row, "wage")) : money(at(row, "basic")) + money(at(row, "allowance"));
    } catch (e) {
      if (!(e instanceof MoneyError)) throw e;
      fail("upah tidak bisa dibaca");
      continue;
    }
    if (!sex) fail("jenis kelamin harus L atau P");
    else if (!birthDate) fail("tanggal lahir tidak dikenali (pakai dd/mm/yyyy)");
    else if (!hireDate) fail("tanggal masuk tidak dikenali (pakai dd/mm/yyyy)");
    else if (+hireDate <= +birthDate) fail("tanggal masuk sebelum tanggal lahir");
    else if (leftText && !leftOn) fail("tanggal keluar tidak dikenali");
    else if (leftOn && +leftOn < +hireDate) fail("tanggal keluar sebelum tanggal masuk");
    else if (wage <= 0n) fail("upah harus lebih dari nol");
    else if (ptkpText && !ptkpStatus) fail("status PTKP tidak dikenali (TK/0 sampai K/3)");
    else out.push({ line, name, employeeNo: cellText(at(row, "no")) || null, sex, birthDate, hireDate, wage, leftOn, ptkpStatus });
  }
  if (errors.length) throw new ParseError(`${errors.length} baris sensus tidak bisa dibaca; tidak ada yang diimpor. ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? "; …" : ""}`);
  if (!out.length) throw new ParseError("File sensus tidak berisi karyawan.");
  return out;
}

/** Import a census: employees matched by number (else name + birth date) are updated, the rest added. */
export async function importCensus(db: Db, input: { clientId: string; entityId: string; fileName: string; data: Buffer }) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new LedgerError("Pilih entitas.");
  const rows = await readCensus(input.fileName, input.data, entity.functionalCurrency);
  const numbers = rows.flatMap((r) => (r.employeeNo ? [r.employeeNo] : []));
  const twice = numbers.find((n, i) => numbers.indexOf(n) !== i);
  if (twice) throw new ParseError(`Nomor karyawan ${twice} muncul dua kali di file.`);
  // Without a number an employee is known by name + birth date: the same pair twice would count one person twice.
  const keys = rows.filter((r) => !r.employeeNo).map((r) => `${norm(r.name)}|${+r.birthDate}`);
  const same = rows.filter((r) => !r.employeeNo).find((_, i) => keys.indexOf(keys[i]) !== i);
  if (same) throw new ParseError(`${same.name} (lahir ${same.birthDate.toISOString().slice(0, 10)}) muncul dua kali di file tanpa nomor karyawan. Beri nomor karyawan atau hapus baris gandanya.`);
  return db.$transaction(async (tx) => {
    const existing = await tx.employee.findMany({ where: { entityId: entity.id } });
    let added = 0;
    let updated = 0;
    for (const r of rows) {
      const match = existing.find((e) => (r.employeeNo ? e.employeeNo === r.employeeNo : norm(e.name) === norm(r.name) && +e.birthDate === +r.birthDate));
      const data = { name: r.name, employeeNo: r.employeeNo, sex: r.sex, birthDate: r.birthDate, hireDate: r.hireDate, wage: r.wage, leftOn: r.leftOn, ptkpStatus: r.ptkpStatus };
      if (match) {
        await tx.employee.update({ where: { id: match.id }, data });
        updated++;
      } else {
        existing.push(await tx.employee.create({ data: { ...data, firmId: entity.firmId, clientId: input.clientId, entityId: entity.id } }));
        added++;
      }
    }
    return { added, updated };
  });
}

export type EmployeeInput = { clientId: string; entityId: string; employeeId?: string | null; name: string; employeeNo?: string | null; sex: Sex; birthDate: string; hireDate: string; wage: string; leftOn?: string | null; ptkpStatus?: string | null };

const day = (s: string, what: string) => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? dateOnly(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  if (!d || d.getUTCMonth() + 1 !== Number(m![2])) throw new LedgerError(`${what} tidak valid.`);
  return d;
};

export async function saveEmployee(db: Db, input: EmployeeInput) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new LedgerError("Pilih entitas.");
  const name = input.name.trim();
  if (!name) throw new LedgerError("Isi nama karyawan.");
  if (input.sex !== "MALE" && input.sex !== "FEMALE") throw new LedgerError("Pilih jenis kelamin.");
  const birthDate = day(input.birthDate, "Tanggal lahir");
  const hireDate = day(input.hireDate, "Tanggal masuk");
  if (+hireDate <= +birthDate) throw new LedgerError("Tanggal masuk harus setelah tanggal lahir.");
  const leftOn = input.leftOn ? day(input.leftOn, "Tanggal keluar") : null;
  if (leftOn && +leftOn < +hireDate) throw new LedgerError("Tanggal keluar tidak boleh sebelum tanggal masuk.");
  const wage = parseMoney(input.wage, entity.functionalCurrency);
  if (wage <= 0n) throw new LedgerError("Upah harus lebih dari nol.");
  const employeeNo = input.employeeNo?.trim() || null;
  if (employeeNo && (await db.employee.findFirst({ where: { entityId: entity.id, employeeNo, NOT: input.employeeId ? { id: input.employeeId } : undefined } }))) throw new LedgerError(`Nomor karyawan ${employeeNo} sudah dipakai.`);
  const ptkpStatus = input.ptkpStatus ? parsePtkp(input.ptkpStatus) : null;
  if (input.ptkpStatus && !ptkpStatus) throw new LedgerError("Status PTKP tidak dikenali (TK/0 sampai K/3).");
  const data = { name, employeeNo, sex: input.sex, birthDate, hireDate, wage, leftOn, ptkpStatus };
  if (input.employeeId) {
    const e = await db.employee.findFirst({ where: { id: input.employeeId, entityId: entity.id } });
    if (!e) throw new LedgerError("Karyawan tidak ditemukan.");
    return db.employee.update({ where: { id: e.id }, data });
  }
  return db.employee.create({ data: { ...data, firmId: entity.firmId, clientId: input.clientId, entityId: entity.id } });
}

export async function deleteEmployee(db: Db, input: { clientId: string; employeeId: string }) {
  const e = await db.employee.findFirst({ where: { id: input.employeeId, clientId: input.clientId } });
  if (!e) throw new LedgerError("Karyawan tidak ditemukan.");
  await db.employee.delete({ where: { id: e.id } });
}

// ─── Mortality table ──────────────────────────────────────────────────────────

const MORTALITY: Record<string, RegExp> = {
  age: /^(usia|umur|age|x|usia \(x\))$/,
  male: /^(pria|laki-laki|laki laki|male|qx pria|qx laki-laki|qx male|l|m)$/,
  female: /^(wanita|perempuan|female|qx wanita|qx perempuan|qx female|p|f)$/,
};
const QX_SCALE = 1_000_000_000;

function qx(c: RawCell | undefined): number | null {
  const v = typeof c === "number" ? c : Number(cellText(c).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) && v >= 0 && v <= 1 && cellText(c) !== "" ? Math.round(v * QX_SCALE) : null;
}

/** Read a mortality table: age, male qx and female qx, every age from 0 without a gap, at least 0–99. */
export async function readMortality(fileName: string, data: Buffer): Promise<{ male: number[]; female: number[] }> {
  const sheets = await readSheets(fileName, data);
  const h = findHeader(sheets, ["age", "male", "female"], MORTALITY);
  if (!h) throw new ParseError("Kolom tabel mortalita tidak ditemukan. Perlu kolom: Usia, Pria (qx), Wanita (qx).");
  const male: number[] = [];
  const female: number[] = [];
  for (let r = h.row + 1; r < h.sheet.rows.length; r++) {
    const row = h.sheet.rows[r] ?? [];
    const ageText = cellText(row[h.cols.age!]);
    if (!ageText) continue;
    const age = Number(ageText);
    if (!Number.isInteger(age) || age !== male.length) throw new ParseError(`Baris ${r + 1}: usia ${ageText} tidak berurutan (diharapkan ${male.length}).`);
    const m = qx(row[h.cols.male!]);
    const f = qx(row[h.cols.female!]);
    if (m === null || f === null) throw new ParseError(`Baris ${r + 1}: qx usia ${age} harus angka 0–1.`);
    male.push(m);
    female.push(f);
  }
  if (male.length < 100) throw new ParseError(`Tabel mortalita harus berisi usia 0 sampai sedikitnya 99 (terbaca ${male.length} usia).`);
  return { male, female };
}

export async function uploadMortality(db: Db, input: { firmId: string; name: string; fileName: string; data: Buffer }) {
  const name = input.name.trim();
  if (!name) throw new LedgerError("Isi nama tabel mortalita (mis. TMI IV 2019).");
  const t = await readMortality(input.fileName, input.data);
  return db.mortalityTable.upsert({ where: { firmId_name: { firmId: input.firmId, name } }, update: t, create: { firmId: input.firmId, name, ...t } });
}

/** qx lookup (ages past the table use its last age). */
export const qxOf = (t: { male: number[]; female: number[] }) => (age: number, sex: Sex) => {
  const rates = sex === "MALE" ? t.male : t.female;
  return rates[Math.max(0, Math.min(rates.length - 1, age))] / QX_SCALE;
};

// ─── Assumptions ──────────────────────────────────────────────────────────────

export type BenefitSettingInput = { clientId: string; entityId: string; mortalityTableId: string | null; discount: string; salary: string; retirementAge: number; disability: string; resign: string; resignFlatUntil: number; resignZeroAge: number };

export async function saveBenefitSetting(db: Db, input: BenefitSettingInput) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new LedgerError("Pilih entitas.");
  if (input.mortalityTableId && !(await db.mortalityTable.findFirst({ where: { id: input.mortalityTableId, firmId: entity.firmId } }))) throw new LedgerError("Tabel mortalita tidak ditemukan.");
  const rate = (text: string, label: string, max: number) => {
    const bp = percentToBp(text);
    if (bp === null || bp > max) throw new LedgerError(`${label}: isi persen 0–${max / 100}.`);
    return bp;
  };
  const discountBp = rate(input.discount, "Tingkat diskonto", 3_000);
  const salaryBp = rate(input.salary, "Kenaikan gaji", 3_000);
  const disabilityBp = rate(input.disability, "Tingkat cacat (% dari mortalita)", 10_000);
  const resignBp = rate(input.resign, "Tingkat pengunduran diri", 10_000);
  const age = (v: number, label: string, lo: number, hi: number) => {
    if (!(Number.isInteger(v) && v >= lo && v <= hi)) throw new LedgerError(`${label}: ${lo}–${hi} tahun.`);
    return v;
  };
  const retirementAge = age(input.retirementAge, "Usia pensiun normal", 45, 70);
  const resignZeroAge = age(input.resignZeroAge, "Usia pengunduran diri 0%", 15, retirementAge);
  const resignFlatUntil = age(input.resignFlatUntil, "Usia pengunduran diri mulai turun", 15, resignZeroAge);
  const data = { mortalityTableId: input.mortalityTableId, discountBp, salaryBp, retirementAge, disabilityBp, resignBp, resignFlatUntil, resignZeroAge };
  return db.benefitSetting.upsert({ where: { entityId: entity.id }, update: data, create: { ...data, firmId: entity.firmId, entityId: entity.id } });
}
