/**
 * Pure helpers behind the motion components (components/motion). Money stays bigint while it moves:
 * a frame is `from + (to - from) × k / 1000` with an integer step k, never a Number of the amount (accounting-rules §Money).
 */

/** Ease-out cubic: fast start, gentle landing. `t` in 0..1. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

const STEPS = 1000n;

/** A money frame between `from` and `to` (minor units) at progress `t` (0..1). Exact at both ends, monotone in between. */
export function tweenMinor(from: bigint, to: bigint, t: number): bigint {
  if (!(t > 0)) return from;
  if (t >= 1) return to;
  const k = BigInt(Math.round(t * Number(STEPS)));
  return from + ((to - from) * k) / STEPS;
}

/** A count frame (rows, clients, controls — never money) at progress `t`; rounds toward the start so it lands on `to` only at the end. */
export function tweenCount(from: number, to: number, t: number): number {
  if (!(t > 0)) return from;
  if (t >= 1) return to;
  const v = from + (to - from) * t;
  return to >= from ? Math.floor(v) : Math.ceil(v);
}
