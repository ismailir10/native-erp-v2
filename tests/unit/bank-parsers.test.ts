import { describe, expect, it } from "vitest";
import { parseStatement } from "@/lib/import/parsers";
import { checkContinuity } from "@/lib/import/normalize";
import { BAL, TX, bniDirectCsv, bniDirectXlsx, bniMobileXlsx, xlsxBuffer, briInternetBankingCsv, cimbPdf, idn, mandiriLivinPdf, mandiriLivinXlsx, serialDateXlsx, cimbOctoCsv, expectAugust, p2, permataCsv, titleWithCommasSemicolonCsv, utf16TabCsv } from "../bank-fixture";

describe("routing: bank CSVs that borrow BCA's words", () => {
  it("reads a BRI internet-banking CSV titled 'Mutasi Rekening' with a 'Tanggal Transaksi' header", async () => {
    const st = await parseStatement("bri-ib.csv", briInternetBankingCsv());
    expectAugust(st);
    expect(st.accountNumber).toBe("000001000123509");
  });

  it("still reads the KlikBCA export as BCA", async () => {
    const csv = [
      "Informasi Rekening - Mutasi Rekening",
      "No. rekening : 0000012345",
      "Periode : 01/08/2026 - 31/08/2026",
      "",
      "Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo",
      `'02/08,"PEMBAYARAN LISTRIK PLN",'0000,"2,450,000.00",DB,"97,550,000.00"`,
      `"Saldo Awal : 100,000,000.00"`,
      `"Saldo Akhir : 97,550,000.00"`,
    ].join("\n");
    const st = await parseStatement("klikbca.csv", Buffer.from(csv));
    expect(st.format).toBe("BCA");
    expect(st.rows.map((r) => r.amount)).toEqual([-2_450_000n]);
  });

  it("falls back to the generic reader when the BCA reader can't read a file that looks like BCA's, keeping the BCA error if both fail", async () => {
    // Looks like KlikBCA (title + header) but carries no 'Periode' line: the BCA reader throws; the generic one can read it.
    const readable = ["Informasi Rekening - Mutasi Rekening", "Tanggal Transaksi,Keterangan,Cabang,Jumlah,Saldo", "01/08/2026,A,0000,100,1100", "02/08/2026,B,0000,-50,1050"].join("\n");
    const st = await parseStatement("x.csv", Buffer.from(readable));
    expect(st.rows.map((r) => r.amount)).toEqual([100n, -50n]);
    const unreadable = ["Informasi Rekening - Mutasi Rekening", "Tanggal Transaksi,Keterangan,Cabang,Foo", "01/08/2026,A,0000,B"].join("\n");
    await expect(parseStatement("x.csv", Buffer.from(unreadable))).rejects.toThrow(/Periode/);
  });
});

describe("text files: delimiter and encoding", () => {
  it("picks ';' from the table, not from a comma-laden title row above it", async () => {
    const st = await parseStatement("rekening.csv", titleWithCommasSemicolonCsv());
    expectAugust(st);
  });

  it("picks ';' when a title row without any delimiter comes first", async () => {
    const st = await parseStatement("cimb.csv", cimbOctoCsv("08"));
    expectAugust(st);
  });

  it("decodes a UTF-16 (BOM) tab-separated text export", async () => {
    const st = await parseStatement("unicode.txt", utf16TabCsv());
    expectAugust(st);
  });

  it("decodes UTF-16 big-endian with a BOM too", async () => {
    const le = utf16TabCsv().subarray(2);
    const be = Buffer.from(le);
    be.swap16();
    const st = await parseStatement("unicode.txt", Buffer.concat([Buffer.from([0xfe, 0xff]), be]));
    expectAugust(st);
  });
});

describe("column headers as banks label them", () => {
  const dmy = (d: number) => `${p2(d)}/08/2026`;
  const csv = (header: string[], row: (t: (typeof TX)[number], i: number) => (string | number)[]) =>
    Buffer.from([header.join(","), ...TX.map((t, i) => row(t, i).join(","))].join("\n"));
  const debitCredit = (t: (typeof TX)[number]) => [t.amt < 0 ? Math.abs(t.amt) : 0, t.amt > 0 ? t.amt : 0];

  it("reads Permata's 'Posting Date / Eff Date / Transaction Desc'", async () => {
    expectAugust(await parseStatement("permata.csv", permataCsv()));
  });

  it.each([
    [["Post Date", "Transaction Description", "Debit (IDR)", "Credit (IDR)", "Balance (IDR)"]],
    [["Tgl. Transaksi", "Uraian", "Debet (Rp)", "Kredit (Rp)", "Saldo (Rp)"]],
    [["Tanggal", "Narasi", "Debet", "Kredit", "Saldo"]],
    [["Date", "Remarks", "Withdrawal", "Deposit", "Balance"]],
    [["Tanggal Transaksi", "Transaction Desc", "Uang Keluar", "Uang Masuk", "Saldo Akhir"]],
  ])("reads the header row %j", async (header) => {
    const st = await parseStatement("x.csv", csv(header, (t, i) => [dmy(t.d), `"${t.desc.join(" ")}"`, ...debitCredit(t), BAL[i]]));
    expectAugust(st);
  });

  it("reads 'Jumlah (IDR)' as one signed amount column", async () => {
    const st = await parseStatement("x.csv", csv(["Tanggal", "Keterangan", "Jumlah (IDR)", "Saldo (IDR)"], (t, i) => [dmy(t.d), `"${t.desc.join(" ")}"`, t.amt, BAL[i]]));
    expectAugust(st);
  });
});

describe("dates written with month names and Excel serials", () => {
  it("reads BNI Direct's 'Post Date' with a time and a two-digit year", async () => {
    expectAugust(await parseStatement("bni.csv", bniDirectCsv()));
  });

  it("reads CIMB OCTO's ';' CSV with dd-Mmm-yyyy dates", async () => {
    expectAugust(await parseStatement("cimb.csv", cimbOctoCsv()));
  });

  it("reads Mandiri Livin's Indonesian month names and a signed '+1.000,00' Nominal", async () => {
    expectAugust(await parseStatement("livin.xlsx", await mandiriLivinXlsx()));
  });

  it("reads date cells that hold Excel serial numbers", async () => {
    const st = await parseStatement("serial.xlsx", await serialDateXlsx());
    expect(st.rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2026-08-01", "2026-08-02"]);
    expect(st.rows.map((r) => r.amount)).toEqual([100n, -50n]);
    expect(checkContinuity(st).ok).toBe(true);
  });
});

describe("PDF statements: month-name dates, signed / Rp amounts", () => {
  it("reads CIMB's dd-Mmm-yyyy dates", async () => {
    expectAugust(await parseStatement("cimb.pdf", cimbPdf()));
  });

  it("reads 'dd Mmm yyyy' with Indonesian month names", async () => {
    expectAugust(await parseStatement("cimb.pdf", cimbPdf((d) => `${p2(d)} Agu 2026`)));
  });

  it("reads two-digit years and a header with 'Post Date / Transaction Desc / Debit (IDR)'", async () => {
    expectAugust(await parseStatement("cimb.pdf", cimbPdf((d) => `${p2(d)}-Aug-26`, ["Post Date", "Transaction Desc", "Debit (IDR)", "Credit (IDR)", "Balance (IDR)"])));
  });

  it("reads Livin's '+1.000.000' Nominal (a leading plus is a credit, never 0)", async () => {
    const st = await parseStatement("livin.pdf", mandiriLivinPdf());
    expectAugust(st);
    expect(st.format).toBe("MANDIRI");
  });

  it("reads an 'Rp' prefix before the amount", async () => {
    expectAugust(await parseStatement("livin.pdf", mandiriLivinPdf((a) => `${a > 0 ? "+" : "-"}Rp ${idn(a)}`)));
  });

  it("refuses an amount it can't read instead of posting the row as 0", async () => {
    const broken = mandiriLivinPdf((a) => (a === 45_678 ? "45.6x8,00" : (a > 0 ? "+" : "-") + idn(a)));
    await expect(parseStatement("livin.pdf", broken)).rejects.toThrow(/45\.6x8,00.*tidak bisa dibaca/);
  });
});

describe("a separate D/K flag column beside an unsigned amount", () => {
  it("reads BNI Mobile's Tipe (DB/CR) column", async () => {
    expectAugust(await parseStatement("bni-mobile.xlsx", await bniMobileXlsx()));
  });

  it("reads BNI Direct's D/K column (with dd-Mmm-yy dates and a SALDO AWAL row)", async () => {
    const st = await parseStatement("bni-direct.xlsx", await bniDirectXlsx());
    expectAugust(st);
    expect(st.notes?.join(" ")).toMatch(/D\/K/);
  });

  it.each([
    ["Debet", "Kredit"],
    ["DR", "CR"],
    ["d", "k"],
  ])("reads %s / %s as out / in", async (out, into) => {
    const rows = TX.map((t, i) => [`${p2(t.d)}/08/2026`, t.desc.join(" "), Math.abs(t.amt), t.amt < 0 ? out : into, BAL[i]]);
    const st = await parseStatement("x.xlsx", await xlsxBuffer("S", [["Tanggal", "Keterangan", "Nominal", "Jenis", "Saldo"], ...rows]));
    expectAugust(st);
  });

  it("refuses a row whose flag is missing rather than guessing its side", async () => {
    const rows = TX.map((t, i) => [`${p2(t.d)}/08/2026`, t.desc.join(" "), Math.abs(t.amt), i === 1 ? "" : t.amt < 0 ? "DB" : "CR", BAL[i]]);
    await expect(parseStatement("x.xlsx", await xlsxBuffer("S", [["Tanggal", "Keterangan", "Jumlah", "Tipe", "Saldo"], ...rows]))).rejects.toThrow(/D\/K.*baris 3/);
  });

  it("leaves a signed amount column with a text column of other values alone", async () => {
    const rows = TX.map((t, i) => [`${p2(t.d)}/08/2026`, t.desc.join(" "), t.amt, i % 2 ? "QRIS" : "TRANSFER", BAL[i]]);
    expectAugust(await parseStatement("x.xlsx", await xlsxBuffer("S", [["Tanggal", "Keterangan", "Jumlah", "Kanal", "Saldo"], ...rows])));
  });
});
