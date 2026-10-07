# Ekualisasi PPN on a phone

## Context
The UX sweep at 390 px after the demo got Coretax faktur (2026-10-07-demo-coretax-faktur): in *Faktur belum ada di buku* the long
counterparty name under the faktur number did not wrap, so the PPN column and the *Catat piutang / Catat utang* button sat off screen
inside an inner scroll (+138 px keluaran, +199 px masukan). The accountant could not see the amount or the action without scrolling sideways.

## Spec
- [x] The faktur cell wraps; on a phone the record button sits under the faktur, and the button column shows from `sm` up.
- [x] Nothing else changes: same dialog, same action, same columns at desktop.

**Gate-reopeners:** none.

## Tasks
- [x] T1 The layout fix — accept: the sweep shows no inner scroll on `/tax/masa` at 390 px; `e2e/ekualisasi-ppn.spec.ts` passes.

## Verification
- UX sweep at 390 px: no inner scroll on `/tax/masa` (was +138 / +199 px); screenshot shows faktur, name, button and PPN in view.
- `e2e/ekualisasi-ppn.spec.ts` passes (the desktop button is the one it clicks; the phone copy is hidden there).
- lint, typecheck, build pass.

## Ship Notes
- No migration. UI only. Rollback: revert.
