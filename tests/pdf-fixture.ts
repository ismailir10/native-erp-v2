import { createHash } from "node:crypto";

/**
 * Minimal PDF writer for parser tests: pages of text placed at (x, y) in Helvetica, optionally encrypted
 * with a user password (standard security handler R2 / RC4-40, which pdf.js opens like any e-statement).
 * Real e-statements aren't committed (client data); these reproduce their layouts synthetically.
 */
export type PdfText = { x: number; y: number; text: string; size?: number };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const PAD = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");
const md5 = (...parts: Buffer[]) => createHash("md5").update(Buffer.concat(parts)).digest();
const padPw = (pw: string) => Buffer.concat([Buffer.from(pw, "latin1"), PAD]).subarray(0, 32);

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

export function makePdf(pages: PdfText[][], opts: { userPassword?: string } = {}): Buffer {
  const id = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
  const P = -4;
  let fileKey: Buffer | null = null;
  let encryptDict = "";
  if (opts.userPassword !== undefined) {
    const O = rc4(md5(padPw(opts.userPassword)).subarray(0, 5), padPw(opts.userPassword));
    const p = Buffer.alloc(4);
    p.writeInt32LE(P);
    fileKey = md5(padPw(opts.userPassword), O, p, id).subarray(0, 5);
    const U = rc4(fileKey, PAD);
    encryptDict = `<< /Filter /Standard /V 1 /R 2 /O <${O.toString("hex")}> /U <${U.toString("hex")}> /P ${P} >>`;
  }
  const objKey = (num: number) => md5(fileKey!, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, 10);

  const objects: string[] = [];
  const add = (body: string) => objects.push(body); // object number = index + 1
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // Pages, filled once kids are known
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const texts of pages) {
    let stream: Buffer = Buffer.from(texts.map((t) => `BT /F1 ${t.size ?? 8} Tf 1 0 0 1 ${t.x} ${t.y} Tm (${esc(t.text)}) Tj ET`).join("\n"), "latin1");
    const num = objects.length + 1;
    if (fileKey) stream = rc4(objKey(num), stream);
    add(`<< /Length ${stream.length} >>\nstream\n${stream.toString("latin1")}\nendstream`);
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${num} 0 R >>`);
    kids.push(objects.length);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  if (encryptDict) add(encryptDict);

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  const enc = encryptDict ? ` /Encrypt ${objects.length} 0 R` : "";
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${enc} /ID [<${id.toString("hex")}> <${id.toString("hex")}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Lay out rows as table lines: each row is [x, text][] at a y that steps down by `lead`. */
export function table(startY: number, rows: [number, string][][], lead = 12): PdfText[] {
  return rows.flatMap((cells, i) => cells.map(([x, text]) => ({ x, y: startY - i * lead, text })));
}

/** SMBC "Laporan Konsolidasi Rekening": several accounts in one PDF, each under its own section header. */
export function smbcCombinedPdf() {
  const header: [number, string][] = [[37, "Tanggal Transaksi"], [119, "Tanggal Pembukuan"], [246, "Keterangan"], [353, "Mutasi Debet"], [437, "Mutasi Kredit"], [531, "Saldo"]];
  return makePdf([
    [
      ...table(800, [[[32, "Kepada Yth:"], [318, "Periode Laporan"], [398, ": 01 MEI 2026 - 31 MEI 2026"]], [[32, "PT Bank SMBC Indonesia Tbk"]]]),
      ...table(740, [
        [[25, "Aktivitas Rekening / Account Activities – Jenius Main Account (IDR) 90022152088"]],
        header,
        [[45, "01-05-2026"], [132, "01-05-2026"], [199, "Saldo Awal - Beginning Balance"], [531, "5,646,633.00"]],
        [[45, "18-05-2026"], [132, "18-05-2026"], [199, "Cr BI fast Incoming"], [436, "250,000,000.00"], [523, "255,646,633.00"]],
        [[45, "20-05-2026"], [132, "20-05-2026"], [199, "Transfer Keluar - Outgoing Transfer"], [359, "35,000,000.00"], [523, "220,646,633.00"]],
        [[45, "Total"], [235, "1 DEBIT 1 KREDIT"], [354, "35,000,000.00"], [436, "250,000,000.00"]],
      ]),
      ...table(560, [
        [[24, "Aktivitas Rekening / Account Activities - Pinjaman Rekening Koran BTB (IDR) 05243002879"]],
        header,
        [[45, "01-05-2026"], [131, "01-05-2026"], [195, "Saldo Awal - Beginning Balance"], [517, "-3,598,843,911.00"]],
        [[44, "20-05-2026"], [130, "20-05-2026"], [195, "Transfer Masuk - Incoming Transfer"], [439, "35,000,000.00"], [517, "-3,563,843,911.00"]],
        [[45, "25-05-2026"], [131, "25-05-2026"], [195, "Bunga - Interest"], [362, "17,222,773.00"], [516, "-3,581,066,684.00"]],
      ]),
    ],
    [
      ...table(800, [
        [[24, "Aktivitas Rekening / Account Activities – JENIUS JPY ACCOUNT (JPY) 90022164251"]],
        header,
        [[45, "01-05-2026"], [132, "01-05-2026"], [199, "Saldo Awal - Beginning Balance"], [531, "12,750.00"]],
      ]),
      { x: 180, y: 400, text: "Ini adalah akhir dari Laporan Konsolidasi Rekening Anda" },
    ],
  ]);
}
