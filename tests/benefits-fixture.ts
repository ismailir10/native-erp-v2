/**
 * Synthetic PSAK 219 fixtures (never a real census or a copy of TMI IV): a smooth made-up mortality table as CSV, and a small census.
 */
export const syntheticQx = (age: number, female: boolean) => Math.min(1, (female ? 0.0003 : 0.0005) * Math.exp(0.08 * Math.max(0, age - 20)) + 0.0002);

export function mortalityCsv(maxAge = 111) {
  const rows = ["Usia;Pria;Wanita"];
  for (let x = 0; x <= maxAge; x++) rows.push(`${x};${syntheticQx(x, false).toFixed(9).replace(".", ",")};${syntheticQx(x, true).toFixed(9).replace(".", ",")}`);
  return Buffer.from(rows.join("\n") + "\n");
}

/** Four invented employees; one left in 2026. */
export const CENSUS_CSV = [
  "No;Nama;L/P;Tanggal Lahir;Tanggal Masuk;Gaji Pokok;Tunjangan Tetap;Tanggal Keluar",
  "K-001;Budi Santoso;L;15/03/1975;01/02/2005;9.000.000;1.000.000;",
  "K-002;Sari Dewi;P;20/07/1990;01/06/2015;6.000.000;500.000;",
  "K-003;Andi Wijaya;L;05/11/1998;01/09/2022;5.000.000;0;",
  "K-004;Rina Lestari;P;10/01/1985;01/03/2010;7.000.000;500.000;30/06/2026",
  "",
].join("\n");
