# Client navigation — switch clients without losing your place

## Context
An accountant closing 30 small clients does the same stage for each of them (Review, then Neraca Saldo, then Tutup Buku). Moving
between clients today costs them their place, and on many pages it doesn't say which client they are in. Found by reading
`components/app/app-sidebar.tsx`, `app/(app)/layout.tsx` and the client pages:

1. **Switching drops the page.** `clientHref(client)` in the sidebar always lands on the client's Ringkasan. From *Neraca Saldo* of A,
   picking B gives B's overview, and the accountant clicks back to *Neraca Saldo* every time.
2. **The list is a hunt.** Once a client is open, *Daftar klien (N)* is collapsed. Expanding it gives a flat, unsearchable, unkeyboardable
   list of 30 names.
3. **Which client am I in?** Only the sidebar says so. The headers of *Buku Besar*, *Neraca Saldo*, *Review transaksi* and *Laporan* show
   the entity (`scopeLabel`, e.g. "Gabungan Grup"), not the client. Other pages say `client.name · …`, so it is inconsistent. **On a phone
   the sidebar is closed, so nothing names the client at all** (the top bar says "Buku").
4. **No way up.** Drill pages (*Buku Besar → akun → baris*, *Impor → berkas*, *Aset → satu aset*) rely on the browser Back button.
5. Sidebar items carry no `aria-current`, so a screen reader doesn't hear which page is open.
6. **Same words, different scope** (seen in the running app): with a client open the sidebar has *Laporan* (all clients), *3 · Laporan*
   (this client) and *Laporan Keuangan*; *Pengaturan klien* and, in the footer, *Pengaturan* (the whole firm). Nothing says which is
   which. The client's name is small grey text that doesn't look clickable, and the client list sits at the bottom, collapsed.
7. Beranda, Dokumen and Laporan also pick a client (the scope select in their header), so there are two ways to choose a client with
   different meanings: *filter this page* versus *open this client*.

Outcome: from any client page, two keystrokes (⌘K, a few letters, Enter) land on the *same page of another client*, every client page
names its client and its place, and drill pages have a path back up. Works at 390px.

## Spec
- [x] **Client switcher** (`⌘K` / `Ctrl+K` anywhere in the app, plus a visible button): a command palette, built on the vendored
  `components/ui/command.tsx`, with search over client and company names (accent- and case-insensitive).
  - Groups: *Klien* (the open client last, so Enter always goes to another one), *Halaman* (the current client's pages, same list and order as the sidebar, modules included),
    *Lainnya* (Beranda, Tambah klien).
  - **Choosing a client keeps the page.** On `/clients/A/trial-balance` it goes to `/clients/B/trial-balance`. Rules, in one tested
    pure function (`lib/nav.ts`): the top-level section is kept (`tax/masa` and `journals/new` count as sections; only pages in the client menu, Kurs, Pengaturan klien and Riwayat count);
    a detail page (an account, an asset, an import file) falls back to its section list; a module B does not show falls back to
    Ringkasan. Period is kept; entity resets to *Gabungan Grup* (entity ids belong to one client); `scope` becomes `client:B`.
  - **Every client row says where it will land** ("Neraca Saldo", or "Ringkasan klien" when it falls back), so the jump is never a
    surprise.
  - On a workspace page (Beranda, Dokumen, Laporan): already scoped to client A → the same page scoped to B (as the sidebar
    already treats it); scoped to *Semua klien* → B's Ringkasan.
  - Only pages in the client menu carry over (plus Kurs, Pengaturan klien, Riwayat); anything else goes to Ringkasan.
  - Keyboard only is enough: ↑↓ Enter Esc, focus returns to where it was.
- [x] **Client context bar on every client page** (`app/(app)/clients/[id]/layout.tsx`): `Semua klien › PT Contoh ▾ › Neraca Saldo`. *Semua klien* goes back to Beranda
  (just a home icon at 390px), the name is the switcher trigger, so it works on a phone. A page *under* a section (an account, an asset, an imported file) shows the section as a link, which is the way up; a section's own page doesn't repeat its title. Landmark
  `nav aria-label="Posisi"`; the last crumb has `aria-current="page"`.
- [x] **Sidebar says which scope each item is in:**
  - The firm-wide items sit under a *Semua klien* label (Beranda, Dokumen, Laporan), so *Laporan* there can't be mistaken for the
    client's *3 · Laporan*. The footer *Pengaturan* becomes *Pengaturan kantor* (page title too: "Berlaku untuk semua klien di kantor ini").
  - With a client open, the client is a **switcher block** at the head of its section: building icon tile, name (full name on hover),
    "Ganti klien ⌘K" and an up-down chevron. It reads as a control, not a label. With no client open, a *Cari klien* ⌘K button opens
    the same palette.
  - The existing *Daftar klien (N)* list and *Tambah klien* stay as they are. Active items get `aria-current="page"`.
- [x] **Recent clients:** with more than six clients, the switcher lists the last 5 opened first (moved out of the main list, not repeated) (per browser, `localStorage` in try/catch). It renders
  correctly without it.
- [x] **Show each fact once:** with the context bar naming the client, the `${client.name} · ` prefix is dropped from client page
  descriptions (they keep entity, period and what the page is). The Ringkasan title stays the client name.
- [x] 390px: no horizontal scroll, the bar truncates a long name and the palette fits the screen.
- [x] No schema change, no new dependency (`cmdk` is already installed), no AI.

**Non-goals:** a firm-wide search across transactions, journals or accounts; unread/blocker counts on sidebar items; changing the
page order or the three-stage spine (ADR 0014); redesigning the Beranda scope select; entity switching (the `ScopeBar` stays);
persisting anything on the server.

**Deck claims:** none. This is not a big feature, so `/ship` skips the deck review.

**Assumptions:**
1. Switching client keeps the **period** because the accountant is working one month across clients. If B has no data for it, the
   page already says so.
2. A detail page can't exist for another client, so it falls back to the section list instead of 404ing.
3. Recents live in the browser only. They are a convenience, not state anyone else needs.
4. ⌘K is not used elsewhere in the app (grep found no `keydown` shortcut besides the review queue's own keys).
5. The e2e specs that click *Daftar klien (N)* keep working, since that button stays.

## Tasks
- [x] T0 Sidebar scope labels: *Semua klien* group, *Pengaturan kantor*. Accept: `workspace.spec` selectors still match.
- [x] T1 `lib/nav.ts`: nav items shared by sidebar and palette, `switchClientHref`, `sectionOf`, recents helper + unit tests.
  Accept: `tests/unit/nav.test.ts` covers section kept, detail falls back, hidden module falls back, period kept, entity reset,
  `tax/masa`, Beranda target, recents dedupe/cap/garbage-in.
- [x] T2 `ClientSwitcher` palette + `⌘K`, mounted once in the app layout; sidebar trigger and `aria-current`. Depends on T1.
  Accept: lint/typecheck; opens, filters, navigates (checked in a browser).
- [x] T3 Client layout with the context bar (name as trigger, section crumb, way up from drill pages). Depends on T1, T2.
  Accept: every client route shows it; 404 for another firm's client unchanged.
- [x] T4 Drop the `client.name · ` prefix from client page descriptions; fix any text asserted by tests/e2e. Accept: grep clean.
- [x] T5 e2e: switch client keeps the page (desktop and 390px), keyboard path. Depends on T2, T3. Accept: spec passes.
- [x] T6 Browser review at 1440 and 390 px, fix what looks wrong, repeat until clean; gates (lint, typecheck, test, build,
  verify:books, e2e). Accept: all pass.

## Implementation
- T0/T2 sidebar (`components/app/app-sidebar.tsx`): firm-wide items under a *Semua klien* label, footer *Pengaturan kantor* (page title too),
  the open client is a switcher block (icon tile, name, "Ganti klien Ctrl K"), a *Cari klien* row when none is open, `aria-current` on
  active items. The menu data moved to `lib/nav.ts`; the sidebar only adds icons. *Daftar klien (N)* and *Tambah klien* are unchanged.
- T1 `lib/nav.ts` (pure, `tests/unit/nav.test.ts`): `clientStages`/`clientSections`, `sectionOf`, `switchTarget`, `resolveScope` (the
  sidebar's scope logic, now shared), `searchScore`, recents helpers, `upQuery`.
- T2 `components/app/client-switcher.tsx`: provider mounted once in the app layout; palette on the vendored `cmdk` command dialog; ⌘/Ctrl+K.
  Each client row says where it lands ("Neraca Saldo", "Sekarang"); a company name finds its client; *Halaman* lists the open client's menu.
- T3 `components/app/client-bar.tsx` in the app layout (outside `template.tsx`, so it doesn't re-animate): `Semua klien › Klien ▾`, plus the
  section as a link when the page is under it. No client layout and no query: the names come from the layout's client list.
- T4 `client.name · ` dropped from 11 descriptions. The five in-page "back" links on drill pages are gone (the bar is the one way up);
  an imported ledger file goes up to `?tab=ledger`.
- Changed while reviewing in a browser (1440 and 390 px):
  - the bar doesn't repeat the section on the section's own page (it duplicated the title);
  - the open client sorts **last** in the palette, so the highlighted row and Enter are always another client;
  - recents only show for more than six clients and move out of the main list rather than repeating there;
  - the sidebar block is compact so *Daftar klien* stays on screen at 900px.
## Verification
- `npm run lint` and `npm run typecheck`: exit 0. `npm test`: 204 files, 1376 tests passed (19 new in `tests/unit/nav.test.ts`).
- `npm run build` exit 0; `npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- `npx playwright test` (production build, local Supabase Auth): 69 passed, including the five in `e2e/client-navigation.spec.ts`.
- Seen in a browser at 1440 and 390 px (local stack): switch keeps page and period (Neraca Saldo, Review, `/reports?scope=client:…`),
  a drill page and its way up, empty search, a company name finds its client, Esc returns focus to the trigger, Beranda opens Ringkasan,
  the sidebar sheet on a phone, no horizontal scroll. Not seen: a firm with more than six clients (recents) beyond the unit tests.
## Ship Notes
- No migration, no new dependency, no AI. `localStorage` key `buku:recent-clients` (client ids only, per browser).
- The in-page "back" links on five drill pages were removed; the bar's section link is the one way up (an imported ledger file still
  returns to the *Buku besar* tab of Impor). e2e that clicked *Kembali ke Impor Mutasi* now uses the bar.
- Settings page title is now *Pengaturan kantor* (it was *Pengaturan*), matching the sidebar.
- Left alone on purpose: Beranda, Dokumen and Laporan still pick a client with their header select (it filters that page); the palette
  is the way to *open* a client.
- Deck: no deck change. `public/deck/*` makes no claim about the sidebar, client switching or shortcuts.
- Rollback: revert; nothing is stored server-side.
