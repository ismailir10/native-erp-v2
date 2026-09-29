# Review follow-ups for the Balancio-gap cycles (#54–#57)

## Context
Automated review comments on #54 (tax pack gaps), #55 (CKPN), #56 (leases) and #57 (employee benefits) arrived after they had merged.
Each finding was checked; all were real and are fixed here in one follow-up (same scope as the approved cycles; one schema change, flagged).

## Spec
- [x] Tax workpaper: the Jurnal sheet shows only postings dated by the selected month, with a row naming a later posting; the Kredit Pajak
      sheet names each statement credit's source file and row.
- [x] Tax pack: an accepted or suggested timing-difference category whose account turns to income (a provision released) becomes a
      negative correction, so what was added back before isn't taxed again.
- [x] Ledger import: an allowance account is always proposed to 1135, created from the template on posting when the client predates it —
      never netted into 1130.
- [x] CKPN settings are versioned by effective month (saved for the page's month); earlier and closed months keep the setting they had.
- [x] Leases: every month-end liability is the exact present value of the payments still due, rounded once; interest is the difference.
      Rounding no longer compounds (a 20-year annual-in-advance lease at 100 % ended at Rp 1,28 M before; now 0 with no negative month).
- [x] Leases in the tax pack: the book side is the journalled depreciation + interest only (an unposted month adds nothing the books don't carry).
- [x] Lease cancel re-reads the lease under the lock (no double reversal).
- [x] Employee census: the same name + birth date twice without a number is refused; employees created in an import count for later rows.
- [x] Dates: `31/02/1990`-style text dates are unreadable (ledger and census imports), never rolled into the next month.
- [x] Imbalan Kerja page: an entity reached by switching scope starts from its saved assumptions (no crash).
- [x] CALK (#58, merged meanwhile) reads the CKPN setting in force for the month.
- [x] CKPN setting saves are refused when the version would govern a locked month (serialised with the close); the CKPN card remounts per
      period so a form never carries another month's version.
- [x] Cash flow (#58 review): a non-cash entry that crosses sections (asset bought on credit, dividend declared, first-year benefit
      obligation) no longer shows as investing / financing — its part there moves to one operating *non-kas* line; lease interest accrued
      is added back in operating so the whole rent paid is financing.
- [x] CALK lease note from journalled months, with the ledger row as its total and the difference named.
- [x] Drill-down: equity column headers, cash-flow lines and CALK account rows link to the account ledgers.
- Already done in #56: the stricter template-account check (side and name) that #55's review asked for.

**Gate-reopener (flagged):** migration `20260929070000_ckpn_setting_versions` (CkpnSetting gains effectiveYear/effectiveMonth; the
per-entity unique becomes per entity-month; existing rows apply from January 2000).

## Verification
- After merging staging (with #58) and the second round: lint ✓ · typecheck ✓ · `Test Files 86 passed (86) · Tests 602 passed (602)` · build ✓ · `npx playwright test` → `18 passed (1.1m)`; every demo single-currency scope Mar/Jun/Aug: `checked 21, mismatches 0` · `demo:reset` + `verify:books` → `ALL PASS — 1717 pemeriksaan saldo cocok dengan ground truth.`
- Lease figures changed by at most Rp 1 per line (e.g. June interest 2 124 338, was 2 124 339); tests updated from an independent exact
  Fraction computation.

## Verification in Chrome (local, synthetic data)
- CKPN: August matrix 13 jt = 1135; a September version (110 %) saved from the page, August kept 100 % / 13 jt; `ckpn:` control PASS.
- Sewa: second lease (quarterly in advance, 10 %) registered → ROU 315.091.850 (= the unit-test PV), cancelled → reversal in 1230, register = ledger.
- Imbalan Kerja: a new hire typed in → 1.882.936 proposed to 6105 / 2310 (= the DBO increase), posted → sesuai buku besar; OCI 57.937.849,
  equity, cash flow and CALK note consistent.
- Pajak Badan: June after a September posting says the journal is booked on 30 Sep; working paper and statements downloads 200.
- **Found and fixed:** the cash flow put rent paid from the statement in operating (financing 0). A statement row is posted to 1999 and
  moved by a RECLASS entry without a cash line, which the non-cash rule took for a non-cash transfer. Bank-derived entries are now cash
  (test `classifies a statement row moved out of 1999 …` fails without the fix). After: operating 0, financing −30 jt rent.

## Ship Notes
- **Migration:** `20260929070000_ckpn_setting_versions` (additive columns, index swap). **Env / dependency / AI:** none.
- **Rollback:** revert the merge.
