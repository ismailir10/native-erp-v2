# I2a — Scanned statements: AI reads, the running balance proves, the accountant imports

## Context
ADR 0014 I2: "A vision model reads scans and photos, and a row is accepted only when the running balance ties on that row. The model
never sees the expected balances. Files with no balance column go to line-by-line review. Tests use recorded extractions. A per-firm
AI switch and redaction (UU PDP)."

Today a scanned PDF or a photo is refused: "PDF ini hasil scan (tanpa teks)…". Small clients often only have these, for example a
printed rekening koran scanned at the branch, or a passbook photo.

The ADR deferred this until the real month. The owner asked for it now ("get them done", 2026-10-06).

Stage: **Sumber**.

## Spec
- [x] **Pages to images** (`lib/ocr/pages.ts`):
  - a PDF gives each page's largest embedded image (scanners embed one image per page; `unpdf` `extractImages`), encoded as PNG with
    Node's zlib;
  - JPG/PNG files go as they are;
  - at most 10 pages, each 5 MiB at most after encoding, else refused in Bahasa;
  - a PDF that has text is never sent: the existing parsers read it.
- [x] **The model transcribes, nothing more** (`AiProvider.readStatement?`):
  - Input: the page images only. The prompt asks for the account number, the period, the printed opening and closing balances, and
    every row exactly as printed (date, description, debit, credit, balance; empty when not printed).
  - The model is told never to compute, fill in or correct a number.
  - No expected balance and no earlier statement is ever sent.
- [x] **Proof** (`lib/ocr/prove.ts`, pure). The opening balance is the printed one, else the account's last imported closing
  balance, checked on the server and never sent.
  - Each row is *terbukti* when the previous balance + credit − debit = its printed balance.
  - A row without a printed balance, or one that does not tie, is *perlu dicek*.
  - The statement can be imported only when every row is *terbukti* and the last balance equals the printed closing balance (when
    printed).
- [x] **Draft and review** (`OcrDraft`, migration):
  - It holds the client, bank account, file name and hash, page count, model, the transcribed header and rows, who and when.
  - The page `/clients/[id]/import/ocr/[draftId]` shows every row with its proof state, problems first. The accountant edits the
    cells of rows that are *perlu dicek* (or adds or removes a row), and the proof re-runs on every change.
  - *Impor* is enabled only when everything ties. It builds a semicolon CSV from the rows (`Tanggal;Keterangan;Debet;Kredit;Saldo`)
    and runs it through `importStatement` like any file: the generic parser, repair, continuity, dedupe, classification and Review.
  - The file name becomes `<asli> (OCR).csv` and the import note says "dibaca AI dari scan; setiap baris terbukti oleh saldo
    berjalan".
  - Nothing posts before that click (AI never auto-posts).
- [x] **Firm switch (UU PDP)**: *Baca scan dengan AI* in Pengaturan.
  - Admin only, off by default.
  - It says that scan images are sent to the configured AI provider and that names and account numbers on them cannot be redacted.
  - Off, or no AI key: the scan error stays as today, and says who can turn the switch on.
- [x] **On the import page**: when a file is a scan or an image and the switch is on, the error comes with *Baca scan dengan AI*. It
  creates the draft (one budgeted call, cached by file hash and model) and opens the review page.

**Non-goals:**
- handwriting;
- non-IDR statements;
- passbooks without a balance column (they stay refused: no proof is possible);
- redaction;
- rendering vector-only PDF pages (no embedded image). Those are refused, with the advice to scan as an image.

**Gate-reopeners:**
- one migration (`OcrDraft`);
- no new dependency (`unpdf` and zlib already exist).

**Assumptions:**
1. Statement scans embed one raster image per page. This holds for branch and phone-scanner PDFs.
2. A model that cannot read images makes the call fail with a Bahasa message. The draft is not created.

## Tasks
- [x] T1 `lib/ocr/png.ts`, `lib/ocr/pages.ts`, `lib/ocr/prove.ts` + unit tests:
  - a PNG round trip;
  - a PDF with an embedded image yields one page image, and a text PDF yields none;
  - the proof: a tying chain, a misread amount, a missing balance, the closing mismatch, and the opening from the last import.
- [x] T2 `readStatement` (OpenAI-compatible with image parts, plus MockProvider from a recorded extraction), the `OcrDraft` migration, and
  `lib/ocr/draft.ts`:
  - `createOcrDraft`: budget, cache, switch check;
  - `updateOcrRows`;
  - `importOcrDraft`: the CSV through `importStatement`.

  DB tests: a recorded extraction with one misread row is not importable, becomes importable after the fix, then imports and posts;
  the switch off refuses; another firm's draft is refused.
- [x] T3 Switch in Pengaturan, the scan error flag, the button on the import form, and the review page. E2e: the switch is shown to
  admins and the scan error names it.
- [x] T4 Gates.

## Implementation
- Plan: T1–T4 sequential, inline.
- T1: `lib/ocr/png.ts`, `lib/ocr/pages.ts` and `lib/ocr/prove.ts`:
  - a minimal PNG encoder on `node:zlib`;
  - `pageImages`: each page's largest embedded image (via `unpdf`), JPG/PNG passthrough, at most 10 pages of 5 MiB, text PDFs refused;
  - `proveRows`, which continues from the printed balance, so one misread amount breaks one row only;
  - test: `tests/unit/ocr.test.ts`.
- T2: the transcription and the draft.
  - `lib/ocr/transcribe.ts`: the prompt asks for a transcription only, with amounts as printed text. `parseOcrTranscript`.
  - `AiProvider.readStatement` on the OpenAI-compatible provider: image content parts, a timeout of `AI_LONG_TIMEOUT_MS`, and a Bahasa
    error when the model cannot read the answer. On MockProvider it returns a recorded extraction.
  - `lib/ocr/amount.ts`: `readAmount` reads Indonesian or English grouping and CR/DB markers. Sen are refused, never rounded.
  - `OcrDraft` migration `20261006220000_ocr_draft`.
  - `lib/ocr/draft.ts`:
    - `createOcrDraft`: the switch, the bank in the firm and client, one budgeted call cached by file hash, model and prompt version, an
      account-number check, and the opening from the print else the previous import;
    - `ocrDraft`, `updateOcrDraft` and `draftCsv`;
    - `importOcrDraft`: `importStatement` on the CSV, then the import note, then the draft marked `IMPORTED`.

  Around it:
  - Client delete removes the drafts. Accounting-rules 16b.
  - Test: `tests/db/ocr-draft.test.ts`.
- T3: the UI and its errors.
  - `ScanError` (a scanned PDF and, now, images) and `importAction` returning `scanned: { ocrReady }`.
  - `ocrAction`, `saveOcrDraftAction` and `importOcrDraftAction`.
  - The import form's *Baca scan dengan AI* notice; the picker accepts JPG and PNG.
  - The *Periksa scan* page (`/clients/[id]/import/ocr/[draftId]`, `components/app/ocr-review.tsx`):
    - a live proof per row while cells are edited, with *Hitungan* showing the computed balance on a break;
    - *Tampilkan hanya baris yang perlu dicek*;
    - adding and removing rows;
    - *Impor* only when everything ties. The server proves again.
  - Admin switch card `components/app/ocr-setting.tsx` in Pengaturan, with `setOcrAction`.
  - E2e: `e2e/ocr-scan.spec.ts`.
## Verification
- `tests/unit/ocr.test.ts`:
  - PNG round trip;
  - a scanned PDF gives one page image, and a text PDF is refused;
  - the proof cases;
  - printed amounts in both groupings;
  - the OpenAI-compatible request carries only the instruction text and the image parts, and parses a fenced JSON answer.
- `tests/db/ocr-draft.test.ts`:
  - switch off, other firm and no provider are refused;
  - a recorded extraction with a misread admin fee (100.000 for 10.000) shows `BREAK` with the computed 1.400.000;
  - after the fix it imports 3 rows through the pipeline (continuity ok, file `… (OCR).csv`, note on the import);
  - a repeat is served from the cache;
  - a September scan without a printed opening takes the August closing;
  - a scan of another account is refused.
- End of cycle: `npm run lint` exit 0; `npm run typecheck` exit 0; `npm test`: Test Files 177 passed (177), Tests 1155 passed (1155)
  (+1 provider test after); `npm run build` exit 0 (route `/clients/[id]/import/ocr/[draftId]`); `npm run verify:books` → `ALL PASS
  — 1765 pemeriksaan saldo cocok dengan ground truth.` E2e in CI.
## Ship Notes
- Migration `20261006220000_ocr_draft`: a new table.
- The switch `ai.ocr` (AppSetting) is off by default, so nothing changes until an admin turns it on. The configured model must read
  images.
- Rollback: revert, or turn the switch off.
