# 0003 — Hybrid classification; LLM last, cached, never auto-posting (2026-09-24)

**Context.** "AI-native" is the pitch, but LLM credit is limited, the sandbox cannot reach the provider, and self-reported LLM confidence is not trustworthy enough to write to a client's books.

**Decision.** Transfer matcher → rules → memory → LLM → heuristic. LLM = any OpenAI-compatible `/chat/completions` (OpenCode Zen by default, model from env), called outside DB transactions, one question per unique merchant key, ≤40 per call, cached forever, capped per import and per month, output whitelisted against the COA. AI suggestions land in suspense (1999) for review; reviewer decisions train Memory.

**Consequences.** Demo and tests run with zero credit (MockProvider + pre-cached answers). Month-over-month the share coded without AI rises (66% → 91% in the demo) — a real unit-economics story. Swapping model/gateway is config.
