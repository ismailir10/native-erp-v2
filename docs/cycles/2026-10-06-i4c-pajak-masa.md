# I4c — Pajak masa: PPN, PPh 21 (TER) and Unifikasi

## Context
ADR 0014 puts the tax pack first among the report packs. Its rule: "It is called a tax pack only once PPh 21 TER and Unifikasi are in
scope." Buku already has the yearly part (Pajak Badan: rekonsiliasi fiskal, PPh 29, deferred tax). Every month a firm also checks,
per client:
- PPN: keluaran minus masukan, kurang or lebih bayar, paid by the end of the next month;
- PPh 21: what payroll withheld, and whether it matches TER;
- Unifikasi (PPh 23, 4(2), 22): which payments were withheld, so the bukti potong can be made in Coretax;
- whether last month's tax was paid by its due date.

Buku already holds every input:
- the GL (2130, 1150, 2140, 2141, 2145);
- bank lines with their tax tag and withholding (`whtKind`, `whtAmount`) and the contact with NPWP;
- the employee census (PSAK 24), with each employee's monthly wage.

Stage: **Laporan**. Scope decision taken under "get them done" (2026-10-06): PPh 21 TER and Unifikasi are in scope as a monthly
check and worksheet. Buku prepares, the firm submits in Coretax (ADR 0014: Buku is not a PJAP).

## Spec
- [x] **TER (PP 58/2023, PMK 168/2023)**: `lib/tax/ter.ts` holds the three monthly tables, exactly as the Lampiran:
  - A: TK/0, TK/1, K/0, 44 brackets;
  - B: TK/2, TK/3, K/1, K/2, 40 brackets;
  - C: K/3, 41 brackets.

  Rates are kept in hundredths of a percent. PPh 21 for a month is the gross times the rate, rounded down to whole Rupiah.
  December is not TER (the year is recomputed under Pasal 17), so the check says so and compares nothing in December.
- [x] **Employee PTKP status**: an optional `ptkpStatus` on Employee (TK/0 … K/3):
  - set in the employee form;
  - read from an optional *PTKP* column in the census file.

  Unset means the employee is left out of the TER check, and the check counts them.
- [x] **`masaReport(db, {clientId, entityId, year, month})`**, deterministic and read at request time:
  1. **One row per tax**:
     - **PPN**: keluaran (credits on 2130 in the month) and masukan (debits on 1150) give the masa's kurang or lebih bayar, due by
       the end of the next month.
     - **PPh 21 (2140), PPh 23 (2141), PPh lainnya (2145: 4(2), 22, 26)**: terutang is the credits in the month, due by the 15th of
       the next month.

     For each tax:
     - the previous masa's amount, against the bank payments filed to that account in this month up to the due date;
     - status *Lolos*, or *Perlu dicek* with the shortfall or the late date;
     - the account's month-end balance;
     - any part of that balance older than this masa.
  2. **PPh 21 paid but nothing withheld**: when PPh 21 was remitted but no PPh 21 was booked as terutang this month or last, it is
     flagged. Payroll was likely booked net to salary expense.
  3. **Bukti potong (Unifikasi)**:
     - lines where this company withheld from a payment (bank OUT with `whtKind`): date, contact and NPWP, description, kind, cash
       paid, withheld, and gross (cash + withheld);
     - lines where a customer withheld from a receipt (bank IN): the bukti potong to ask the customer for.
  4. **PPh 21 TER check** (January–November): each employee active in the month with a PTKP status:
     - wage, category, rate, PPh 21 estimate;
     - the total against PPh 21 terutang in the GL;
     - *Lolos* within 10 %, else *Perlu dicek*.

     The census wage is the PSAK 24 *upah*, not the full gross, so the sheet calls it an estimate.
- [x] **Page *Pajak Masa*** at `/clients/[id]/tax/masa`:
  - under "3 · Laporan" next to Pajak Badan;
  - one company in Rupiah (others refused in Bahasa, as Pajak Badan);
  - NextStep names the first problem;
  - problems first;
  - every amount links to the account's Buku Besar for the month.
- [x] **Excel *Kertas kerja pajak masa***: `GET /clients/[id]/tax/masa/export?entity&period`, built from the same report:
  - sheets *Ringkasan*, *Bukti Potong* and *PPh 21 TER*;
  - logged as `REPORT_EXPORT` ("Kertas kerja pajak masa").

**Non-goals:**
- e-Faktur or e-Bupot XML for Coretax import;
- SPT Masa forms;
- PPh 21 December (Pasal 17) and the 1721-A1;
- PPh 26 rates;
- PP 55 final 0,5 % monthly (Pajak Badan already covers the year);
- holidays shifting a due date (the sheet says "hari kerja berikutnya").

**Gate-reopeners:** one migration (an enum + a nullable column on Employee), no new dependency.

**Assumptions:**
1. Payments count toward the account they are classified to (2130, 2140, 2141, 2145), which is the existing classification rule.
2. The previous masa's amount is what was booked for it, not the balance, so an old opening balance never hides a missed month. The
   older part of the balance is shown on its own.
3. TER tables cross-checked against two independent published implementations (all 125 brackets identical).

## Tasks
- [x] T1 `lib/tax/ter.ts` + unit tests (bracket edges, categories, worked examples). Accept: tests pass.
- [x] T2 Employee `ptkpStatus`: migration, census column, form, view. Accept: DB test for census import with and without the column.
- [x] T3 `lib/tax/masa-report.ts` `masaReport` + DB tests:
  - PPN paid on time, and paid short;
  - PPh 21 paid with nothing booked;
  - a payer withholding listed with its contact;
  - the TER check.

  Accept: tests pass, and the demo's August reads correctly.
- [x] T4 Page, sidebar, Excel route, `REPORT_EXPORT`, e2e (page renders, download opens). Accept: e2e in CI.
- [x] T5 Gates. Accept: lint, typecheck, test, build and verify:books pass.

## Implementation
- Plan: T1–T5 sequential, inline.
- T1: `lib/tax/ter.ts`:
  - `TER_TABLES` A/B/C, generated from one published implementation and compared bracket by bracket with a second (all 125 equal);
  - `TER_CATEGORY`, `parsePtkp`, `terRate`, `pph21Ter` (rounded down), `formatTerRate`;
  - `tests/unit/tax-ter.test.ts`;
  - accounting-rules 5j.
- T2: `PtkpStatus` enum and `Employee.ptkpStatus` (migration `20261006150000_employee_ptkp`):
  - the census reads an optional *PTKP* / *Status PTKP* column; an import without it leaves the stored status alone;
  - the employee form has a *Status PTKP* select;
  - `tests/db/benefits-census.test.ts` (+1).
- T3: `lib/tax/masa-report.ts`:
  - `masaReport` reads the year's lines on 2130, 1150, 2140, 2141 and 2145.
    - A payment is a debit in an entry that credits a bank account, so ledger-file sources count as well as statements.
    - What a masa owes is its credits net of non-payment debits; openings are left out.
    - PPN: keluaran − masukan, with lebih bayar carried from January of the previous masa's year.
    - Payments in the window after the masa before fell due, up to this one's due date, pay the previous masa.
    - Later payments in the month first cover a shortfall (*terlambat*) and the rest counts as paid ahead.
    - `other` is the month-end balance that neither this masa nor the previous shortfall explains.
  - `rowNotes`, `terNote` and `ppnLine` give the Bahasa sentences.
  - The TER check takes employees active in the month with a PTKP status and passes within 10 % of the booked PPh 21.
  - Spec deviation: no "implied rate" on bukti potong lines. Gross includes PPN for most services, so a rate from it would mislead.
  - Test: `tests/db/masa-report.test.ts`.
- T4: the page `app/(app)/clients/[id]/tax/masa/page.tsx`:
  - problems first, NextStep naming the first problem;
  - amounts link to the account's Buku Besar;
  - columns hidden on phones.

  Around it:
  - Sidebar *Pajak Masa* under "3 · Laporan". The most specific menu item is now the active one, so `/tax/masa` does not also light
    Pajak Badan.
  - `lib/tax/masa-workbook.ts` and the route `.../tax/masa/export`, logged as `REPORT_EXPORT` "Kertas kerja pajak masa".
  - E2e: `qa-tax-split.spec.ts` checks the page and the download on its PPN and PPh 23 case. `qa-access.spec.ts` covers the route and
    the export across firms.
## Verification
- Demo, August 2026 (`now` = 6 October):
  - **PT Ayam**:
    - PPN *Perlu dicek*: July owed Rp 80.225.676 and Rp 37.475.676 was not paid by 31 Aug. The synthetic payments are random amounts,
      not the masa's keluaran − masukan.
    - PPh 21 *Perlu dicek*: remitted with nothing withheld. The demo books payroll net to 6100 and draws down the opening 2140.
  - **PT Jasa Kreatif**: PPN *Perlu dicek* for the same reason.
  - **CV Sinar Retail** (not PKP): all *Lolos* / nihil.
  - No demo census, so the TER card asks for one.

  The findings are true of the synthetic data, which has no masa discipline. The demo scenario is left unchanged, because shifting its
  random sequence would move every amount.
- End of cycle: `npm run lint` exit 0; `npm run typecheck` exit 0; `npm test`: Test Files 172 passed (172), Tests 1135 passed (1135);
  `npm run build` exit 0 (routes `/clients/[id]/tax/masa`, `/tax/masa/export`); `npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo
  cocok dengan ground truth.` E2e in CI.
## Ship Notes
- Migration `20261006150000_employee_ptkp`: a new enum and a nullable column, so no backfill is needed. New routes: `/clients/[id]/tax/masa`
  and `/clients/[id]/tax/masa/export`. Rollback: revert the code; the column can stay.
