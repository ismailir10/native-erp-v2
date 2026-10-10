"use client";

import { createContext, useState, type ReactNode } from "react";

export type WorkspaceAnswer = {
  id: string;
  question: string;
  scope: { key: string; label: string; period: string; periodLabel: string };
  text: string;
  rows: { label: string; value: string; source: string }[];
  citations: { label: string; href: string }[];
  limitations: string[];
  preliminary: string | null;
};

export const WorkspaceHistoryContext = createContext<{ answers: WorkspaceAnswer[]; addAnswer: (answer: WorkspaceAnswer) => void } | null>(null);

/** Memory only: navigation keeps answers; logout or reload discards them. */
export function WorkspaceHistoryProvider({ children }: { children: ReactNode }) {
  const [answers, setAnswers] = useState<WorkspaceAnswer[]>([]);
  return <WorkspaceHistoryContext.Provider value={{ answers, addAnswer: (answer) => setAnswers((previous) => [answer, ...previous].slice(0, 20)) }}>{children}</WorkspaceHistoryContext.Provider>;
}
