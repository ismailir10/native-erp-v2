"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * A file chosen before React attached (the page streams in and is visible first) sits in the input but never reached state:
 * React replays typed text into controlled fields, not a file input's change. Pick it up once, on mount.
 */
export function useKeepEarlyFile(ref: RefObject<HTMLInputElement | null>, adopt: (file: File) => void) {
  useLayoutEffect(() => {
    const file = ref.current?.files?.[0];
    if (file) adopt(file);
    // Once, on mount: later choices arrive through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
