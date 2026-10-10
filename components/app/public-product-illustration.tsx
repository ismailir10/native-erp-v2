import { CheckDraw } from "@/components/motion/check-draw";
import type { PublicProductEvidence } from "@/lib/public-product";

/** A document, an open ledger, and a report, following the public deck's visual grammar. */
export function PublicProductIllustration({ evidence }: { evidence: PublicProductEvidence }) {
  const month = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${evidence.period}-01T00:00:00Z`));
  const balanced = BigInt(evidence.source.journalDebit) === BigInt(evidence.source.journalCredit);
  const accounts = evidence.source.lines.map((line) => ({ code: line.code, name: line.name.replace(/\s*\([^)]*\)$/, "") }));
  const label = `Ilustrasi alur rekening koran ${evidence.source.fileName} baris ${evidence.source.rowNumber}, menjadi jurnal lalu laporan ${evidence.reportEntity.name} untuk ${month}. Angka laporan dapat ditelusuri ke baris sumber.`;

  return <figure className="page-settle min-w-0">
    <svg viewBox="0 0 640 425" role="img" aria-label={label} focusable="false" className="mx-auto h-auto w-full overflow-visible">
      <title>Rekening koran, Buku Besar, laporan keuangan</title>
      <desc>{label} Bentuk dokumen adalah ilustrasi; tampilan aplikasi asli tersedia di halaman ini.</desc>

      {/* The long return path connects the report to its source, rather than implying a trend. */}
      <path d="M370 96C295 43 178 45 113 122" fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="5 7" />
      <path d="m113 109 0 13 13-3" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="104" y="27" fill="var(--muted-foreground)" fontSize="20">Telusuri ke barisnya</text>

      {/* Offset sheets and a turned corner give the report a document silhouette. */}
      <path d="M392 29h183q9 0 9 9v140q0 9-9 9H392q-9 0-9-9V38q0-9 9-9Z" transform="rotate(5 483 106)" fill="var(--muted)" stroke="var(--foreground)" strokeWidth="1.5" />
      <path d="M389 15h164l43 43v115q0 10-10 10H389q-10 0-10-10V25q0-10 10-10Z" fill="var(--card)" stroke="var(--foreground)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M553 15v43h43" fill="var(--muted)" stroke="var(--foreground)" strokeWidth="2" strokeLinejoin="round" />
      <text x="401" y="56" fill="var(--foreground)" fontSize="24" fontWeight="500">Laporan</text>
      <path d="M401 72h130" stroke="var(--border)" strokeWidth="2" />
      <text x="401" y="100" fill="var(--foreground)" fontSize="21">Neraca Saldo</text>
      <text x="401" y="131" fill="var(--muted-foreground)" fontSize="21">Laba Rugi</text>
      <text x="401" y="162" fill="var(--muted-foreground)" fontSize="21">Neraca</text>

      {/* The fan is real paper geometry; only the front sheet identifies captured evidence. */}
      <g transform="rotate(-13 136 350)">
        <rect x="61" y="130" width="165" height="216" rx="8" fill="var(--muted)" stroke="var(--foreground)" strokeWidth="1.75" />
        <path d="M69 158h115M69 180h133M69 202h133M69 224h133M69 246h133M69 268h133M69 290h133" stroke="var(--border)" strokeWidth="2" />
      </g>
      <g transform="rotate(-6 136 350)">
        <rect x="49" y="130" width="177" height="216" rx="8" fill="var(--card)" stroke="var(--foreground)" strokeWidth="1.75" />
        <path d="M69 158h115M69 180h133M69 202h133M69 224h133M69 246h133M69 268h133M69 290h133" stroke="var(--border)" strokeWidth="2" />
      </g>
      <g transform="rotate(7 136 350)">
        <rect x="49" y="130" width="177" height="216" rx="8" fill="var(--card)" stroke="var(--foreground)" strokeWidth="2" />
        <text x="67" y="166" fill="var(--foreground)" fontSize="21" fontWeight="500">Rekening koran</text>
        <path d="M68 190h138M68 213h138M68 287h138M68 310h95" stroke="var(--border)" strokeWidth="2" strokeLinecap="round" />
        <rect x="62" y="232" width="152" height="36" rx="5" fill="var(--primary-subtle)" />
        <text x="73" y="256" fill="var(--foreground)" fontSize="22">Baris {evidence.source.rowNumber}</text>
      </g>

      {/* A static arrow represents the actual bank-source relation to its journal. */}
      <path d="M251 260C276 262 276 282 299 287m-9-9 9 9-12 4" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

      {/* Curved covers, page edges and a bound spine distinguish the ledger from flat UI cards. */}
      <path d="M449 248Q394 216 315 229V363Q392 350 449 383Q506 350 598 363V229Q510 216 449 248Z" fill="var(--muted)" stroke="var(--foreground)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M449 241Q394 208 319 220V353Q392 342 449 375Q508 342 593 353V220Q508 208 449 241Z" fill="var(--card)" stroke="var(--foreground)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M449 241v134M441 244v121M457 244v121" fill="none" stroke="var(--border)" strokeWidth="1.5" />
      <text x="341" y="253" fill="var(--muted-foreground)" fontSize="19">Kode</text>
      <text x="479" y="253" fill="var(--muted-foreground)" fontSize="19">Akun</text>
      {accounts.map((account, index) => <g key={account.code}>
        <text x="341" y={286 + index * 29} fill="var(--foreground)" fontSize="23" className="num">{account.code}</text>
        <text x="477" y={286 + index * 29} fill="var(--foreground)" fontSize="19">{account.name}</text>
      </g>)}
      <circle cx="449" cy="311" r="18" fill="var(--card)" stroke="var(--foreground)" strokeWidth="1.5" />
      <text x="449" y="318" textAnchor="middle" fill="var(--foreground)" fontSize="23" fontWeight="500">B</text>
      <text x="77" y="384" fill="var(--foreground)" fontSize="23" fontWeight="500">Sumber</text>
      <text x="373" y="414" fill="var(--foreground)" fontSize="24" fontWeight="500">Buku Besar</text>
      <path d="M542 210C560 203 565 197 559 190m-3 12 3-12 10 8" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <figcaption className="mt-1 space-y-2 text-xs leading-relaxed text-muted-foreground">
      <p>Ilustrasi alur berdasarkan data demo sintetis.</p>
      <p className="break-words">{evidence.reportEntity.name} · {month}.</p>
      {balanced && <p className="flex items-start gap-2"><CheckDraw className="mt-0.5 text-pass" /><span>Jurnal sumber seimbang. Total debit dan kredit sama.</span></p>}
    </figcaption>
  </figure>;
}
