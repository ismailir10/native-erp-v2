# 0007 — Versioned evidence beside the ledger

**Context.** A firm's folder mixes statements, ledgers, finished reports, working papers, and company context. Uploading all of them into journals counts the same activity repeatedly. Reading only the posted ledger prevents useful analysis before onboarding.

**Decision.**
- Keep source snapshots and extracted, source-reported figures in an evidence workspace. They are not derived account balances and never feed existing Buku financial reports directly. `JournalLine` remains the sole source for Buku's books.
- Each source has immutable content versions and an explicit active version. Citations pin a version and location. Refresh changes the active pointer, never historic evidence or posted journals.
- Prepare client/entity/context and document-role decisions for review. Source coverage confirmation prevents overlapping ledger/bank input; distinct bank accounts can cover the same period. Import handoff preserves existing parser, posting, locking, and review rules.
- Google OAuth is firm-managed and read-only. The pilot is gated to local/protected preview. Recursive access is limited in application code to added folders and explicitly included shortcut targets. OAuth publication requirements precede public rollout.
- Work advances in bounded, leased server steps while the workspace remains open. Completed work survives page closure; no scheduler or durable worker service is introduced.
- AI reads bounded evidence for cited context proposals and plans allowlisted read operations. Financial amounts and comparisons come from deterministic source parsing or live ledger queries. Document content is untrusted data, never instructions.
- All AI paths share atomic monthly reservations and conservative failure accounting. Client/context/model/prompt-scoped evidence caches store analysis/query plans, never stale live financial answers. Existing bank classification and account mapping keep their narrower payload rules.

**Consequences.** Evidence can answer useful questions before clients or journals exist. Unsupported layouts remain visible and searchable without invented numbers. Scans need a text export; missing formula results need recalculation; scaled statements are analyzed at their declared scale but must be supplied in full units before posting. The pilot deliberately has no OCR, Drive writes, continuous monitoring, autonomous posting, or journal-adjustment drafting.
