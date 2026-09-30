import { describe, expect, it } from "vitest";
import WorkPage from "@/app/(app)/work/page";

const redirectOf = async (params: Record<string, string | string[] | undefined>) => {
  const error = (await WorkPage({ searchParams: Promise.resolve(params) }).then(() => null, (e) => e)) as { digest?: string } | null;
  return error?.digest?.split(";")[2];
};

describe("/work", () => {
  it("lands on Beranda's full task list, keeping the scope and period", async () => {
    expect(await redirectOf({ scope: "client:abc", period: "2026-08" })).toBe("/?scope=client%3Aabc&period=2026-08&tugas=semua");
  });

  it("ignores anything else in the query and repeated values", async () => {
    expect(await redirectOf({})).toBe("/?tugas=semua");
    expect(await redirectOf({ scope: ["a", "b"], x: "y" })).toBe("/?tugas=semua");
  });
});
