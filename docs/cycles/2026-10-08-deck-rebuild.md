# Deck rebuild: the two audience decks on the original deck's grammar

## Context
After the two-deck cycle (`2026-10-08-two-decks.md`) the owner reviewed the live decks and said `/deck/kantor` and
`/deck/perusahaan` are "really bad", and that the original single deck (`215f4fb`, `2026-10-03-product-deck.md`) is still "by far the
best presentation with good illustration and UI style", apart from some leftover AI-slop. Production `/deck` now serves the chooser, so
"the best one" is that original 14-slide deck.

Side-by-side review of all 40 slides (old deck, kantor, perusahaan) at 1440×900:

| | Original deck | kantor / perusahaan today |
|---|---|---|
| Layout | One idea per slide: headline + 3 short points on the left, one picture on the right, lots of air | Full-width headline on top, then a dense app screen or table that fills the slide |
| Pictures | Line-art illustrations (fanned statements, an open ledger, a messy desk with sticky notes and a clock, a fanned report set) plus a few clean product mocks | Almost only UI tables and cards: 4–6 rows of chips per slide, many tiny labels |
| Copy | 15–40 words of body per slide | 60–150 words per slide, small print, account codes (1199, 1190, 1999) and internal terms |
| Type | Bold sans, comfortable tracking | Plus Jakarta Sans at −0.03em: letters touch at display size |
| Stage | Full window | 16:9 box letterboxed with grey bars on a 16:10 screen |
| Slop | Aurora background, shiny/gradient text, glow behind elements, uppercase monospace eyebrows, marquee | Mostly removed already |

The selling story is also weak: both decks walk through features in app order. A salesperson's deck opens with the buyer's month, shows the
outcome, then answers the objections they will raise (we already use Accurate/Excel, AI makes mistakes, is our client data safe, what can't
it do, how do we start).

Separately, the app is being restyled to a Ramp-like look (`task/ramp-restyle`: warm grey canvas `#F4F2F0`, near-black ink `#0C0A08`, strong
blue `#2152E8`, Hanken Grotesk at regular weight with tight tracking, 8–16 px corners, flat, pale-blue icon tiles, dark `#1A1919` band). The
decks should look like the product they sell, so they take the same tokens.

## Spec
Approval: the owner's brief in-session ("improve them… review it like you are the sales person… at least 3–5 review and iteration, get
them merged") is the approval. No app code, schema, dependency or route changes.

- [x] **Grammar of the original deck:** one idea per slide, headline + at most three short points on the left, one picture on the right; dark
  opening and closing slides; the picture carries the point (line-art illustration or a clean product mock, never a full app screen).
- [x] **Ramp-style tokens, same as the app restyle:** warm canvas, near-black ink, one strong blue for emphasis, pale-blue tiles, dark band
  `#1A1919`, soft corners, flat (no shadows, gradients, glows). Hanken Grotesk (OFL, vendored woff2) replaces Plus Jakarta Sans.
- [x] **No slop:** no aurora/gradient/shiny text, glow, marquee, uppercase monospace labels, label-above-headline, emoji or stock art.
- [x] **Full window, not letterboxed:** the background fills the window; content scales in a 16:9 safe area.
- [x] **Sales story per audience:** firm deck (17 slides) and company deck (14 slides) each go pain → how it works → proof slides →
  objections (existing tools, AI, data) → limits → how to start. The company deck shares no picture with the firm deck except the brand.
- [x] **Honest content:** only what Buku does today (README, ADRs, cycle docs); demo numbers consistent across slides and labelled
  *data demo sintetis* or *ilustrasi*; limits slide kept; no prices, customers, testimonials or time-saved figures.
- [x] **Presenting and reading:** arrows / space / swipe / `#n` / `F`; one scroll below 900 px or portrait; print = one slide per page;
  `prefers-reduced-motion` and print show the final state; CSP-equivalent server shows no console or CSP errors.
- [x] **Chooser `/deck`** restyled to match, with live thumbnails.
- [x] **Review loop:** at least three full review rounds (sales/copy, visual, claims) with findings and fixes recorded below.

**Non-goals:** app code, the restyle itself, pricing, contact forms, analytics, bilingual copy, naming competitors.

**Assumptions**
1. ADR 0014 stands: firms are the buyer, companies reach Buku through a firm or their in-house accountant; owners receive reports, access
   is Admin/Akuntan by invitation.
2. The Ramp restyle lands; if it changes a token value before merge, the deck follows in a later small PR.
3. Right Jet logo, email and colours are still unavailable: text wordmark and `right-jet.com` only.

## Tasks
- [x] T1 Engine + styles: `deck.css` v4 (tokens, type, layout, illustration classes, motion, flow, print), `deck.js` (full-bleed scaling,
  injected chrome), Hanken Grotesk vendored, Plus Jakarta Sans removed — accept: a test slide renders at 1440×900, 1920×1080, 390×844.
- [x] T2 Firm deck (17 slides after review) — accept: every slide screenshot-reviewed at 1440×900 and 390×844.
- [x] T3 Company deck (14 slides after review) — accept: same.
- [x] T4 Chooser restyle — accept: thumbnails render, CSP-equivalent server clean.
- [x] T5 Review rounds 1–4 (sales story, visual craft, claims audit, final review) and fixes — accept: findings listed and closed.

## Implementation
- `public/deck/deck.css` v4: tokens copied from the restyle branch (`#F4F2F0` canvas, `#0C0A08` ink, `#2152E8` blue, `#1A1919` dark band,
  status colours), Hanken Grotesk 480 weight at −0.032em for headlines, soft 12–16 px cards, no shadows. The slide background fills the
  window; the 160 × 90 rem safe area scales with `min(0.625vw, 1.111vh)`. Illustration classes (`.p` paper, `.lb` blue line, `.soft` text
  lines, `.pop`/`.grow`/`.draw` entrances) shared by both decks.
- `public/deck/deck.js`: brand bar and footer injected into every slide (so print pages carry them), counter beside the arrows, controls hidden
  inside the chooser thumbnails, CountUp kept, packet loops removed under reduced motion.
- Fonts: `fonts/hanken-grotesk-latin-wght-normal.woff2` + OFL licence (from `@fontsource-variable/hanken-grotesk` 5.3.0); Plus Jakarta Sans removed.
- The company deck's two charts and two diagrams are generated from the demo numbers by a scratch script (bar heights exact, one y-axis,
  `<title>` per bar); the committed file is plain HTML as before. Palette for the two-series bank chart = the app's validated chart-1/chart-2
  (dataviz validator: all checks pass, CVD ΔE 30.6).
- **Firm deck (17):** cover · end-of-month pain · Sumber → Buku Besar → Laporan with who does what · Papan kantor · statement proof with a
  3.200.000 gap · Kelengkapan + request message + upload link · AI review funnel (182 rows: 177 without AI, 5 to review) · what is sent to AI ·
  trace · accrual registers (PSAK 216/116/219/109, Persediaan, Piutang & Utang) · close (fail fixed, review explained, three sign-offs) · report
  packs · PT and owner in one worksheet · client apps stay, Buku reads their output · what changes in the office + first month · what Buku
  does not do · start with one client and one month, with the timestamps Buku records itself.
- **Company deck (14):** cover · the owner's three questions · how it works · send files from a phone · management report (laba, margin, kas,
  approved note) · company vs owner money · bank pack (12-month Mutasi vs Omzet) · trace an expense · tax booked vs paid · review that learns ·
  locked months with reopen log · who can open the books and what goes to AI · fit / no fit · try one month with your accountant.

## Review rounds
1. **Own visual pass (all 40 slides of the old and current decks at 1440×900).** The old deck works because of its grammar (one idea, three
   short points, one picture, air); kantor/perusahaan were dense app screens with 60–150 words a slide and cramped type. Rebuilt; then fixed
   collisions found in screenshots: cover badge, chat bubble, board/phone overlap on Kelengkapan, funnel legend, `baris 87` tag, report fan,
   connector diagram on the apps slide, invisible text on the company cover, bank chart clipped, overflowing bins.
2. **Independent sales/copy review** (agent, read-only). Acted on: AI-data slide moved next to AI review; cash-basis objection answered
   (accrual registers, Piutang & Utang); "what changes for your staff" slide; limits on their own slide; Tanya Buku cut from both decks (repeats
   the board; owners cannot use it); company CTA through the accountant; owner's three questions answered in order (management report with laba
   tile, owner money, bank pack); PSAK 216/219; wording (akun penyeimbang, Baca scan dengan AI, Kunci API AI, faktur penjualan, sejak awal tahun,
   tersimpan, langsung terlihat); neutral icons on pain points; bubble sides; duplicate demo rows. Kept on purpose: the app's own labels
   *tidak nyambung*, *Terkirim*, *direview* (the deck shows what the product shows); Accurate/Jurnal named as import sources (README does);
   orange second chart series (validated palette, needed to tell two series apart).
3. **Independent claims audit** (agent, against README, ADRs and code). Fixed: account names to the template chart (6100, 6120, 6190, 1190,
   1199); memory reason and merchant keys keep the legal form (CV/PT); the exact AI payload (payee key, direction, first 80 characters, client
   name and type, chart of accounts; no amounts or balances); `keyakinan rendah, cek lagi 62%` label order; Tutup buku sits in stage 2 (ADR
   0014); board labels as the app shows them; the request message and the upload link are two texts; uploads are checked after the accountant
   imports them; close rule wording; Pajak Masa is for Coretax, PPh badan an estimate; tax states *Lunas* / *Kurang setor*; Mutasi definition
   includes group transfers; cash note names both outflows; statement gap moved to the client whose board row shows it; distinct lock times.
   Hosting region (Singapore, README) added to both data slides.
4. **Final independent review** after the fixes (agent, all screenshots + phone captures). Must-fix found and fixed: chooser slide counts,
   owner transfer 97 vs 197 juta, a company headline implying owners click in the app (now: the accountant shows the source; Jejak Sumber in
   the bank pack), accounts out of order on the trace. Also fixed: *cicilan* → monthly journals, the app's own upload-link sentence, *mati sampai
   Admin menyalakannya*, *akses bisa dicabut kapan saja*, one spelling of review, Accurate/Jurnal marked as the old books, other AI features named
   on the company data slide, jargon for owners (PJAP, umpan bank), price question answered honestly (*dibahas saat demo*), card footer and
   calendar header alignment, funnel greys, a "swipe the table" hint on phones. Left as is: SVG labels are small on a 390 px phone (the deck
   is presented on a screen; the phone layout is for reading the copy).

## Verification
- Every slide of both decks screenshot-reviewed at 1440×900 after each round (four rounds), plus 1920×1080 / 1280×800 / 820×1180 / 390×844 by script.
- **Production-equivalent server** (exact `next.config.ts` rewrites and CSP): `/deck`, `/deck/kantor`, `/deck/perusahaan`, `/deck/kantor#7` at five
  window sizes: no console errors, no CSP violations, no 4xx, no requests leaving the origin; no element of any slide past the safe area or
  into the footer (automatic check); no horizontal page scroll on phones (wide tables scroll inside their card, with a hint).
- **Print:** Chromium PDF, 17 and 14 pages, one slide per page, final numbers.
- **Motion:** entrances and count-up play once per visit; nothing animates in flow mode, print or `prefers-reduced-motion` (packet loops removed).
- **Chart palette:** dataviz validator on `#2152E8,#E0592A` (light): all checks pass.
- **Not run locally:** `npm run lint/typecheck/test/build/verify:books/test:e2e`: `npm ci` still fails in this sandbox (`cdn.sheetjs.com` 403).
  Only static files under `public/deck` and this doc changed; CI runs the full gate.

## Ship Notes
- Branch `claude/laughing-planck-86em2x` (the session's assigned branch). Early commits carry co-author trailers that AGENTS.md §8 does not
  want; a history rewrite to remove them was blocked by the sandbox, so later commits and the PR body omit them.
- Follow-up for the app (not in this PR): the app and README still label fixed assets and employee benefits *PSAK 16* / *PSAK 24*; since 2024
  they are PSAK 216 / PSAK 219 (the decks use the new numbers). README line 46 still says "plug to 3200" (ADR 0012 replaced it).
