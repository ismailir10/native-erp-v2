import type { ClassifyMethod, Direction, TaxTag } from "@/lib/generated/prisma/enums";

export type Classification = {
  method: ClassifyMethod;
  accountCode: string;
  taxTag: TaxTag | null;
  confidence: number;
  reason: string;
  matchedTxId?: string;
};

export type ClassifyInput = {
  id: string;
  entityId: string;
  bankAccountId: string;
  date: Date;
  description: string;
  merchantKey: string;
  direction: Direction;
  amount: bigint;
};

/** Deterministic results at/above this post straight to the final account. AI never auto-posts. */
export const AUTO_POST_CONFIDENCE = 0.9;
