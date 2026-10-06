# 0004 — Wedge: accounting firms, statement-driven close (2026-09-24)

**Context.** Rillet's moat (US SaaS ASC 606 rev-rec, Stripe/Salesforce integrations) doesn't transfer: Indonesia has few SaaS companies, and SME bookkeeping is crowded (Jurnal/Mekari, Accurate, Kledo, Zahir — all manual-entry). There is no usable open-banking feed (SNAP BI access is limited), so statements *are* the integration.

**Decision.** ICP = accounting/tax firms serving many SME clients. Core loop = import rekening koran → auto-code → review → traceable TB/FS incl. PT + owner combined → controlled close. Light tax (PPN/PPh tags + estimate card). UI Bahasa only.

**Out of MVP:** auth/roles, PDF statement extraction (**next priority** — firms mostly receive PDFs), e-Faktur/Coretax, AR/AP invoicing, FX, bank API feeds, true SAK consolidation (parent–subsidiary), deploy.

**Amendment (2026-09-29): receivables/payables subledger.** Pilot feedback ("ga ada modul AR dan AP") showed that a close without
*who owes what* is incomplete for a firm: 1130/2110 must be made of invoices, a receipt must say which invoice it paid, and the
aging is a standard month-end schedule. Buku now keeps a **subledger** — invoices recorded by the accountant (or from Saldo Awal),
settled by bank lines, proven against the GL at close (accounting-rules 5c). Still out: an invoicing product (creating, sending,
numbering, e-Faktur/Coretax), credit notes, reminders. Cycle: `docs/cycles/2026-09-29-receivables-payables.md`.

**Amendment (2026-10-06): see [ADR 0014](0014-three-stage-spine.md).** The out-of-MVP list above is history: auth, PDF statement
extraction, AR/AP and FX exist. The wedge stands (accounting firms; the statement is the integration). What Buku still does not do,
and the order of the next iterations, now live in ADR 0014.
