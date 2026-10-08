# UI verification pass: clearer pages and a less generic look

## Context
The owner asked for an end-to-end UI check of the latest build, "no AI slop", pages a user can read at a glance, and design tokens that
look less like typical SaaS. Staging is retired ([ADR 0015](../adrs/0015-production-only.md)), so "latest" = `main` @ `9772930`, built
and walked on the local stack (local Postgres + local Supabase Auth, demo firm "KJA Demo & Rekan").

**What was run:** `npm run build` ✓, then `npm run ux:sweep` (3 demo clients × 25 client pages + 6 firm pages, each at 1440 px and
390 px, screenshots read page by page). `xlsx` could not be installed (cdn.sheetjs.com is blocked in this sandbox), so a stub stood in:
spreadsheet *parsing* was not exercised here; every page rendered.

**Mechanical result: clean.** 0 HTTP errors, 0 console errors, 0 `undefined`/`NaN`, 0 broken internal links, 0 page-level horizontal
scroll. The 220 "findings" are all 390 px inner-scroll leads (wide tables scrolling inside their card, by design).

**Judgement result: the pages work but are heavier than they need to be, and the look is the default SaaS kit** (grey-blue canvas, white
boxes in boxes, electric blue everywhere, tinted pills, Inter only). Concretely:

| # | Where | Problem | Rule it breaks |
|---|---|---|---|
| 1 | Beranda | "Tanya Buku" (an AI prompt box + 4 chips) is the largest block, above the work. | "Don't make me think"; AI is a helper, not the home page |
| 2 | Beranda | NextStep says "6 pekerjaan menunggu. Pertama: Lengkapi 1 rekening koran" and the list right under it repeats that row. | show each fact once |
| 3 | Beranda, Ringkasan | Every figure is a big blue underlined link, so nothing is emphasised and blue stops meaning "action". | one blue = actions/focus |
| 4 | Beranda | "Keuangan per perusahaan" = bordered cards inside a bordered card, 3 figures each. | boxes in boxes |
| 5 | Client Ringkasan | NextStep + SetupSteps strip + 4 tiles + 3 charts + 3 cards on one screen; the Kontrol card cuts its own sentences with "…"; the revenue chart *and* a table repeat the same six months. | show each fact once; one thing to do |
| 6 | Review transaksi | NextStep is a 2-line paragraph of key-binding instructions, not one sentence; every suggestion card carries a yellow warning block, so the warning stops being a signal. | NextStep = one plain sentence |
| 7 | Tutup Buku | 14 "Lolos" rows are laid out at the same weight as the 7 problems; "Tinjauan AI: AI belum diatur" is a whole card saying nothing is configured. | problems first; empty states say what's true |
| 8 | Laporan | Draf banner is one run-on sentence of 6 underlined links; every account name is underlined all the way down. | scannability |
| 9 | Everywhere | Status = tinted rectangle + icon + word in every table cell (Beranda matrix has ~12 of them). | noise |

## Spec
**Look (tokens only, `app/globals.css` + the two product pieces that hard-code a look):**
- [ ] **Ledger-paper palette** replaces the cool grey-blue: canvas warm paper `#F6F3EC`, working surfaces (tables, forms) `#FFFFFF`,
  hairlines warm `#DDD8CC`, ink warm near-black `#17181C`, secondary text `#58554D` (≥ 7:1 on paper).
- [ ] **Ink blue instead of electric blue:** `--primary`/`--brand` `#1F3A8A`-family (deeper, less saturated; ≥ 9:1 on white). Blue stays
  for actions, focus and selection only.
- [ ] **Drill-down numbers are ink, not blue:** `Money`/stat links render in ink with a dotted underline at rest (still visible, rule 11),
  solid blue on hover/focus. Account names in `FsTable` likewise.
- [ ] **Quieter status:** `StatusPill` drops the tinted box: icon + label in the status colour, no fill; FAIL keeps a subtle fill because it blocks.
- [ ] **One display face for page titles and stat values** (a serif with tabular lining figures) so the product has a voice of its own; body,
  tables and forms stay Inter. *New dependency, see gate-reopeners.*
- [ ] **Sections by rule, not box:** `Card` loses `ring` + radius in favour of a top rule + padding where it is a *section*; a bordered
  white surface stays only for tables and forms. Radius 4px → 2px.
- [ ] Chart palette re-validated with the `dataviz` validator against the new canvas (chart-1 follows the new primary); no status colours in charts.
- [ ] `ui-rules` skill updated with the new tokens and the "no boxes in boxes" / "drill-down is ink" rules.

**Clarity (one change per finding above):**
- [ ] #1 Beranda: *Tanya Buku* moves below "Perlu dikerjakan" and collapses to a one-line field (chips and history behind it).
- [ ] #2 Beranda: NextStep stays as the single instruction; the list underneath starts from the second job (or the banner is dropped when the list is on screen).
- [ ] #4/#5 Beranda + Ringkasan: per-company figures as a plain table (company · pendapatan · laba · kas), not cards; Ringkasan drops the
  "Pendapatan vs beban" duplicate table and shows full control sentences (wrap, never "…").
- [ ] #6 Review: NextStep = "4 transaksi menunggu keputusan Anda."; key-binding hints move to the existing `↑ ↓ / Enter` row; the yellow
  note appears only when the suggestion differs from what the note recommends (otherwise it's the AI reason line).
- [ ] #7 Tutup Buku: passed controls collapse into one "14 kontrol lolos" disclosure per entity; the AI-review card shows only when AI is configured.
- [ ] #8 Laporan: Draf banner = "Draf, belum final" + counted blockers (4 transaksi · 1 akun belum terklasifikasi · …) each one link; account names
  underline on hover/focus only *where the row is already a visible link affordance* (chevron or dotted underline from the token change).
- [ ] #9 Beranda matrix: one status icon + word per cell without fill (comes with the StatusPill change).

**Verification (in this cycle):** `ux:sweep` re-run: 0 new findings; screenshots of Beranda, Ringkasan, Review, Tutup Buku, Laporan at 1440 and
390 px before/after in the Verification section; `e2e/` selectors updated where the DOM moves; `npm run verify:books` ALL PASS (no number changes).

**Non-goals:** dark mode; new pages or features; changing any number, control or copy that is *accounting* vocabulary; the AI behaviour itself;
the login/auth card layout (already minimal); redoing charts beyond colour.

**Gate-reopeners:**
1. **New dependency:** one variable font via `@fontsource-variable/<serif>` (candidate: Newsreader or Source Serif 4; self-hosted like Inter). If you'd
   rather not add one, the look keeps Inter with a heavier title weight and the serif task (T3) is dropped.
2. No schema migration, no env var, no AI credit use, no accounting invariant touched.

**Assumptions:**
1. "Latest staging" = latest `main`, because staging was retired (ADR 0015); no production data was touched.
2. The palette and the serif are my proposal. If you have a brand colour or a preferred feel, say so now; the tokens are one file, so it is cheap to change.
3. Collapsing passed controls and moving *Tanya Buku* is acceptable product-wise (nothing is removed, only re-ordered/folded).
4. Spreadsheet-upload paths were not walked here (sandbox blocks the `xlsx` package); CI's e2e covers them.

## Tasks
- [x] T1 Tokens: warm paper palette, ink blue, 2px radius, contrast table in the cycle doc — accept: `npm run lint && typecheck && test`; contrast ≥ 4.5:1 text / 3:1 UI computed in the doc; chart palette passes the validator.
- [x] T2 Quiet status + ink drill-down links (`StatusPill`, `MethodBadge`, `Money` links, `FsTable` account links) — accept: no tinted fill except FAIL; link affordance still visible without hover; unit/e2e green.
- [x] T3 Display serif for `PageHeader` title and `Stat` value (depends on gate approval) — accept: lighthouse-free check: font self-hosted, no layout shift at 390 px.
- [x] T4 Sections by rule: `Card` default + the "boxes in boxes" places (Beranda finance, Ringkasan) — accept: screenshots; no nested bordered boxes.
- [x] T5 Beranda: reorder *Tanya Buku*, de-duplicate NextStep vs list, finance table — accept: sweep shows 1 NextStep, no duplicate sentence; e2e investor walk green.
- [x] T6 Ringkasan + Laporan: full control text, drop duplicate chart table, Draf banner as counted links — accept: no "…" in control sentences at 1440/390.
- [x] T7 Review + Tutup Buku: one-sentence NextStep, note only when it adds something, collapse passed controls, hide unconfigured AI card — accept: `e2e/review-safety`, `e2e/investor-demo` green.
- [x] T8 `ui-rules` skill + `ux:sweep` re-run + before/after screenshots — accept: sweep 0 new findings; Verification filled.

## Implementation
- Plan: T1–T2, T4–T8 sequential, inline (shared tokens and components, nothing independent enough to delegate). T3 held until the font dependency is approved.
- T1: `app/globals.css` — warm paper palette, ink-blue primary/brand (`#1F3A8A`), 2px radius, new status tints. `--chart-1` is a separate lighter blue (`#3358B8`): the ink blue fails the dataviz lightness band (L 0.38 < 0.43) as a series colour.

Contrast (WCAG, computed): ink on paper 16.0 · ink on white 17.7 · muted on paper 6.7 · muted on white 7.4 · primary on paper 9.3 · white on primary 10.3 · white on primary-hover 12.6 · pass on paper 5.9 · review on its tint 6.5 · fail on paper 6.0 · fail on its tint 5.5 · input border on white 3.6 (UI ≥ 3:1) · sidebar text 13.8 · active item 10.8.
- T2: `app/globals.css` (`.drill`), `components/app/status.tsx`, and the account/figure links in `fs-table`, `tb-table`, `ledger-table`, `statements`, `close-panel`, `close-review-card`, `workspace-overview`, `subledger-recon`, ledger page — one shared `.drill` (ink, dotted underline at rest, solid blue on hover/focus) replaces seven hand-copied class strings; `StatusPill` is text + icon, with a fill only for FAIL.
- T4: `components/ui/card.tsx` (hairline uses `--border`, not a grey tint of the ink), `components/app/workspace-overview.tsx` — Beranda's "Keuangan per perusahaan" is one divided list (name + three figures per company; stacked on a phone, four columns from md up, one DOM) instead of bordered cards inside a card. *Scope note:* `Card` stays a white bordered surface; turning every card into a rule-only section would move too much at once, so the "sections by rule" idea is applied where boxes were nested, and Ringkasan's nesting is handled in T6.
- T5: `app/(app)/page.tsx`, `components/app/workspace-overview.tsx`, `components/app/workspace-ask.tsx` — the NextStep is the first job in one sentence ("Lengkapi 1 rekening koran. 5 pekerjaan lain menunggu."); the list below is "Setelah itu" and starts at the second job (the expanded `?tugas=semua` view still lists all, first included); *Tanya Buku* sits after the jobs, one-row input, no tinted border; Kemajuan and Keuangan follow. Page height 1940 → 1586 px at 1440 px, 2928 → 2625 px at 390 px.
- T6: `app/(app)/clients/[id]/page.tsx` (control sentences wrap in full; the revenue/expense table is `sr-only`: screen readers keep the numbers, sighted users see the chart once), `components/app/report-status.tsx` (Draf banner = one heading line + one linked blocker per line on a white card with an amber left rule, instead of a yellow slab with six run-on links).
- T7: `components/app/close-panel.tsx` (open controls first; passed controls fold into a "N kontrol lolos" disclosure per entity, still in the DOM), `app/(app)/clients/[id]/close/page.tsx` (the AI-review card renders only when AI is configured), `app/(app)/clients/[id]/review/page.tsx` + `components/app/review-queue.tsx` (NextStep = "Periksa 4 usulan akun di bawah: terima yang benar, ganti yang salah."; the Tebakan/Enter rule moves to the hint row and shows only when a guess exists), `e2e/investor-demo.spec.ts` (first-visible "Lolos" → "N kontrol lolos"). *Deviation from the Spec:* the per-card accountant hints (capex, down payment, withholding) are real rule-based checks, so they stay; they changed from a yellow filled block to a quiet amber left-rule note with the same text and one-click action, rather than appearing "only when different".
- T8: `.agents/skills/ui-rules/SKILL.md` — ledger-paper tokens, `.drill`, status without fills, no boxes in boxes, one-sentence NextStep, passed items fold, no `line-clamp` on explanatory text, no card that only says "not set up".
- T3 (approved by the owner: "get them done"): `@fontsource-variable/newsreader@5.3.0` (new dependency, lockfile +10 lines, `xlsx` entry untouched), `app/globals.css` (`--font-display`), `components/app/page-header.tsx` (page title, `Stat` value), `app/(app)/not-found.tsx`, `app/login/shell.tsx`. Newsreader chosen over Source Serif 4 by rendering both at heading and figure size: narrower, more editorial, lining + tabular figures (`tnum` present).
- Polish round after reading the pages the first pass skipped (Impor, Buku Besar, Saldo Awal, Pengaturan, Dokumen, Laporan, Tambah klien, login):
  - `app/(app)/clients/[id]/import/page.tsx`: the upload form moves up under Kelengkapan data (it was ~1100 px down, below a drafted WhatsApp message and two cards); the import history shows 6 rows with "Tampilkan semua (N)" (`?riwayat=semua`); "Minta data ke klien", "Tautan unggah" and the Dokumen hint follow the form; on a phone the history hides Periode / Baris / Diimpor so "Hapus" is no longer off-screen.
  - `components/ui/card.tsx`: card titles are semibold (they were the same weight as body text).
  - `components/app/status.tsx` + `app/(app)/clients/[id]/page.tsx`: the Kontrol card says "7 perlu dicek" once in its header and marks rows with an icon (labelled for screen readers) instead of repeating the "Perlu dicek" pill five times.
  - `components/app/app-sidebar.tsx`: the client section label is the client name, truncated with a tooltip (was "AKUNTANSI · GRUP AYAM / NUSANTARA", wrapping onto two lines).
  - `components/app/client-form.tsx`, `entities-card.tsx`: the NPWP placeholder was cut off in its own field; the label now says "NPWP, 16 digit (opsional)" and the placeholder is just the example.
  - `app/globals.css`: `.drill` underline 70% → 55% so lists made entirely of links (Buku Besar, Neraca Saldo) stay calm.

## Verification
- Environment: `xlsx` is a stub here (cdn.sheetjs.com blocked), so 7 spreadsheet-reading test files fail locally; they fail identically on untouched `main` (27 failed | 48 passed in those 7 files, both runs). CI has the real package.
- T1: lint clean; typecheck clean; `npm test` → Test Files 7 failed | 178 passed (185), Tests 27 failed | 1190 passed (1217): the same 27 as on `main`, none related to the change. Chart palette: validator PASS on lightness, chroma, CVD ΔE 8.6 / tritan 16.9, normal-vision ΔE 27.2, contrast ≥ 3:1 (grey "Lainnya" slot fails chroma by design).
- T2: lint + typecheck clean. No unit/e2e file references the changed classes or imports the touched components, so no test is affected; visual check follows in T8.
- T4/T5: lint + typecheck clean; `npm run build` ✓; `e2e/workspace.spec.ts` + `e2e/early-input.spec.ts` → 4 passed (the first run caught a duplicated hidden DOM copy of the finance rows at 390 px; fixed by rendering them once). Screenshots at 1440 and 390 read: no duplicate sentence, no nested boxes, no horizontal scroll.
- T6/T7: lint + typecheck clean; `npm run build` ✓; screenshots read at 1440 px (Ringkasan, Review, Tutup Buku, Laporan). Tutup Buku 2000 → 1530 px tall; Laporan banner capitalised after the first look. Full e2e runs once at the end of the cycle.
- **End of cycle (local):** `npm run build` ✓ (exit 0); `npm run verify:books` → ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth; e2e: 28 of the 37 specs → 39 passed (3.2 m), exit 0. The other 9 specs (`evidence-workspace`, `import-xls`, `ledger-import`, `management-note`, `qa-import-edge-cases`, `qa-tax-split`, `qa-urls-and-layout`, `statements`, `tax-pack`) build real spreadsheets and cannot load with the sandbox's `xlsx` stub: **CI is the check for those** (and for the 27 spreadsheet unit tests).
- **`ux:sweep` re-run:** 222 inner-scroll leads vs 220 before; still 0 HTTP errors, 0 console errors, 0 `undefined`/`NaN`, 0 broken links, 0 page-level horizontal scroll. The 2 new leads are the visually hidden (`sr-only`) question label on Beranda, clipped by design.
- **Before → after page height (full-page screenshot, px):** Beranda 1942 → 1586 (1440) and 2928 → 2625 (390); Tutup Buku 2414 → 1532 (1440) and 3943 → 2849 (390); Review 1390 → 1346; Ringkasan 1313 → 1339 and Laporan 1422 → 1524: these two grew on purpose (control sentences no longer cut with "…"; each Draf blocker on its own line).
- Not done here: T3 (display serif). Dark mode, new pages and accounting copy untouched, as specced.
- **T3 + polish round (local):** lint + typecheck clean; `npm run build` ✓; the same 28 e2e specs → 39 passed (3.3 m), exit 0. Impor Mutasi 3307 → 2439 px at 1440 px, upload form ~1100 px → ~720 px from the top. Screenshots read: Beranda, Ringkasan, Impor (1440 + 390), Buku Besar, Saldo Awal, Pengaturan, Dokumen, Laporan, Tambah klien, login.
- **Self-review of the diff, then fixes:** `close-panel.tsx` had leftover indentation and computed `rowsOf(g)` four times per group (now once); `StatusPill iconOnly` would have put a background and padding on a bare icon for a failure (colour and fill are now separate fields); a stray `sm:flex-1` on the question box did nothing. Rebuild ✓, the same 28 e2e specs → 39 passed (3.5 m); final `ux:sweep`: 222 findings, all inner-scroll leads, 0 new against the previous sweep, 0 of any other kind.

## Ship Notes
- One new dependency, approved by the owner: `@fontsource-variable/newsreader` (self-hosted, no network at runtime). No migration or env var. Presentation only: no number, control or accounting copy changed (`verify:books` ALL PASS).
- Rollback: revert the merge.

