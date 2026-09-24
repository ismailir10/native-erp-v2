import { NextStep } from "@/components/app/page-header";
import { FxMissingError } from "@/lib/reports/fx";

/** Shown instead of a report when a non-IDR entity can't be translated yet (rule 11: never a guessed number). */
export function FxMissing({ error, base }: { error: FxMissingError; base: string }) {
  return (
    <div className="space-y-3">
      <NextStep href={`${base}/rates`} cta="Isi kurs">
        Gabungan Grup belum bisa dijabarkan ke Rupiah: kurs belum lengkap.
      </NextStep>
      <ul className="list-disc space-y-1 pl-6 text-sm text-muted-foreground">
        {error.missing.map((m) => (
          <li key={`${m.entity}-${m.need}`}>
            {m.entity}: {m.need}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">Laporan per entitas tetap tersedia dalam mata uang masing-masing. Pilih entitasnya di atas.</p>
    </div>
  );
}

/** Run a report; a missing rate becomes a value the page can render instead of a crash. */
export async function withFx<T>(run: () => Promise<T>): Promise<T | FxMissingError> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof FxMissingError) return e;
    throw e;
  }
}

/** Header note for the amounts' currency. */
export function currencyNote(currency: string, mixed: boolean) {
  return mixed ? "dijabarkan ke Rupiah (IDR)" : currency === "IDR" ? "" : `dalam ${currency}`;
}
