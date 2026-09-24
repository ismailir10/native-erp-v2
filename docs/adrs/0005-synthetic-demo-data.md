# 0005 — Synthetic, deterministic demo data through the real pipeline (2026-09-24)

**Context.** The chickin/belifi material is real client data (NDA, UU PDP) and the chickin folder isn't readable by the session's Drive connector anyway.

**Decision.** A seeded-PRNG scenario generator modelled on those shapes (poultry agritech PT + owner, intercompany 1190, clearing 1199, BCA/Mandiri/BRI) writes statement files in each bank's format; the seed imports them through `importStatement()` and simulates the accountant's reviews; `verify:books` recomputes every balance from the generator's truth.

**Consequences.** The demo exercises exactly the code a customer would, is reproducible to the rupiah, and doubles as the strongest regression test we have. Real statements can later be imported through the same UI without code changes.
