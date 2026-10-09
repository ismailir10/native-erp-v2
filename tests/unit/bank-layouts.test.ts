import { describe, expect, it } from "vitest";
import { parseStatementSections } from "@/lib/import/parsers";
import { TX, expectAugust } from "../bank-fixture";
import { LAYOUTS } from "../bank-layouts";

describe("every bank layout Buku claims reads to the same five August rows, tagged with its bank", () => {
  it.each(LAYOUTS.map((l) => [l.bank, l.format, l]))("%s · %s", async (_bank, _format, layout) => {
    const sections = await parseStatementSections(layout.file, await layout.build());
    expect(sections.length).toBeGreaterThan(0);
    for (const st of sections) expect(st.format).toBe(layout.bank);
    if (layout.check) return layout.check(sections);
    for (const st of sections) {
      expectAugust(st);
      // The description starts with the bank's text: no row number, branch, journal, second date or time in front of it.
      if (!layout.counterpartyFirst) st.rows.forEach((r, i) => expect(r.description.startsWith(TX[i].desc[0]), `${r.description} ← ${TX[i].desc[0]}`).toBe(true));
    }
  });
});
