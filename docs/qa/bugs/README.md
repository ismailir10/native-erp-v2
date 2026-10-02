# Bug list (separate from the report)

Found during the end-to-end QA run of 2026-10-02 (see [../report.md](../report.md)). One file per bug; each has steps, expected/actual, root cause with code reference, impact for an Indonesian accounting firm, and a suggested fix.

**Severity:** *Blocker* = a core accounting workflow cannot be completed and there is no sensible workaround · *High* = books silently wrong · *Medium* = wrong or broken in a plausible real-world case, user may notice · *Low* = cosmetic/robustness.

| ID | Severity | Status | Title |
|---|---|---|---|
| [BUG-001](./BUG-001.md) | Blocker | Fixed (PR #77) | Import fails for identical same-day lines when the statement has no running-balance column |
| [BUG-002](./BUG-002.md) | High | Fixed (`task/fix-qa-bugs`) | XLSX with ISO date cells (`t="d"`) is imported with dates in 1905 and reports success |
| [BUG-003](./BUG-003.md) | High | Fixed (`task/fix-qa-bugs`) | `250,000` is read as Rp 250 (Western thousands separator silently shrinks the amount 1,000×) |
| [BUG-004](./BUG-004.md) | Medium | Fixed (`task/fix-qa-bugs`) | Newest-first statement exports are read with the wrong opening/closing balance and period |
| [BUG-005](./BUG-005.md) | Medium | Fixed (`task/fix-qa-bugs`) | Cross-rate `0.745` is stored as 745 (and `1.085` as 1085) |
| [BUG-006](./BUG-006.md) | Medium | Fixed (`task/fix-qa-bugs`) | Indonesian-format text rate `15.750,50` in a ledger file is read as 15.7505 |
| [BUG-007](./BUG-007.md) | Medium | Fixed (`task/fix-qa-bugs`) | `?period=2026-13` or `2026-00` renders “undefined 2026” and exports `…-undefined-2026.xlsx` |
| [BUG-008](./BUG-008.md) | Medium | Fixed (`task/fix-qa-bugs`) | Uploading a file above 6 MB replaces the whole page with an English generic error |
| [BUG-009](./BUG-009.md) | Low | Fixed (`task/fix-qa-bugs`) | One zero-amount row fails the whole statement with “Jurnal minimal dua baris” |
| [BUG-010](./BUG-010.md) | Low | Fixed (`task/fix-qa-bugs`) | Out-of-range amounts end in “Terjadi kesalahan tak terduga” |
| [BUG-011](./BUG-011.md) | Low | Fixed (`task/fix-qa-bugs`) | NPWP validation accepts 19–25 digits and stores the value un-normalised |
| [BUG-012](./BUG-012.md) | Low | Fixed (`task/fix-qa-bugs`) | Impor Mutasi overflows horizontally at 390 px; the history table is clipped |
| [BUG-013](./BUG-013.md) | Low | Fixed (`task/fix-qa-bugs`) | Every page has the same `<title>` |
| [BUG-014](./BUG-014.md) | Low | Fixed (`task/fix-qa-bugs`) | Long unbroken text overflows its card; duplicated word in a toast |

BUG-001 (the blocker) was fixed in PR #77; BUG-002 … BUG-014 were fixed afterwards on `task/fix-qa-bugs`, each with a regression test or a browser re-verification (cases `VF-*` in [../results-table.md](../results-table.md)).
