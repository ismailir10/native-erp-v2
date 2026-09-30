"use client";

// Adapted from React Bits "DotGrid" (https://reactbits.dev, MIT + Commons Clause, see REACT-BITS-LICENSE.md):
// rewritten without gsap — no inertia or shock waves, dots near the pointer only tint and grow. Colours come from the
// design tokens, and the canvas redraws only when the pointer moves (no idle animation loop).

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { reducedMotion } from "./arrival";

type Rgb = { r: number; g: number; b: number };

/** A quiet grid of hairline dots behind the auth pages; dots within `proximity` px of a mouse pointer turn the brand blue. */
export function DotGrid({ gap = 24, dotSize = 2, proximity = 130, className }: { gap?: number; dotSize?: number; proximity?: number; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;

    const css = getComputedStyle(document.documentElement);
    const base = hexToRgb(css.getPropertyValue("--input")) ?? { r: 135, g: 146, b: 162 };
    const active = hexToRgb(css.getPropertyValue("--primary")) ?? { r: 29, g: 91, b: 216 };
    const pointer = { x: -1e4, y: -1e4 };
    let dots: { x: number; y: number }[] = [];
    let width = 0;
    let height = 0;
    let raf = 0;

    const draw = () => {
      raf = 0;
      ctx.clearRect(0, 0, width, height);
      const prox2 = proximity * proximity;
      for (const d of dots) {
        const dx = d.x - pointer.x;
        const dy = d.y - pointer.y;
        const dist2 = dx * dx + dy * dy;
        // t: 0 far away → 1 under the pointer.
        const t = dist2 < prox2 ? 1 - Math.sqrt(dist2) / proximity : 0;
        ctx.fillStyle = `rgba(${mix(base.r, active.r, t)},${mix(base.g, active.g, t)},${mix(base.b, active.b, t)},${0.35 + 0.65 * t})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, (dotSize / 2) * (1 + 0.6 * t), 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };

    const build = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.floor(width / gap);
      const rows = Math.floor(height / gap);
      const x0 = (width - (cols - 1) * gap) / 2;
      const y0 = (height - (rows - 1) * gap) / 2;
      dots = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) dots.push({ x: x0 + x * gap, y: y0 + y * gap });
      schedule();
    };

    build();
    const ro = new ResizeObserver(build);
    ro.observe(wrap);

    // Pointer reaction only for a mouse and only when motion is welcome; touch and reduced motion keep the static grid.
    const still = reducedMotion();
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      schedule();
    };
    const onLeave = () => {
      pointer.x = pointer.y = -1e4;
      schedule();
    };
    if (!still) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [gap, dotSize, proximity]);

  return (
    <div ref={wrapRef} aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} data-testid="dot-grid">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}

function mix(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function hexToRgb(value: string): Rgb | null {
  const m = value.trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}
