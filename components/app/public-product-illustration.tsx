import { CheckDraw } from "@/components/motion/check-draw";
import type { PublicProductEvidence } from "@/lib/public-product";

/** A document, an open ledger, and a report, following the public deck's visual grammar. */
export function PublicProductIllustration({ evidence }: { evidence: PublicProductEvidence }) {
  const month = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${evidence.period}-01T00:00:00Z`));
  const balanced = BigInt(evidence.source.journalDebit) === BigInt(evidence.source.journalCredit);
  const codes = evidence.source.lines.map((line) => line.code);
  const label = `Ilustrasi alur rekening koran ${evidence.source.fileName} baris ${evidence.source.rowNumber}, menjadi jurnal lalu laporan ${evidence.reportEntity.name} untuk ${month}. Angka laporan dapat ditelusuri ke baris sumber.`;

  return <figure className="page-settle min-w-0">
    <svg viewBox="0 0 400 420" role="img" aria-label={label} focusable="false" className="mx-auto h-auto w-full max-w-xl overflow-visible">
      <title>Rekening koran, Buku Besar, laporan keuangan</title>
      <desc>{label} Bentuk dokumen adalah ilustrasi; tampilan aplikasi asli tersedia di halaman ini.</desc>

      {/* The return path explains traceability, rather than suggesting an invented trend. */}
      <path d="M195 88C106 88 71 119 69 174" fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="4 5" />
      <path d="m63 166 6 9 7-8" fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="18" y="76" fill="var(--muted-foreground)" fontSize="12">Telusuri ke sumber</text>

      {/* A report sheet lists genuine output types without fictional chart series. */}
      <rect x="188" y="22" width="186" height="136" rx="12" fill="var(--card)" stroke="var(--border)" />
      <path d="M338 22v25h36" fill="var(--muted)" stroke="var(--border)" strokeLinejoin="round" />
      <text x="207" y="55" fill="var(--foreground)" fontSize="16" fontWeight="500">Laporan keuangan</text>
      <text x="207" y="84" fill="var(--muted-foreground)" fontSize="13">Neraca Saldo</text>
      <text x="207" y="108" fill="var(--muted-foreground)" fontSize="13">Laba Rugi</text>
      <text x="207" y="132" fill="var(--muted-foreground)" fontSize="13">Neraca</text>

      {/* Paper stack with one source row identified from the captured fixture. */}
      <g transform="rotate(-9 82 332)">
        <rect x="23" y="179" width="129" height="164" rx="9" fill="var(--muted)" stroke="var(--border)" />
      </g>
      <g transform="rotate(-3 86 332)">
        <rect x="23" y="179" width="129" height="164" rx="9" fill="var(--card)" stroke="var(--border)" />
      </g>
      <rect x="24" y="179" width="133" height="164" rx="9" fill="var(--card)" stroke="var(--border)" />
      <text x="38" y="206" fill="var(--foreground)" fontSize="14" fontWeight="500">Rekening koran</text>
      <path d="M39 224h100M39 239h100M39 289h100M39 305h100M39 320h66" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="35" y="249" width="111" height="26" rx="5" fill="var(--primary-subtle)" />
      <text x="44" y="267" fill="var(--foreground)" fontSize="13">Baris {evidence.source.rowNumber}</text>

      {/* A static arrow represents the actual bank-source relation to its journal. */}
      <path d="M163 268h24m-7-6 7 6-7 6" fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

      <path d="M281 209Q244 187 200 200V325Q244 312 281 333Q318 312 362 325V200Q318 187 281 209Z" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M281 209v124" fill="none" stroke="var(--border)" strokeWidth="1.5" />
      <text x="213" y="223" fill="var(--muted-foreground)" fontSize="12">Akun</text>
      {codes.map((code, index) => <text key={code} x="213" y={247 + index * 24} fill="var(--foreground)" fontSize="14" className="num">{code}</text>)}
      <text x="294" y="223" fill="var(--muted-foreground)" fontSize="12">Jurnal</text>
      <path d="M295 239h52M295 263h52M295 287h52" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" />
      <text x="241" y="364" fill="var(--foreground)" fontSize="15" fontWeight="500">Buku Besar</text>
      <path d="M303 190v-23m-6 7 6-7 6 7" fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="24" y="388" fill="var(--muted-foreground)" fontSize="13">Sumber tetap tersimpan.</text>
    </svg>
    <figcaption className="mt-1 space-y-2 text-xs leading-relaxed text-muted-foreground">
      <p>Ilustrasi alur berdasarkan data demo sintetis.</p>
      <p className="break-words">{evidence.reportEntity.name} · {month}. {evidence.source.fileName}, baris {evidence.source.rowNumber}.</p>
      {balanced && <p className="flex items-start gap-2"><CheckDraw className="mt-0.5 text-pass" /><span>Jurnal sumber seimbang. Total debit dan kredit sama.</span></p>}
    </figcaption>
  </figure>;
}
