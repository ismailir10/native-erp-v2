import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { easeOutCubic, tweenCount, tweenMinor } from "@/lib/motion";
import { CountUp } from "@/components/motion/count-up";
import { CheckDraw } from "@/components/motion/check-draw";
import { formatMoneyCompact } from "@/lib/money";

describe("motion helpers", () => {
  it("tweens money in bigint, exact at both ends", () => {
    const to = 9_007_199_254_740_993_123n; // beyond Number precision
    expect(tweenMinor(0n, to, 0)).toBe(0n);
    expect(tweenMinor(0n, to, 1)).toBe(to);
    expect(tweenMinor(0n, to, 1.2)).toBe(to);
    expect(tweenMinor(0n, to, Number.NaN)).toBe(0n);
    expect(typeof tweenMinor(0n, to, 0.5)).toBe("bigint");
    expect(tweenMinor(0n, 1000n, 0.5)).toBe(500n);
  });

  it("is monotone toward the target, for negatives too", () => {
    for (const to of [12_345_678n, -4_500_000n]) {
      let prev = 0n;
      for (let i = 0; i <= 100; i++) {
        const v = tweenMinor(0n, to, easeOutCubic(i / 100));
        if (to > 0n) expect(v >= prev).toBe(true);
        else expect(v <= prev).toBe(true);
        prev = v;
      }
      expect(prev).toBe(to);
    }
  });

  it("counts land on the target only at the end", () => {
    expect(tweenCount(0, 5, 0.99)).toBe(4);
    expect(tweenCount(0, 5, 1)).toBe(5);
    expect(tweenCount(0, -5, 0.99)).toBe(-4);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe("motion components on the server", () => {
  it("CountUp renders the final value, so server HTML and hydration never show a frame", () => {
    const html = renderToString(createElement(CountUp, { value: 1_234_567_890n, currency: "IDR" }));
    expect(html).toContain(formatMoneyCompact(1_234_567_890n, "IDR"));
    expect(renderToString(createElement(CountUp, { value: 7, suffix: "/9" }))).toContain("7<!-- -->/9");
  });

  it("CheckDraw keeps an accessible label when given one", () => {
    expect(renderToString(createElement(CheckDraw, { label: "Selesai" }))).toContain('aria-label="Selesai"');
    expect(renderToString(createElement(CheckDraw, {}))).toContain('aria-hidden="true"');
  });
});
