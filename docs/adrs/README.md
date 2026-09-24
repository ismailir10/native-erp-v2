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
