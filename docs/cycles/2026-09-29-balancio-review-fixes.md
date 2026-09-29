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
- Already done in #56: the stricter template-account check (side and name) that #55's review asked for.

**Gate-reopener (flagged):** migration `20260929070000_ckpn_setting_versions` (CkpnSetting gains effectiveYear/effectiveMonth; the
per-entity unique becomes per entity-month; existing rows apply from January 2000).

## Verification
- lint ✓ · typecheck ✓ · `Test Files 85 passed (85) · Tests 596 passed (596)` · build ✓ · `npx playwright test` → `17 passed (1.5m)` · `demo:reset` + `verify:books` → `ALL PASS — 1717 pemeriksaan saldo cocok dengan ground truth.`
- Lease figures changed by at most Rp 1 per line (e.g. June interest 2 124 338, was 2 124 339); tests updated from an independent exact
  Fraction computation.

## Ship Notes
- **Migration:** `20260929070000_ckpn_setting_versions` (additive columns, index swap). **Env / dependency / AI:** none.
- **Rollback:** revert the merge.
