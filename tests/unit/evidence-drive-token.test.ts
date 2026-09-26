import { describe, expect, it } from "vitest";
import { driveToken } from "@/lib/evidence/jobs";
import type { Db } from "@/lib/db";

describe("stored Drive token", () => {
  it("asks for a reconnect when the saved token can't be decrypted, never the crypto error", async () => {
    // A token saved under another SETTINGS_SECRET (or corrupted) must not surface "Unsupported state…".
    const db = { driveConnection: { findUnique: async () => ({ refreshToken: "v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }) } } as unknown as Db;
    await expect(driveToken(db, "firm-1")).rejects.toMatchObject({ code: "RECONNECT", message: "Koneksi Google perlu dihubungkan ulang oleh admin." });
  });
});
