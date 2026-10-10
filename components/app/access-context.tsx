"use client";

import { createContext, useContext } from "react";

/**
 * Whether this member may change anything right now, and why not (ADR 0017): the organisation is read-only after its access
 * ended, or the role is Peninjau. Provided once by the app layout; write controls read it so they explain instead of failing.
 * The server refuses the same writes on its own (requireCapability), this only spares the click.
 */
export type AccessView = { canWrite: boolean; reason: string | null };

const AccessContext = createContext<AccessView>({ canWrite: true, reason: null });

export function AccessProvider({ value, children }: { value: AccessView; children: React.ReactNode }) {
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export const useAccess = () => useContext(AccessContext);

/** The reason, under a write control the member cannot use now; nothing when they can. */
export function WriteBlockedNote() {
  const { canWrite, reason } = useAccess();
  if (canWrite || !reason) return null;
  return <p className="w-full text-sm text-muted-foreground" data-testid="write-blocked">{reason}</p>;
}
