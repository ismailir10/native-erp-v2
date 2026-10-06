# I1d — Tautan unggah klien (client upload link without an account)

## Context
ADR 0014 I1 asks for "one upload inbox plus a client upload link that needs no account". Today the client sends files over WhatsApp
or email, and the accountant downloads them and uploads them again into Buku. Both pieces of the inbox already exist:
- I1c drafts the request for data.
- Dokumen (`lib/evidence`) is the firm's inbox. It takes chunked uploads (10 MiB per file, 100 MiB per collection), reads each file,
  proposes the bank, account and period, and imports through the deterministic parsers.

What is missing is a way for the client to drop files straight into that inbox.

Stage: **Sumber**. Security decision taken under "get them done" (2026-10-06), conservative by default:
- upload only;
- a secret link per client that expires and can be revoked;
- the client sees nothing of the books;
- every file lands in the firm's review inbox and nothing is imported or posted by the upload.

## Spec
- [x] **`UploadLink`** (migration), per client:
  - the firm and client;
  - an `EvidenceIntake` the files land in, created with the link and named "Kiriman klien · <date>";
  - `tokenHash`: sha256 of a 32-byte random token, base64url;
  - `expiresAt`, `revokedAt`, `createdById`, `lastUsedAt`, and the count of files received.

  The token is shown once, when the link is made, and never stored.
- [x] **Making and revoking** (any firm member, firm-scoped):
  - A *Tautan unggah klien* card on the import page has *Buat tautan unggah*. The link is valid for 14 days (7 or 30 can be chosen)
    and is shown once, with *Salin* and *Kirim lewat WhatsApp*.
  - Active links are listed on the import page with their expiry, the files received and the last upload, each with *Cabut*.
  - Both actions are audited (`UPLOAD_LINK`).
- [x] **Public page `/kirim/<token>`**: outside the app layout, with no login and no session.
  - It shows only the firm's name and the client's name, then a file picker.
  - Accepted files: PDF, CSV, XLS and XLSX, 10 MiB each. At most 50 files per link, within the inbox's 100 MiB.
  - Chunked upload (1 MiB parts: the Vercel request limit) through `POST /kirim/<token>/upload`, with actions `begin`, `append` and
    `finish`. Each call checks the token and that the upload belongs to the link's inbox.
  - Afterwards it lists what was received in this browser session only, never the earlier files.
  - An expired, revoked or unknown link shows one page: "Tautan ini tidak berlaku lagi. Minta tautan baru ke kantor akuntan Anda."
    The status is 404, with the same text for every case.
  - Headers: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`. No third-party resources.
- [x] **On the firm side** the files are in Dokumen under the client's *Kiriman klien* collection, and the import page says "N file baru
  dari klien" with a link to it. Reading, sorting and importing stay the accountant's clicks, as today (ADR 0014: AI proposes,
  arithmetic proves, the accountant approves).

**Non-goals:**
- client accounts;
- the client seeing earlier uploads or any report;
- notifications by email or WhatsApp API;
- virus scanning beyond the type and size checks;
- images and photos (I2 OCR).

**Gate-reopeners:**
- one migration (`UploadLink`);
- a public route outside the login. Both are justified above and limited to writing files into one inbox.

**Assumptions:**
1. A secret URL is the standard trade-off for clients who will not create an account. Making it expire, be revocable, upload-only
   and per-client bounds the damage of a leaked link to unwanted files in one review inbox.
2. 50 files and 100 MiB per link cover a month of statements and ledgers for a small group.

## Tasks
- [x] T1 `lib/upload-links.ts`: create (token + hash + intake), resolve (valid or null), revoke, list; and the upload guard reusing
  `beginUpload` / `appendUpload` / `finishUpload`. DB tests: expired, revoked or unknown resolves to null; an upload into another inbox is
  refused; the per-link file cap holds; duplicate files collapse.
- [x] T2 Public page + upload route + client uploader. Accept: e2e uploads a CSV through a fresh link, sees it received, and the firm
  sees it in Dokumen; a revoked link shows the invalid page.
- [x] T3 Firm side: create in the data request card (link added to the message), list and revoke on the import page, "N file baru".
  Accept: e2e above.
- [x] T4 Gates.

## Implementation
- Plan: T1–T4 sequential, inline.
- T1: `lib/upload-links.ts`.
  - `createUploadLink` writes the token (32 random bytes, base64url, only its sha256 stored), the *Kiriman klien* inbox and the
    `UPLOAD_LINK` audit event in one transaction.
  - `resolveUploadLink` returns null for an unknown, expired or revoked link, a malformed token, or `EVIDENCE_ENABLED=false`.
  - `revokeUploadLink` and `uploadLinks` (the files count comes from the inbox's documents).
  - `begin/append/finishLinkUpload` wrap `lib/evidence/store`:
    - type and size checks and the 50-file cap, with pending uploads counted;
    - the upload must belong to the link's inbox;
    - at the finish, the first bytes must match the extension (`contentMatches`).
  - Migration `20261006180000_upload_links`: the inbox cascades to its link. Client delete removes the links explicitly too.
  - Test: `tests/db/upload-links.test.ts`.
- T2: the public page and its parts.
  - `app/kirim/[token]/page.tsx` uses the auth-page frame and sets `robots` noindex and referrer no-referrer.
  - `not-found.tsx` is the one invalid-link page.
  - `upload/route.ts` takes `step=begin|append|finish` and sends `no-store`, `no-referrer` and `noindex` headers.
  - `components/app/link-uploader.tsx` sends 1 MiB parts and lists this session's files only.
- T3: the firm side.
  - `createUploadLinkAction` and `revokeUploadLinkAction`. The URL uses `APP_URL`, else the request's origin, as the login emails do.
  - `components/app/upload-links-card.tsx`, on the import page when Dokumen is enabled.
  - E2e: `e2e/client-upload-link.spec.ts`.
  - Spec deviation: the link is not added to the data request text, because that card only shows when something is missing. The
    link card has its own WhatsApp message.
## Verification
- Live check on `next dev` with curl, using a link made for CV Sinar Retail:
  - `/kirim/<token>` returns 200 with the firm and client names, `<meta name="referrer" content="no-referrer">` and
    `robots noindex, nofollow`;
  - an unknown token returns 404 with "Tautan tidak berlaku";
  - begin → append → finish of a CSV returns `{"name":"bca-agustus.csv"}`, with headers `cache-control: no-store`,
    `referrer-policy: no-referrer` and `x-robots-tag: noindex`;
  - `x.exe` is refused with "Kirim file PDF, CSV, XLS atau XLSX.";
  - begin on an unknown token returns 404.

  The test intake was deleted afterwards.
## Ship Notes
- Migration `20261006180000_upload_links`: a new table. New public route `/kirim/<token>` (and `/kirim/<token>/upload`), outside the
  login. It writes only into the link's inbox.
- `EVIDENCE_ENABLED=false` closes every link.
- Rollback: revert, or revoke the links. The table can stay.
