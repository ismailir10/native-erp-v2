# 0004 — Wedge: accounting firms, statement-driven close (2026-09-24)

**Context.** Rillet's moat (US SaaS ASC 606 rev-rec, Stripe/Salesforce integrations) doesn't transfer: Indonesia has few SaaS companies, and SME bookkeeping is crowded (Jurnal/Mekari, Accurate, Kledo, Zahir — all manual-entry). There is no usable open-banking feed (SNAP BI access is limited), so statements *are* the integration.

**Decision.** ICP = accounting/tax firms serving many SME clients. Core loop = import rekening koran → auto-code → review → traceable TB/FS incl. PT + owner combined → controlled close. Light tax (PPN/PPh tags + estimate card). UI Bahasa only.

**Out of MVP:** auth/roles, PDF statement extraction (**next priority** — firms mostly receive PDFs), e-Faktur/Coretax, AR/AP invoicing, FX, bank API feeds, true SAK consolidation (parent–subsidiary), deploy.
