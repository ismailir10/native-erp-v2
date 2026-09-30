"use client";

import { useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * Whether this mount should play its arrival motion: yes when React mounted it on the client (an in-app navigation),
 * no when it hydrated from server HTML (the final value was already painted; replaying from zero would flash) and
 * no under `prefers-reduced-motion`. Decided once per mount.
 */
export function useArrival(): boolean {
  // getServerSnapshot is used on the server and while hydrating; a client-only mount reads getSnapshot.
  const hydrating = useSyncExternalStore(noSubscribe, () => false, () => true);
  const [arrive] = useState(() => !hydrating && !reducedMotion());
  return arrive;
}

export function reducedMotion(): boolean {
  return typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
