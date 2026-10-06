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
- [ ] **`UploadLink`** (migration), per client:
  - the firm and client;
  - an `EvidenceIntake` the files land in, created with the link and named "Kiriman klien · <date>";
  - `tokenHash`: sha256 of a 32-byte random token, base64url;
  - `expiresAt`, `revokedAt`, `createdById`, `lastUsedAt`, and the count of files received.

  The token is shown once, when the link is made, and never stored.
- [ ] **Making and revoking** (any firm member, firm-scoped):
  - The data request card gets *Buat tautan unggah*. The link is valid for 14 days (7 or 30 can be chosen) and is added to the
    drafted message.
  - Active links are listed on the import page with their expiry, the files received and the last upload, each with *Cabut*.
  - Both actions are audited (`UPLOAD_LINK`).
- [ ] **Public page `/kirim/<token>`**: outside the app layout, with no login and no session.
  - It shows only the firm's name and the client's name, then a file picker.
  - Accepted files: PDF, CSV, XLS and XLSX, 10 MiB each. At most 50 files per link, within the inbox's 100 MiB.
  - Chunked upload (1 MiB parts: the Vercel request limit) through `POST /kirim/<token>/upload`, with actions `begin`, `append` and
    `finish`. Each call checks the token and that the upload belongs to the link's inbox.
  - Afterwards it lists what was received in this browser session only, never the earlier files.
  - An expired, revoked or unknown link shows one page: "Tautan ini tidak berlaku lagi. Minta tautan baru ke kantor akuntan Anda."
    The status is 404, with the same text for every case.
  - Headers: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`. No third-party resources.
- [ ] **On the firm side** the files are in Dokumen under the client's *Kiriman klien* collection, and the import page says "N file baru
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
- [ ] T1 `lib/upload-links.ts`: create (token + hash + intake), resolve (valid or null), revoke, list; and the upload guard reusing
  `beginUpload` / `appendUpload` / `finishUpload`. DB tests: expired, revoked or unknown resolves to null; an upload into another inbox is
  refused; the per-link file cap holds; duplicate files collapse.
- [ ] T2 Public page + upload route + client uploader. Accept: e2e uploads a CSV through a fresh link, sees it received, and the firm
  sees it in Dokumen; a revoked link shows the invalid page.
- [ ] T3 Firm side: create in the data request card (link added to the message), list and revoke on the import page, "N file baru".
  Accept: e2e above.
- [ ] T4 Gates.

## Implementation
## Verification
## Ship Notes
