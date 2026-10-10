import { describe, expect, it } from "vitest";
import type { BankSection, InboxItem } from "@/lib/inbox/check";
import { accountDisplay, batchSummary, itemSummary, lineMessage, monthSpan, needsManualPath, sectionSummary, statusView } from "@/lib/inbox/view";

const section = (over: Partial<BankSection> = {}): BankSection => ({
  bank: "BCA",
  number: "123-456-5566",
  holder: null,
  currency: "IDR",
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  rows: 12,
  opening: "0",
  closing: "0",
  error: null,
  ...over,
});

describe("Unggah line wording", () => {
  it("names a rekening by its bank and last four digits", () => {
    expect(accountDisplay("BCA", "123-456-5566")).toBe("BCA ·5566");
    expect(accountDisplay("GENERIC", "0098765")).toBe("Bank ·8765");
  });

  it("spans months within and across years", () => {
    expect(monthSpan("2026-01-01", "2026-01-31")).toBe("Jan 2026");
    expect(monthSpan("2026-01-01", "2026-03-31")).toBe("Jan–Mar 2026");
    expect(monthSpan("2025-12-01", "2026-01-31")).toBe("Des 2025–Jan 2026");
    expect(monthSpan(null, null)).toBe("");
  });

  it("summarises a statement section: bank ·last4 · month, valas with its currency, no number with the bank only", () => {
    expect(sectionSummary(section())).toBe("BCA ·5566 · Jan 2026");
    expect(sectionSummary(section({ currency: "USD" }))).toBe("BCA ·5566 · USD · Jan 2026");
    expect(sectionSummary(section({ bank: "BNI", number: null }))).toBe("BNI · Jan 2026");
  });

  it("summarises every section of a combined file and every table of a ledger", () => {
    const bank = { kind: "BANK" as const, sections: [section(), section({ number: "777-8888" })] };
    expect(itemSummary(bank)).toBe("BCA ·5566 · Jan 2026; BCA ·8888 · Jan 2026");
    const ledger = { kind: "LEDGER" as const, sections: [{ sheet: "GL", mode: "LEDGER" as const, rows: 120, periodStart: "2025-01-01", periodEnd: "2025-12-31" }] };
    expect(itemSummary(ledger)).toBe("Buku besar · GL · 120 baris · Jan–Des 2025");
    expect(itemSummary({ kind: "OTHER", sections: [] })).toBe("");
  });

  it("labels every status, and only control states use pass / review / fail", () => {
    expect(statusView("BOOKED")).toEqual({ tone: "pass", label: "Dibukukan" });
    expect(statusView("NEEDS_PASSWORD").tone).toBe("review");
    expect(statusView("FAILED")).toEqual({ tone: "fail", label: "Gagal" });
    expect(statusView("KEPT").tone).toBe("muted");
    expect(statusView("PROCESSING").tone).toBe("busy");
  });

  it("doesn't repeat the status in the message, and sends refusals and scans to the manual path", () => {
    const item = (over: Partial<InboxItem>) => ({ status: "KEPT" as const, kind: "OTHER" as const, message: "Disimpan di Dokumen.", ...over });
    expect(lineMessage(item({}))).toBeNull();
    expect(lineMessage(item({ message: "Tidak dibukukan; disimpan di Dokumen." }))).toBe("Tidak dibukukan; disimpan di Dokumen.");
    expect(needsManualPath(item({}))).toBe(false);
    expect(needsManualPath(item({ message: "PDF ini hasil scan (tanpa teks). Minta rekening koran versi e-statement." }))).toBe(true);
    expect(needsManualPath(item({ status: "FAILED", kind: "BANK", message: "Isi tahunnya." }))).toBe(true);
    expect(needsManualPath(item({ status: "BOOKED", kind: "BANK", message: "Dibukukan ke BCA ·5566" }))).toBe(false);
    // Another form can't open a closed month or post foreign currency: the message itself says what to do.
    expect(needsManualPath(item({ status: "FAILED", kind: "BANK", message: "SMBC ·2088: Periode Mei 2026 sudah ditutup. Buka periode dulu atau pilih file lain." }))).toBe(false);
    expect(needsManualPath(item({ status: "FAILED", kind: "BANK", message: "SMBC ·4251 (JPY): rekening valas belum bisa dibukukan" }))).toBe(false);
    expect(needsManualPath(item({ status: "FAILED", kind: "OTHER", message: "File terlalu besar (maks. 5 MB)." }))).toBe(false);
  });

  it("sums the drop up in one sentence", () => {
    expect(batchSummary([{ status: "BOOKED" }, { status: "BOOKED" }, { status: "DRAFT" }, { status: "KEPT" }])).toBe("4 file selesai: 2 dibukukan, 1 draf buku besar, 1 disimpan di Dokumen.");
  });
});
