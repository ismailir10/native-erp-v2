"use client";

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { useArrival } from "./arrival";

/** A `Progress` bar that fills from empty when its view arrives by navigation (same rule as `CountUp`). */
export function ProgressFill({ value, ...props }: { value: number; "aria-label"?: string }) {
  const arrive = useArrival();
  const [filled, setFilled] = useState(!arrive);
  useEffect(() => {
    if (filled) return;
    // One painted frame at 0 gives the width transition its start.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setFilled(true)));
    return () => cancelAnimationFrame(raf);
  }, [filled]);
  return <Progress value={filled ? value : 0} className="[&_[data-slot=progress-indicator]]:duration-700 [&_[data-slot=progress-indicator]]:ease-out" {...props} />;
}
