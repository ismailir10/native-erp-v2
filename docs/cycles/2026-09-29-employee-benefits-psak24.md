# Imbalan kerja (PSAK 24) — liabilitas imbalan pasca kerja UU Cipta Kerja / PP 35/2021

## Context
Fourth of the five Balancio-gap cycles (approved "all in that order"). Balancio's *Kalkulator PSAK 24* takes an employee census and
assumptions and returns the defined benefit obligation (DBO) under PP 35/2021 with the Projected Unit Credit method, the service and interest
cost, the remeasurement to OCI, sensitivities and the journals. Small Indonesian companies need it every year-end; most buy an actuarial
report. Buku already has the ledger and the tax pack, so the valuation can post itself and feed the deferred tax.

## Spec
- [ ] **Census per entity** (*Imbalan Kerja* page): employees with name, employee number (optional), sex, birth date, hire date, monthly wage
      (upah: gaji pokok + tunjangan tetap) and the date they left, if they did. Imported from Excel / CSV (header words: nama, nik/no,
      jenis kelamin / L-P, tanggal lahir, tanggal masuk, gaji / upah, tanggal keluar) or typed one by one; an import updates employees
      matched by number (else name + birth date) and adds the rest.
- [ ] **Mortality table per firm, uploaded once:** Buku ships no table it can't verify. The firm uploads its TMI IV (2019) (or another) as
      Excel / CSV with age, male qx and female qx (ages 0 … ≥ 100, qx 0–1); stored as integers (qx × 10⁹). Without one the valuation says so.
- [ ] **Assumptions per entity:** mortality table, discount rate and salary increase (% a year), normal retirement age (default 56), disability
      = % of mortality (default 10 %), resignation rate (default 5 % a year up to age 30, falling linearly to 0 % at age 55).
- [ ] **PUC valuation at a month-end** (usually December), per employee, year by year to retirement: survival through death, disability and
      resignation; on death or disability 2 × pesangon + 1 × UPMK (PP 35/2021 Pasal 55, 57), at retirement 1,75 × pesangon + 1 × UPMK
      (Pasal 56), resignation nothing (UPH and uang pisah left out); pesangon and UPMK months from service (Pasal 40); wage projected at the
      salary increase; discounted at the discount rate. **Attribution** (DSAK IAI, April 2022): service from max(hire date, retirement date
      − 24 years) — the years that earn the capped benefit. Service cost = the obligation attributed to the next year; interest cost =
      discount rate × (DBO + service cost). Rates and probabilities are dimensionless (float); each employee's obligation = wage × factor
      (factor to 10⁻⁹, half up), bigint. **Sensitivity:** DBO at discount ± 1 pp and salary increase ± 1 pp.
- [ ] **Journal by click** (`ADJUSTMENT`, period end) bringing **2310 Liabilitas Imbalan Kerja** to the DBO: **6105 Beban Imbalan Kerja**
      year to date = (service + interest cost from the valuation at the previous 31 December) × months ÷ 12 + the whole obligation of employees
      hired since; the rest is remeasurement to **3920 Pengukuran Kembali Imbalan Kerja** (equity, OCI). In the entity's first year in Buku
      (no earlier benefit journal) the obligation at the previous 31 December not yet in 2310 goes to **3200 Saldo Laba** (prior periods).
      Differences against the GL (2310, 6105 year to date, 3920), so benefits paid from the statement to 2310 and re-posting are respected.
- [ ] **Close control** `eb:<entity>` in December, once the entity has assumptions: REVIEW while the journal has a difference.
- [ ] **Tax pack:** 6105's name already matches the *imbalan kerja* correction category (beda waktu); the deferred tax counts 2310's credit
      balance as a deductible temporary difference; the part of the deferred tax that belongs to the remeasurement (22 % of 3920's
      remeasurement balance) goes to 3920, not 8110.

**Gate-reopeners (flagged):** schema migration (MortalityTable, Employee, BenefitSetting, BenefitPosting, enum Sex; CHECKs); COA template
gains 6105, 3920 and an equity FS line *Pengukuran kembali imbalan kerja*; accounting rule 5g; tax-pack deferred tax (employee benefits, OCI
part). No dependency (ExcelJS/SheetJS already used), no AI.

**Non-goals:** a bundled mortality table; plan assets / funded programmes (DPLK); other long-term benefits (jubilee, cuti besar); past service
cost from plan amendments and curtailments as separate lines (they land in remeasurement); per-employee salary history; the statement of
comprehensive income's OCI section (cycle 5).

**Assumptions:**
1. The valuation at the previous 31 December uses today's census (employees employed then) and today's wages.
2. Death and disability are spread mid-year; retirement at the exact retirement age.
3. An employee past the retirement age at the valuation date is valued at the immediate retirement benefit.

## Tasks
- [ ] T1 Schema + accounts — accept: `migrate diff` empty; gate green.
- [ ] T2 Engine `lib/benefits/puc.ts` (PP 35 months, decrements, attribution, DBO / SC / IC, sensitivity) — accept: unit tests with hand-checked
      cases (no decrements and no discounting = benefit × attributed share; one-year decrement; attribution cap; past retirement age).
- [ ] T3 Census + mortality import and records (`lib/benefits/census.ts`) — accept: DB tests (xlsx / csv import, update by number, bad rows named).
- [ ] T4 Valuation, journal, control, tax (`lib/benefits/valuation.ts`) — accept: DB tests (first year to 3200, next year expense vs OCI,
      benefits paid, control, deferred tax with the OCI part).
- [ ] T5 UI page + sidebar + e2e — accept: e2e (upload table → import census → assumptions → DBO → journal → control), screenshots 1440 / 390.
- [ ] T6 Rules + docs — accept: end-of-cycle gates.

## Implementation
## Verification
## Ship Notes
