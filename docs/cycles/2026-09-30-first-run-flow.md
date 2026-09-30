# First-run flow — one obvious path from "Tambah klien" to "Tutup buku"

## Context
Syaukani (tester) said the flow is confusing. Audit of what an admin or accountant meets on their first client, tracing the
code and the e2e walks (`e2e/real-client.spec.ts`):

1. **The app sends people through the steps in the wrong order.** `ClientForm` redirects a new client to **Saldo Awal**
   (`components/app/client-form.tsx`, the `router.push(.../opening)`), and Saldo Awal says "Isi saldo awal … Tanpa saldo awal, saldo
   bank tidak akan cocok". But the bank opening is *prefilled from the imported statement* (`lib/opening.ts` `statementOpening`), so
   on a fresh client the form is blank and the user must invent numbers. The e2e says it outright: "Import first so Saldo Awal can
   prefill from the statement", then clicks *Impor Mutasi* by hand.
2. **Three places give three different "next" answers.** Client Ringkasan (`clients/[id]/page.tsx`) says Saldo Awal → Impor →
   Review → Tutup; the import page ends its result with Review/Tutup Buku and never mentions Saldo Awal; Beranda's task list
   (`lib/workspace/index.ts`) says "Lengkapi buku bulan ini" for a client with nothing at all. No page shows *where you are* in the
   journey or how many steps are left.
3. **The first steps are buried.** *Impor Mutasi* and *Saldo Awal* live in the sidebar group "Impor & pengaturan klien", collapsed
   by default and listed after ten accounting pages, next to Kurs and Aturan klasifikasi.
4. **Dead ends.** A posted ledger/Neraca import ends "Cek Neraca Saldo per akun sumber" with no button toward review or close.
   Beranda's NextStep ("N pekerjaan menunggu. Mulai dari daftar di bawah.") makes the user find the task themselves.
5. **Import page tabs** ("Rekening koran" / "Buku besar / neraca") don't say which file goes where; a first-timer guesses.

Who feels it: any accountant or admin setting up a client for the first time; the investor demo.

Roles: `FirmMember` ADMIN and AKUNTAN can both create clients, import and post openings; only the AI key page is admin-only and it
is optional (rules-only works). So there is one journey, not two; we do not add a role fork.

## Spec
Principle: **one ordered journey, computed once, shown everywhere.** *Unggah data → Saldo awal → Review → Tutup buku.*

- [ ] **S1 One source of truth.** `lib/setup-progress.ts` derives, from the DB only (no stored state), the ordered steps for a
      client — `import`, `opening`, `review`, `close` — each `done | current | todo`, plus the single next action `{text, href, cta}`.
      Rules: import done when the client has a statement import or a posted ledger import; opening done when every entity has an
      OPENING or IMPORTED journal (entities of a posted ledger import count as done); review done when no bank row is
      NEEDS_REVIEW; close done when the selected period is LOCKED. First not-done step is `current`. A period with a missing
      bank statement (existing `bank:` control) keeps pointing to Impor.
- [ ] **S2 Client Ringkasan** shows a compact 4-step strip (done ticks, current step highlighted, each a link) above the stats
      while the client isn't fully set up or the period isn't closed, and its `NextStep` comes from S1. The hand-rolled
      if/else chain is deleted.
- [ ] **S3 New client lands on Impor**, not Saldo Awal (ledger-only clients keep `import?tab=ledger`). `/clients/new` copy says
      "Setelah itu Anda diarahkan ke Impor: unggah rekening koran pertama."
- [ ] **S4 Impor page** shows the strip and a NextStep from S1 ("Langkah 1 dari 4 …"). The result panel's single primary CTA
      follows S1: pending Saldo Awal → "Isi saldo awal"; else Review; else Tutup Buku. Tabs say what goes where: "Rekening koran
      (PDF, CSV, Excel bank)" / "Neraca atau buku besar (sistem lama)". A posted ledger import ends with a CTA to the next step.
- [ ] **S5 Saldo Awal page** with no statement imported yet says so first: "Unggah rekening koran dulu — saldo bank terisi
      otomatis dari sana" with CTA Impor; the form stays usable ("atau isi manual di bawah"). Once imported, the NextStep is the
      existing "Isi saldo awal …". Strip shown.
- [ ] **S6 Sidebar in workflow order.** Under the client, the order is Ringkasan · Impor Mutasi · Saldo Awal · Review transaksi ·
      Buku Besar … · Tutup Buku. The collapsed group is renamed "Pengaturan klien" and keeps Jurnal Penyesuaian, Kurs, Aturan
      klasifikasi.
- [ ] **S7 Beranda** tasks for a client still in setup name the step ("Mulai {klien}: unggah rekening koran", "Isi saldo awal
      {entitas}") and link to it; the Beranda/Pekerjaan `NextStep` gets a CTA to the first task.
- [ ] **S8 Docs + tests.** `ui-rules` gains rule 14 (first-run order = S1; every setup page shows the strip); unit/db test for S1
      across the states; e2e `real-client` walks create → Impor → Saldo Awal → Tutup Buku by following the on-screen CTAs only.

**Non-goals:** no schema migration, no new dependency, no AI use, no accounting-invariant change; no wizard/modal or forced
gating (every page stays reachable, the order is guidance); no role-specific onboarding; no redesign of Review/Close; no
change to what Saldo Awal posts. Merging the Beranda and Pekerjaan pages is out of scope (noted for later).

**Assumptions:**
1. "First steps" = create client → upload → Saldo Awal → review → close (the whole first month), not only the upload.
2. Import "done" = at least one file imported for the client; per-account/month gaps stay the job of the existing
   `Rekonsiliasi` control, so an owner entity with no file does not block progress.
3. Saldo Awal after Impor is the recommended order (prefill), but the manual form stays available before it.
4. Six e2e specs that wait for `/opening` after creating a client are updated to the new landing page; `investor-demo`'s
   sidebar click on the collapsed group is updated to the renamed group (only for Jurnal Penyesuaian).

## Tasks
- [ ] T1 `lib/setup-progress.ts` + db test — accept: states brand-new → import; +statement → opening; +opening → review (when rows) → close; ledger import posted → opening done; locked → close done.
- [ ] T2 Ringkasan strip + NextStep from T1 (`components/app/setup-steps.tsx`, `clients/[id]/page.tsx`) — accept: chain deleted, strip renders 4 steps. Depends T1.
- [ ] T3 New client → Impor; copy; update the six e2e specs — accept: `npm run test:e2e` specs pass. Depends T1.
- [ ] T4 Impor page strip + NextStep + result CTA + tab labels + ledger-posted CTA — accept: result CTA order pending-opening → review → close. Depends T1, T2.
- [ ] T5 Saldo Awal "no statement yet" NextStep + strip — accept: fresh client shows Impor CTA; after import shows the fill message. Depends T1, T2.
- [ ] T6 Sidebar reorder/rename + `investor-demo` selector — accept: Impor Mutasi and Saldo Awal visible without expanding anything.
- [ ] T7 Beranda tasks + NextStep CTA (`lib/workspace/index.ts`, `page.tsx`, `work/page.tsx`) — accept: fresh client task reads "Mulai …: unggah rekening koran". Depends T1.
- [ ] T8 `real-client` e2e follows CTAs; `ui-rules` rule 14; README onboarding row — accept: full gate green.

## Implementation
## Verification
## Ship Notes
