# Close-run polish: what the production close run surfaced

## Context
On 2026-10-09 two accountant-style runs in production (upload → Saldo Awal → Review → Tutup Buku on throwaway clients, see
`2026-10-09-bank-coverage.md` → Ship Notes, S9) surfaced issues outside the bank work. The accountant feels each one:

1. **AI proposes a receivable/payable that can't exist.** For PT Uji Bank (no invoices, no opening receivables or payables) the AI
   proposed *1130 Piutang Usaha* for every customer receipt and *2110 Utang Usaha* for every supplier payment, at 78–88% — high enough
   for *Terima N usulan AI yakin (≥ 80%)*. Accepting them leaves 1130 credit and 2110 debit, against the accounts' nature.
2. **Hapus klien leaves you on the deleted client.** After *Uji Bank (hapus) dihapus* the page stayed on its settings with the client
   still in the sidebar (the e2e passes locally; in production the `router.push("/")` lost to the `router.refresh()` that follows it).
3. **A typed Saldo Awal amount stays unformatted.** "800000000" typed for 3100 stays as typed, while prefilled bank lines show
   "800.000.000" (Jurnal Penyesuaian already tidies on blur).
4. **Neraca Saldo flags 1999 with a zero balance.** After every line was reviewed, *1999 Belum Terklasifikasi* still showed *Perlu dicek*.
5. **The AI budget error points to a setting that doesn't exist.** "Kuota token AI bulan ini tidak cukup; … ubah batas di Pengaturan" —
   the monthly budget is `AI_MONTHLY_TOKEN_BUDGET` (env), not a field in Pengaturan.

## Spec
- [ ] **A1** An AI suggestion of a trade receivable (fsLine `PIUTANG_USAHA`) for money in, or a trade payable (`UTANG_USAHA`) for money out,
  is demoted when the entity has nothing to settle there: the GL balance of those accounts at the line's date is not on their normal
  side (receivable ≤ 0 debit, payable ≤ 0 credit; invoices and Saldo Awal items both post there, so this covers them). Demoted =
  confidence capped at 0.55 (below the 0.8 bulk accept and the 0.6 *tebakan* line, so accepting it unchanged is a sanity REVIEW) and
  the reason says why ("Belum ada piutang usaha tercatat …"). Applied at import and on *Minta saran AI*; the cached answer is untouched
  (no extra AI call, rules 14 and 17–19 hold). Deterministic, unit + db tested.
- [ ] **A2** *Hapus klien* lands on Beranda every time (hard navigation after the toast); e2e still green.
- [ ] **A3** Saldo Awal amount fields tidy on blur like Jurnal Penyesuaian ("800000000" → "800.000.000"); unreadable text is left for its
  error message.
- [ ] **A4** Neraca Saldo shows *Perlu dicek* on 1999 only while it holds a balance (net ≠ 0), in both views.
- [ ] **A5** The budget error says what it is and who changes it: the monthly AI token limit, set by whoever runs the deployment
  (`AI_MONTHLY_TOKEN_BUDGET`); Pengaturan shows this month's use next to the limit so the number is visible before it runs out.

**Non-goals:** making the AI budget editable in Pengaturan (it's a deployment cap by design, ADR-level change); changing the AI prompt or
model; changing how 1999 is used.

**Assumptions:**
1. "Nothing to settle" is read from the GL (not from invoices alone), so a client whose receivables came in through a Neraca import is
   covered too.
2. 0.55 is the cap: under 0.6 so an unchanged accept is flagged by the existing *tebakan* sanity control.
3. No schema migration, no new dependency, no AI calls.

## Tasks
- [ ] T1 A1 guard (`lib/ai/` helper used by `pipeline.ts` and `retry.ts`) — accept: unit test of the rule; db test: import into an entity with
  no receivable → AI 1130 suggestion stored at ≤ 0.55 with the reason; with an opening receivable → unchanged.
- [ ] T2 A2 + A3 + A4 (UI) — accept: e2e delete-client lands on Beranda; opening-form tidy on blur (e2e or component test); TB 1999 badge
  only with a balance (db/page test).
- [ ] T3 A5 budget message + monthly use in Pengaturan — accept: unit test of the message; Pengaturan shows "x dari y token bulan ini".
- [ ] T4 End-of-cycle gates, Ship Notes; verify in production (Kopi Uji (hapus): run *Minta saran AI*/re-import check, delete-client).

## Implementation
## Verification
## Ship Notes
