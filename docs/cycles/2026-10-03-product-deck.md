# Public product deck

## Context
Buku has no public pitch surface: every route is behind Supabase auth (`proxy.ts`), and the only sales material is the login blurb and the
internal investor script. Right Jet needs a link it can send to other accounting firms (and other companies) that explains Buku in minutes,
looks like a product worth paying for, and exposes nothing private.

## Spec
Approval: the owner approved the plan in-session (Bahasa Indonesia, presenter mode with scroll fallback, static `public/deck/`, illustration-led,
dark hero and closer, "Buku by Right Jet", competitor positioning by category, roadmap).

- [x] **A public deck at `/deck`** — no login, no cookies, no network requests to third parties. Bahasa Indonesia.
- [x] **Presenter mode:** arrows / space / PageUp / PageDown / swipe / dots, progress bar, `#n` deep links, `F` for fullscreen.
  Below 768 px it reads as one vertical scroll with the same sections.
- [x] **Illustration-led:** every slide has a hand-built SVG illustration or an HTML/CSS product mockup built from invented data
  (labelled "data demo sintetis"). No stock art, no real client, no real bank logos.
- [x] **React Bits-style motion**, re-implemented in vanilla JS/CSS/canvas: aurora hero, dot grid, split-text reveal, shiny text,
  count-up, spotlight cards, marquee. Plays once per slide entry; `prefers-reduced-motion` renders everything static.
- [x] **Honest content:** only things Buku does today (README / ADRs). No invented metrics, customers, testimonials or certifications.
  Competitors compared by category, never named. A roadmap slide with honest limits.
- [x] **Branding:** "Buku by Right Jet" and a link to right-jet.com. No email, phone or logo that was not supplied.
- [x] **Auth proxy** lets `/deck` through; the rest of the app stays gated. `/deck` is served with a strict CSP.

**Non-goals:** editing the authenticated app, a CMS, analytics, a form that collects contact details, bilingual copy, pricing.
**Assumptions:**
1. Right Jet's logo, email and colours were not reachable from the sandbox, so the closing slide uses a text wordmark and the domain link only.
2. React Bits is React-only; its effects are ported to vanilla JS so the deck needs no build step and no new dependency.
3. Inter is vendored from the existing `@fontsource-variable/inter` dependency so the deck makes no font requests to Google.
4. The public URL exists once `main` deploys (Vercel deploys `main` only); I do not invent one.

## Tasks
- [x] T1 Open `/deck` to the public: proxy matcher + rewrite + headers — accept: `/deck` returns 200 without a session, `/` still redirects to `/login`.
- [x] T2 Deck shell: tokens, slide engine, navigation, scroll fallback — accept: all slides reachable by keyboard, swipe, dots and hash.
- [x] T3 Effects: aurora, dot grid, split text, shiny text, count-up, spotlight, marquee, draw-in — accept: reduced-motion shows a static deck.
- [x] T4 Slides 1–7 with illustrations — accept: screenshots at 1440×900 and 390×844 reviewed.
- [x] T5 Slides 8–13 with illustrations — accept: same.
- [x] T6 Privacy sweep + browser verification — accept: no private strings, no third-party requests, no console errors.

## Implementation
- `public/deck/{index.html,deck.css,deck.js}` — 14 slides, no build step, no dependencies. Inter is vendored from the existing
  `@fontsource-variable/inter` package (`fonts/`, with its licence). Slides: hero, masalah, solusi, impor, AI, penelusuran, laporan,
  PSAK, tutup buku, Tanya Buku, multi-klien/mata uang, kepercayaan, posisi, batasan + CTA.
- Illustrations are inline SVG (duotone navy/blue, shared `#sheet` symbol); product mockups are HTML/CSS with invented data and are
  labelled "data demo sintetis" / "ilustrasi".
- Effects ported to vanilla JS: split-text reveal, shiny text, count-up, spotlight, magnet, marquee, dot-grid + aurora canvas
  (paused off-screen, static under `prefers-reduced-motion`).
- `proxy.ts` matcher skips `/deck`; `next.config.ts` rewrites `/deck` → `/deck/index.html` and sets a same-origin-only CSP on `/deck/*`.
- Roadmap: the repo has no committed roadmap, so the last slide states today's honest limits (from the README/ADRs) and a proposed
  start path (demo → one-client pilot → portfolio) instead of dated promises.
- The Right Jet logo, email and colours were not reachable from the sandbox: text wordmark + domain link only.

## Verification
Run in a scratch copy of the repo (see the sandbox note), plus the browser pass on the static files:
- **Serving (Next 16.3 dev server):** `/deck` 200 without a session; `/deck/deck.js|deck.css|favicon.svg|fonts/*.woff2` 200 with the CSP and
  `nosniff`; `/deck/` redirects to `/deck`. Found and fixed while testing: relative asset URLs 404 at `/deck` (no trailing slash), so the
  page now references `/deck/…` absolutely.
- **Proxy matcher:** `/deck`, `/deck/`, `/deck/deck.js` bypass it; `/`, `/login`, `/clients/1/ledger` and a look-alike `/deckhand` still go
  through it.
- **Browser (Chromium, 1440×900 and 390×844):** all 14 slides reviewed from screenshots; arrows, Home/End, dots and `#9` deep link work;
  800×390 switches to the scroll layout; no horizontal scroll on mobile; `prefers-reduced-motion` renders a static deck; no console errors
  or CSP violations; the only requests are same-origin.
- **Privacy sweep:** no private names, env keys, project names, emails or competitor names in `public/deck`; the only external URL is
  `https://right-jet.com`.
- **Gates:** `eslint proxy.ts next.config.ts` clean, `tsc --noEmit` has no errors in the changed files.
- **Not run:** `npm test`, `npm run build`, `verify:books`, `test:e2e`. This sandbox cannot install the repo's `xlsx` dependency
  (`cdn.sheetjs.com` is blocked by the egress proxy) and the change touches no ledger, report or app code; CI runs the full gate.

## Ship Notes
