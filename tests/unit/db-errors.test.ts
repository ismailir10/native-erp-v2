import { describe, expect, it } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { infraErrorMessage } from "@/lib/db-errors";

describe("infraErrorMessage", () => {
  it("explains a rolled-back transaction timeout and a full pool in Bahasa, and leaves other errors alone", () => {
    for (const code of ["P2028", "P2024"]) {
      const e = new Prisma.PrismaClientKnownRequestError("Transaction API error", { code, clientVersion: "7.10.0" });
      expect(infraErrorMessage(e)).toMatch(/tidak ada yang tersimpan/);
    }
    expect(infraErrorMessage(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "7.10.0" }))).toBeNull();
    expect(infraErrorMessage(new Error("x"))).toBeNull();
  });
});
