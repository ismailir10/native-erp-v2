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
- [ ] **Pages to images** (`lib/ocr/pages.ts`):
  - a PDF gives each page's largest embedded image (scanners embed one image per page; `unpdf` `extractImages`), encoded as PNG with
    Node's zlib;
  - JPG/PNG files go as they are;
  - at most 10 pages, each 5 MiB at most after encoding, else refused in Bahasa;
  - a PDF that has text is never sent: the existing parsers read it.
- [ ] **The model transcribes, nothing more** (`AiProvider.readStatement?`):
  - Input: the page images only. The prompt asks for the account number, the period, the printed opening and closing balances, and
    every row exactly as printed (date, description, debit, credit, balance; empty when not printed).
  - The model is told never to compute, fill in or correct a number.
  - No expected balance and no earlier statement is ever sent.
- [ ] **Proof** (`lib/ocr/prove.ts`, pure). The opening balance is the printed one, else the account's last imported closing
  balance, checked on the server and never sent.
  - Each row is *terbukti* when the previous balance + credit − debit = its printed balance.
  - A row without a printed balance, or one that does not tie, is *perlu dicek*.
  - The statement can be imported only when every row is *terbukti* and the last balance equals the printed closing balance (when
    printed).
- [ ] **Draft and review** (`OcrDraft`, migration):
  - It holds the client, bank account, file name and hash, page count, model, the transcribed header and rows, who and when.
  - The page `/clients/[id]/import/ocr/[draftId]` shows every row with its proof state, problems first. The accountant edits the
    cells of rows that are *perlu dicek* (or adds or removes a row), and the proof re-runs on every change.
  - *Impor* is enabled only when everything ties. It builds a semicolon CSV from the rows (`Tanggal;Keterangan;Debet;Kredit;Saldo`)
    and runs it through `importStatement` like any file: the generic parser, repair, continuity, dedupe, classification and Review.
  - The file name becomes `<asli> (OCR).csv` and the import note says "dibaca AI dari scan; setiap baris terbukti oleh saldo
    berjalan".
  - Nothing posts before that click (AI never auto-posts).
- [ ] **Firm switch (UU PDP)**: *Baca scan dengan AI* in Pengaturan.
  - Admin only, off by default.
  - It says that scan images are sent to the configured AI provider and that names and account numbers on them cannot be redacted.
  - Off, or no AI key: the scan error stays as today, and says who can turn the switch on.
- [ ] **On the import page**: when a file is a scan or an image and the switch is on, the error comes with *Baca scan dengan AI*. It
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
- [ ] T1 `lib/ocr/png.ts`, `lib/ocr/pages.ts`, `lib/ocr/prove.ts` + unit tests:
  - a PNG round trip;
  - a PDF with an embedded image yields one page image, and a text PDF yields none;
  - the proof: a tying chain, a misread amount, a missing balance, the closing mismatch, and the opening from the last import.
- [ ] T2 `readStatement` (OpenAI-compatible with image parts, plus MockProvider from a recorded extraction), the `OcrDraft` migration, and
  `lib/ocr/draft.ts`:
  - `createOcrDraft`: budget, cache, switch check;
  - `updateOcrRows`;
  - `importOcrDraft`: the CSV through `importStatement`.

  DB tests: a recorded extraction with one misread row is not importable, becomes importable after the fix, then imports and posts;
  the switch off refuses; another firm's draft is refused.
- [ ] T3 Switch in Pengaturan, the scan error flag, the button on the import form, and the review page. E2e: the switch is shown to
  admins and the scan error names it.
- [ ] T4 Gates.

## Implementation
## Verification
## Ship Notes
