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

- [ ] **Grammar of the original deck:** one idea per slide, headline + at most three short points on the left, one picture on the right; dark
  opening and closing slides; the picture carries the point (line-art illustration or a clean product mock, never a full app screen).
- [ ] **Ramp-style tokens, same as the app restyle:** warm canvas, near-black ink, one strong blue for emphasis, pale-blue tiles, dark band
  `#1A1919`, soft corners, flat (no shadows, gradients, glows). Hanken Grotesk (OFL, vendored woff2) replaces Plus Jakarta Sans.
- [ ] **No slop:** no aurora/gradient/shiny text, glow, marquee, uppercase monospace labels, label-above-headline, emoji or stock art.
- [ ] **Full window, not letterboxed:** the background fills the window; content scales in a 16:9 safe area.
- [ ] **Sales story per audience:** firm deck (16 slides) and company deck (15 slides) each go pain → how it works → proof slides →
  objections (existing tools, AI, data) → limits → how to start. The company deck shares no picture with the firm deck except the brand.
- [ ] **Honest content:** only what Buku does today (README, ADRs, cycle docs); demo numbers consistent across slides and labelled
  *data demo sintetis* or *ilustrasi*; limits slide kept; no prices, customers, testimonials or time-saved figures.
- [ ] **Presenting and reading:** arrows / space / swipe / `#n` / `F`; one scroll below 900 px or portrait; print = one slide per page;
  `prefers-reduced-motion` and print show the final state; CSP-equivalent server shows no console or CSP errors.
- [ ] **Chooser `/deck`** restyled to match, with live thumbnails.
- [ ] **Review loop:** at least three full review rounds (sales/copy, visual, claims) with findings and fixes recorded below.

**Non-goals:** app code, the restyle itself, pricing, contact forms, analytics, bilingual copy, naming competitors.

**Assumptions**
1. ADR 0014 stands: firms are the buyer, companies reach Buku through a firm or their in-house accountant; owners receive reports, access
   is Admin/Akuntan by invitation.
2. The Ramp restyle lands; if it changes a token value before merge, the deck follows in a later small PR.
3. Right Jet logo, email and colours are still unavailable: text wordmark and `right-jet.com` only.

## Tasks
- [ ] T1 Engine + styles: `deck.css` v4 (tokens, type, layout, illustration classes, motion, flow, print), `deck.js` (full-bleed scaling,
  injected chrome), Hanken Grotesk vendored, Plus Jakarta Sans removed — accept: a test slide renders at 1440×900, 1920×1080, 390×844.
- [ ] T2 Firm deck (16 slides) — accept: every slide screenshot-reviewed at 1440×900 and 390×844.
- [ ] T3 Company deck (15 slides) — accept: same.
- [ ] T4 Chooser restyle — accept: thumbnails render, CSP-equivalent server clean.
- [ ] T5 Review rounds 1–3+ (sales story, visual craft, claims audit by an independent reviewer) and fixes — accept: findings listed and closed.

## Implementation

## Verification

## Ship Notes
