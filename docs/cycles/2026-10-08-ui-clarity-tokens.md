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
- [ ] T1 Tokens: warm paper palette, ink blue, 2px radius, contrast table in the cycle doc — accept: `npm run lint && typecheck && test`; contrast ≥ 4.5:1 text / 3:1 UI computed in the doc; chart palette passes the validator.
- [ ] T2 Quiet status + ink drill-down links (`StatusPill`, `MethodBadge`, `Money` links, `FsTable` account links) — accept: no tinted fill except FAIL; link affordance still visible without hover; unit/e2e green.
- [ ] T3 Display serif for `PageHeader` title and `Stat` value (depends on gate approval) — accept: lighthouse-free check: font self-hosted, no layout shift at 390 px.
- [ ] T4 Sections by rule: `Card` default + the "boxes in boxes" places (Beranda finance, Ringkasan) — accept: screenshots; no nested bordered boxes.
- [ ] T5 Beranda: reorder *Tanya Buku*, de-duplicate NextStep vs list, finance table — accept: sweep shows 1 NextStep, no duplicate sentence; e2e investor walk green.
- [ ] T6 Ringkasan + Laporan: full control text, drop duplicate chart table, Draf banner as counted links — accept: no "…" in control sentences at 1440/390.
- [ ] T7 Review + Tutup Buku: one-sentence NextStep, note only when it adds something, collapse passed controls, hide unconfigured AI card — accept: `e2e/review-safety`, `e2e/investor-demo` green.
- [ ] T8 `ui-rules` skill + `ux:sweep` re-run + before/after screenshots — accept: sweep 0 new findings; Verification filled.

## Implementation
## Verification
## Ship Notes
