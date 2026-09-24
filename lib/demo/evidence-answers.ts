import { formatMoney } from "@/lib/money";
import type { EvidenceUnit } from "@/lib/evidence/types";

export type DemoEvidenceSource = { id: string; name: string; hash: string; units: EvidenceUnit[] };
export type DemoEvidenceAnswer = { text: string; rows: { label: string; value: string }[]; citations: { href: string; label: string }[]; limitation: string };
export function demoSourceAnchor(id: string, locator: string) { return `${id}-${locator.replace(/[^a-z0-9]/gi, "-")}`; }
const STOP = new Set("apa apakah yang dan atau dari untuk ini itu pada berapa tolong bagaimana perusahaan profil bandingkan banding laporan dokumen cari tahun".split(" "));

/** Local, read-only demonstration. No network, shared conversation storage, or paid model. */
export function answerPublicEvidence(sources: DemoEvidenceSource[], question: string): DemoEvidenceAnswer {
  const q = question.trim().toLowerCase();
  const answer: DemoEvidenceAnswer = { text: "", rows: [], citations: [], limitation: "Angka berasal dari laporan contoh, bukan saldo buku Buku. Semua data sintetis." };
  const cite = (s: DemoEvidenceSource, locator: string) => {
    const href = `/documents#${demoSourceAnchor(s.id, locator)}`;
    if (!answer.citations.some(c => c.href === href)) answer.citations.push({ href, label: `${s.name} · ${locator}` });
  };
  if (!q || q.length > 2000) return { ...answer, text: "Tulis pertanyaan antara 1 dan 2.000 karakter." };
  if (/transaksi|rekening|rekonsiliasi|kurang|missing|saldo.*buku/.test(q)) {
    return { ...answer, text: "Contoh ini berisi profil dan dua laporan keuangan. Rekening koran dan buku besar belum tersedia.", limitation: "Rincian transaksi, saldo buku, dan rekonsiliasi tidak dapat disimpulkan dari laporan ringkasan." };
  }
  if (/banding|compare/.test(q)) {
    const label = /laba/.test(q) ? "Laba bersih" : /pendapatan|revenue/.test(q) ? "Pendapatan" : null;
    if (!label) return { ...answer, text: "Sebutkan angka yang ingin dibandingkan: pendapatan atau laba bersih." };
    const figures = sources.flatMap(s => s.units.filter(u => u.kind === "REPORT").flatMap(u => u.figures.filter(f => f.label === label).map(f => ({ s, u, f })))).sort((a,b) => (a.f.periodEnd ?? "").localeCompare(b.f.periodEnd ?? ""));
    const [before, after] = figures;
    if (figures.length !== 2 || !before.f.periodEnd || !after.f.periodStart || after.f.periodStart <= before.f.periodEnd || before.u.entity !== after.u.entity || before.f.currency !== after.f.currency || before.u.scale !== after.u.scale) return { ...answer, text: "Belum ada dua angka dengan cakupan yang dapat dibandingkan." };
    const delta = BigInt(after.f.amount) - BigInt(before.f.amount);
    answer.text = `${label} berubah ${formatMoney(delta, after.f.currency)} menurut laporan contoh.`;
    answer.rows = figures.map(({ f }) => ({ label: `${label} · tahun berakhir ${f.periodEnd}`, value: formatMoney(BigInt(f.amount), f.currency) }));
    figures.forEach(({ s,f }) => cite(s,f.locator));
    answer.limitation += " Penyebab perubahan belum dibuktikan; laporan tidak menyediakan rincian transaksi.";
    return answer;
  }
  const context = /profil|perusahaan|usaha|fiskal|company/.test(q);
  const terms = (q.match(/[\p{L}\p{N}]+/gu) ?? []).filter(t => t.length > 1 && !STOP.has(t)).slice(0,8);
  for (const s of sources) {
    for (const u of s.units) {
      for (const p of u.passages) {
        if (answer.rows.length >= 12) break;
        if (context ? u.kind !== "CONTEXT" : !terms.length || !terms.some(t => p.text.toLowerCase().includes(t))) continue;
        answer.rows.push({ label: `${s.name} · ${p.locator}`, value: p.text }); cite(s,p.locator);
      }
    }
  }
  answer.text = answer.rows.length ? "Kutipan yang ditemukan dalam dokumen contoh:" : "Tidak ada kutipan yang cocok. Coba pendapatan, laba bersih, atau profil perusahaan.";
  return answer;
}
