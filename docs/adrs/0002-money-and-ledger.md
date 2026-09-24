# 0002 — Money as BigInt; one journal writer; reports derived from the GL (2026-09-24)

**Context.** The prior reconciliation work's hardest bugs were hand-typed numbers and copies of logic drifting apart ("GL = single source of truth, no hidden plugs"). Accountants will test the demo by trying to break the books.

**Decision.** Integer Rupiah `bigint` end to end; `postJournal()` is the only writer (balanced, open period, client COA) backed by DB CHECK constraints; posted entries immutable (bank-line corrections are difference-only RECLASS entries); no stored balances — TB/FS/charts/controls are computed from `JournalLine`.

**Consequences.** Reports are always consistent with the ledger and every number drills to its source. Cost: aggregate queries on read (fine at SME volumes; add materialized snapshots per locked period if needed later).
