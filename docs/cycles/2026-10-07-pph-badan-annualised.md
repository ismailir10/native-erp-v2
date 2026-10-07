# Pajak Badan: Pasal 31E on annualised turnover

## Context
Reading the demo's Pajak Badan as an accountant: PT Ayam Nusantara Digital, *s.d. Agustus 2026*, turnover Rp 8,78 M. Pasal 31E took
4,8 M ÷ 8,78 M = 55 % of PKP at 11 %. The Rp 4,8 M and Rp 50 M thresholds are **annual**. Eight months heading for Rp 13,2 M a year give
36 %. The demo's books open at the end of February, so the year so far is six months, heading for Rp 17,7 M: 27 %. So every interim
estimate understated PPh badan: the demo August shows Rp 197,3 jt where the year's rate gives Rp 240,2 jt. It also understated the
current-tax journal it proposes and the PPh 29 the client is told to prepare for. PSAK 3 (interim reporting) books interim tax at the expected
annual effective rate, which is the annualised share. DJP annualises a short first year for 31E the same way.

Next year's PPh 25 was (YTD terutang − PPh 22/23/24) ÷ 12. Mid-year that is eight months of tax spread over twelve, so it was understated too.

## Spec
- [x] `corporateTax` takes `months` (1–12, default 12) and judges both 31E tests on `annualTurnover = turnover × 12 ÷ months`.
- [x] `taxPack` passes the months the books cover through the chosen month. That is from January, or from the day after an in-year
  opening that holds only the balance sheet. An opening with income or expense lines carries the year so far, so it counts from January.
- [x] `settlement` projects next year's PPh 25 as (terutang − PPh 22/23/24) ÷ months.
- [x] Pajak Badan and the Excel *Rekonsiliasi Fiskal* show *Peredaran bruto disetahunkan (× 12 ÷ n bulan), dasar Pasal 31E* before
  December, and label the instalment *(proyeksi setahun)*. December of a full year is unchanged.
- [x] accounting-rules 5d says so.

**Non-goals:** PP 55 eligibility (still the accountant's choice); turnover from before the books started (not in Buku).
**Gate-reopeners:** none (no schema change).

## Tasks
- [x] T1 Compute, pack, page, workpaper, rules, tests — accept: unit tests for interim 31E (both thresholds) and the projected
  instalment; a DB test for books opened 31 May (3 months, 9,6 M a year, half of PKP at 11 %); updated tax-pack DB and e2e expectations.

## Verification
- `npm test` 1182 passed (new unit and DB cases above); `npm run build`; `demo:reset` + `verify:books` ALL PASS (1765); `test:e2e` 55 passed.
- Demo PT Ayam Nusantara Digital, August 2026: months 6, annualised turnover Rp 17.677.117.120, PKP at 11 % Rp 343.102.280,
  PPh badan Rp 240.240.628 (was 197.309.396), next PPh 25 projected Rp 40.040.104.

## Ship Notes
- No migration. Interim PPh badan estimates rise where annualised turnover passes Rp 4,8 M. December is unchanged for full-year books.
  A current-tax journal already posted for an earlier month shows the difference as a new proposal. Rollback: revert.
