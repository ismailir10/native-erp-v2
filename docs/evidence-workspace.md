# Dokumen: authenticated workspace

## Workflow
1. Open **Dokumen → Tambahkan dokumen** from Beranda or a client's sidebar. Upload multiple files or connect Google once and paste a folder URL.
2. Leave the workspace open while it inventories and reads files. **Jeda** stops after the active step. Reopening automatically resumes pending work; **Lanjutkan pemeriksaan** resumes a manual pause. Progress and errors survive refreshes.
3. Inspect excluded backups, unsupported files, and overlapping sources. Expanding a file shows per-sheet/source roles, currency and period. No filename, “final” suffix, or timestamp establishes authoritative accounting evidence.
4. Ask questions immediately: `Bandingkan Revenue`, `Cari perjanjian pinjaman`, `Profil perusahaan`, `Dokumen apa yang masih kurang?`. With a linked client, query balances, transactions, and reconciliation controls. Answers identify uploaded evidence versus live books and link their sources.
5. Confirm the proposed client/entities, or link an existing client. Confirm source roles and coverage. Choose a bank account for bank evidence. Ledger handoff opens the existing draft checks/mapping screen. Bank handoff previews rows before the separate **Konfirmasi dan catat mutasi** action.
   - Only sheets the ledger import can read (date + account + debit/credit, or account + balance) are proposed as **Sumber pencatatan**. Engine, TB, mapping and control sheets in the same workbook stay Pembanding/Konteks, whatever they mention.
   - A ledger with an entity column (e.g. SKP / CSP / CAH) offers **Sesuai kolom Entitas di file**: every label must equal a client entity's short or full name, all in one currency; overlap is checked per entity. A single label picks that entity.
   - A Neraca asks for one **Tanggal neraca**. If the file states a date it must match; a date in prose ("Closing 31 Dec …") is never used.
   - Each sheet shows at most five issues; per-cell findings (formulas without saved results, invalid dates) are one line with a count and examples.
6. Use **Periksa pembaruan** for the same Drive folder. Unchanged content reuses extraction. Old versions and answers remain traceable. Source changes never rewrite books. To re-read a file with a newer extractor (for example after this handoff change), add the folder as a **new collection** and link the existing client.

Company facts remain proposals until confirmed. Confirmed context from included older versions survives refresh with a visible source warning; differing new proposals remain conflicting until reviewed. Excluding a document removes its facts from analysis without deleting the audit history. Missing/conflicting information is visible. **Minta usulan konteks AI** sends bounded text passages to the configured AI provider; it does not post or approve facts. Uploaded text may contain mistakes or instructions; quoting a source does not validate it.

## Supported input and limits
Text PDFs (including password-protected PDFs), XLSX, CSV, Google Docs/Sheets, TXT, Markdown. Google Docs export to text; Sheets export to XLSX. Scanned PDFs, images, Word, PowerPoint, and legacy XLS need supported exports. PDF passwords are not persisted.

Defaults: 10 MiB/file, 100 MiB retained snapshots plus pending uploads/intake, 500 discovered files, 20 folder levels; uploads use 1 MiB chunks. Old versions count toward storage. Evidence PDFs stop at 300 pages or 100,000 text items. Extracted content also has row/text/decompression limits and reports truncation. Conflict review stops at 10,000 comparisons, 500 conflicts or 5,000 facts and stays visibly incomplete. Large/partial folders must be split into smaller intakes. Google export limits can reject an otherwise valid native file.

Structured monetary figures require known source currency, scale, date and unambiguous labels/values. Multi-column or ambiguous layouts remain cited text instead of guessed comparisons. Missing formula caches are unresolved, never treated as zero by evidence extraction. Scaled statements cannot enter bookkeeping until exported in full units. Foreign-currency bank files remain evidence; existing bank posting supports IDR.

## Deployment
Apply committed migrations and configure [invitation-only access](../README.md#invitation-operations) before rollout. Both staging and main serve the same authenticated workspace, with separate users, data and credentials.

- `EVIDENCE_ENABLED=true` enables documents in both environments; explicit `false` is an operational kill switch. `DEMO_MODE` controls synthetic fixture availability, not authentication or document UI.
- Retain additional Vercel protection on staging. Real client files belong in production (the one workspace) or local only, per [real-data policy](real-data.md) and [ADR 0008](adrs/0008-one-workspace.md).
- Dashboard scope filters collections by client; company selection requires confirmed current evidence selections. Collections can span periods, stated in the UI. Questions and reports retain the chosen period.
- Large private intakes show progress counts and searchable pages of 20 files. Sheet review forms mount only when their document is expanded; questions remain above the file list. Loose code/tooling files are ignored on inventory refresh. Invalid Excel date cells show their coordinates for repair while other workbook content remains available.
- Google: configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. Fixed callback path: `/api/google/callback`; HTTPS except localhost development. Enable Drive API in the Google project and register the exact redirect URI/consent users.
- Existing `ADMIN_PASSCODE` controls connect/disconnect, and `SETTINGS_SECRET` encrypts refresh tokens. A token saved under another `SETTINGS_SECRET` shows "Koneksi Google perlu dihubungkan ulang oleh admin." — reconnect. A failed callback returns `?google=error&reason=` `scope` (Drive box not ticked), `invalid_client` (client ID/secret/callback mismatch), `no_refresh_token`, `denied`, `state` or `config`, logs only `google oauth callback failed: <reason>`, and Dokumen names the fix. Google OAuth requests `drive.readonly`; credentials never reach browser responses. Reconnect after revoked/expired consent. An OAuth testing project may require periodic reconnection.
- Configure the existing AI provider through Pengaturan. No key means deterministic extraction/search/reports remain available. Tests and seeds use mocks; never place a real key in the disposable test database.

Google's restricted-scope verification/security requirements must be addressed before public distribution: https://developers.google.com/workspace/drive/api/guides/api-specific-auth. Workspace reads and actions resolve the firm from the invited user session.

AI calls reserve a conservative upper bound under a firm lock before contacting the provider, then settle actual usage. Interrupted/unknown-billing calls keep their reservation to avoid overspend. Monthly configuration remains `AI_MONTHLY_TOKEN_BUDGET`; evidence limits are 20,000 tokens/intake and 12,000/question. Evidence calls (context proposals, question planning) may take 90 s before Buku aborts them; classification and account mapping keep 30 s. Exhaustion leaves source work intact for manual review. No automatic paid retry loops.

## Verification and rollback
Run normal repo gates, then the evidence E2E against a disposable local database with `EVIDENCE_ENABLED=true DEMO_MODE=false AI_API_KEY='' AI_MODEL=''`. Tests upload invented companies/figures, never client files. Real data stays local or in production (the one workspace); do not copy it into fixtures or PR screenshots.

Rollback: turn off `EVIDENCE_ENABLED`, then revert application changes if needed. Keep additive evidence tables and source snapshots for audit; existing bookkeeping does not depend on them. Preserve `SETTINGS_SECRET` while retained connection tokens exist.

## Synthetic screenshots
[Desktop workspace](demo/evidence/evidence-workspace-desktop.png) · [Mobile workspace](demo/evidence/evidence-workspace-mobile.png) · [Exact source on desktop](demo/evidence/evidence-source-desktop.png) · [Exact source on mobile](demo/evidence/evidence-source-mobile.png). These images contain invented company names and figures.
