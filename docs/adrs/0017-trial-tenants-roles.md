# 0017 — Trial access, many organisations, four roles

**Status.** Proposed, 2026-10-09 (cycle [trial-tenants-roles](../cycles/2026-10-09-trial-tenants-roles.md)). Becomes Accepted when that cycle ships.
Updates [0008](0008-one-workspace.md) (production is no longer one firm) and [0010](0010-supabase-platform.md) §2 (AI credentials, roles).

**Context.** Buku is in its trial phase, and prospects are accounting firms *and* companies (the two decks). Access is a CLI invitation
into one production firm. It has no end date, and there are two roles that both see every client. A second tenant also exposes that
the AI key, model and OCR switch are global settings any firm ADMIN can change.

**Decision.**
1. **Hierarchy.** Buku (platform) → organisation (`Firm`, `kind` KANTOR_AKUNTAN | PERUSAHAAN) → client → entity. A company is an
   organisation with exactly one client, which the UI hides. Books stay scoped per client, so no ledger, report or close code
   changes.
2. **Buku admins** are `PlatformAdmin` rows, created only by the CLI and resolved live per request. They work in `/backoffice` and
   see organisation metadata, never books.
3. **Access is a grant with a period.** `AccessGrant` (TRIAL | PAID | COMP, start, optional end, revocable) decides the computed
   state: ACTIVE, READ_ONLY (all grants ended: read and export, no writes, no AI) or NONE (none, revoked, or suspended). Data is
   never deleted when a trial ends.
4. **Signup is a request.** The public `/daftar` form creates a `SignupRequest`. A Buku admin's approval creates the organisation,
   its grant and the owner's Supabase invitation. Supabase self-signup stays off.
5. **Four roles.** OWNER, ADMIN, AKUNTAN and VIEWER, each mapped to capabilities in one module (`lib/auth/permissions.ts`).
   AKUNTAN and VIEWER see only the clients assigned to them (`ClientAccess`). Every server action passes one guard (access state +
   capability + client), and a test fails when an exported action does not call it.
6. **The AI key belongs to Buku.** The provider key, model and OCR switch are edited only in the backoffice. Each organisation has
   a monthly token budget.

**Consequences.** Production holds many tenants, so isolation is a tested property: DB tests across two organisations and an e2e
cross-tenant 404. The server stays the boundary; RLS remains unused. One person still belongs to one organisation, and an org
switcher is a later change to session resolution only. The deck line *Hanya lewat undangan. Dua peran* changes when this ships.
