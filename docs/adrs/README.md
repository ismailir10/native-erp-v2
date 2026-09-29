# Architecture decisions

One file per decision: context → decision → consequences. Supersede, don't edit history.

| ADR | Decision |
|---|---|
| [0001](0001-stack.md) | Next.js 16 + Prisma 7 + Postgres (Neon in prod), local-first |
| [0002](0002-money-and-ledger.md) | BigInt Rupiah, single journal writer, GL-derived reports |
| [0003](0003-hybrid-ai.md) | Hybrid classification; OpenAI-compatible LLM last, never auto-posting |
| [0004](0004-wedge-and-scope.md) | Wedge = accounting firms, statement-driven close; what the MVP leaves out |
| [0005](0005-synthetic-demo-data.md) | Synthetic, deterministic demo data seeded through the real pipeline |
| [0006](0006-ledger-input-and-multicurrency.md) | Ledgers + Neraca as input, per-entity source accounts, functional currency per entity (updates 0002, 0004) |
| [0007](0007-evidence-workspace.md) | Versioned evidence beside the ledger, read-only Drive, cited answers and shared AI budgets |
| [0008](0008-one-workspace.md) | One workspace: production holds the real firm; staging is synthetic pre-production (staging part superseded by 0011) |
| [0009](0009-ai-in-the-close.md) | AI in the close: deterministic sanity controls first; AI explains and proposes with citations, never posts |
| [0010](0010-supabase-platform.md) | Supabase platform: email + password login, members with roles, who-did-what |
| [0011](0011-main-only-releases.md) | Merge to main directly; Vercel builds production only; staging frozen (supersedes part of 0008) |
