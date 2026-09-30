// Adapted from React Bits "StatusMark", done state (https://reactbits.dev, MIT + Commons Clause, see REACT-BITS-LICENSE.md):
// the ring and the check draw themselves once. SVG + CSS only (`.check-draw` in app/globals.css); static under reduced motion.

import { cn } from "@/lib/utils";

/** The done mark: same geometry as lucide `CircleCheck`, drawn in when it appears. */
export function CheckDraw({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("check-draw size-4 shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-testid="check-draw"
    >
      <circle cx="12" cy="12" r="10" pathLength={1} />
      <path d="m9 12 2 2 4-4" pathLength={1} />
    </svg>
  );
}
