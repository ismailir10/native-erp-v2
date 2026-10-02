# 0012 — No plug: a Saldo Awal difference is a Temuan, not Saldo Laba

**Context.** The owner's use-case document (2 Oct 2026) states the firm's standard as pass criteria: GL = source of truth, no plug,
every difference has a finding ID and a resolution. Saldo Awal broke it. `postOpening` posted whatever the typed lines didn't balance
to 3200 Saldo Laba ("penyeimbang otomatis", accounting-rules rule 5), so the real case of an old Neraca showing Kas Rp 1 M while the
statements show Rp 940 jt put Rp 60 jt into equity without a question (UC-B4, UC-C2, both marked *Gagal*). A difference that becomes a
retained-earnings figure can no longer be traced to anything.

**Decision.**
1. **The difference waits on its own account.** A Saldo Awal that doesn't balance posts the difference to **3290 Selisih Saldo Awal**
   (template equity account, FS line *Selisih saldo awal belum diselesaikan*, shown on its own Neraca line), never to 3200. Saldo Laba
   is a line the accountant types (or explicitly copies from the difference when the client has no Neraca), like any other.
2. **Temuan.** The same transaction opens a `Finding` (`T-<n>` per client): entity, date, signed amount, the question for the client,
   the entry that raised it, who. A Temuan is resolved **once**, by the accountant's written decision (≥ 10 characters) and one `OPENING`
   entry dated the Saldo Awal date that moves the entity's 3290 balance to the account the decision names, through `postJournal()`.
   The Temuan keeps the decision, the entry, who and when. Never edited otherwise, never deleted (except with its client).
3. **The GL decides the close.** Control `opening-diff:<entity>` FAILs while 3290 holds a balance at the month end, naming the open
   Temuan; it reads the GL, not the Temuan row, so a resolution reversed later fails the close again. An entity with entries but no
   Saldo Awal gets REVIEW `opening:<entity>` ("neraca dimulai dari nol"), cleared by a note.
4. **The resolution is an opening, not a flow.** Kind `OPENING` keeps it out of the cash flow and the year's movements, and doesn't
   make the opening month one that must be closed first; every reader of "the opening date" already takes the earliest OPENING entry.

**Consequences.** A new client set up from bank statements alone now gets a Temuan for its whole bank balance ("where does this equity
come from?"): the accountant answers it (Modal, Saldo Laba, a loan from the owner) before the first close. Existing 3200 plugs stay as
posted (history is not rewritten). The Neraca-import source difference (1999, rule 15a) keeps its own correction path; moving it into
Temuan, and other kinds of findings (anchor tie-outs, intercompany differences), extend this table in later cycles. Amends rule 5 of
`accounting-rules`.
