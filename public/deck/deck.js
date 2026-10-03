/* Buku product deck — navigation + motion.
   Vanilla port of a few React Bits-style effects (split text, shiny text, count-up, spotlight, magnet, dot-grid/aurora).
   Same-origin only: no network requests, no storage, no analytics. */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const slides = $$(".slide");
  const total = slides.length;
  const body = document.body;
  const reduceMQ = matchMedia("(prefers-reduced-motion: reduce)");
  const flowMQ = matchMedia("(max-width: 819px), (max-height: 540px)");
  const nf = new Intl.NumberFormat("id-ID");

  let cur = 0;
  let flow = false;
  let wheelLock = false;

  /* ---------- one-time prep ---------- */

  // Split text: words rise and un-blur, staggered.
  $$("[data-split]").forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = "";
    words.forEach((word, i) => {
      const w = document.createElement("span");
      w.className = "w";
      w.setAttribute("aria-hidden", "true");
      const inner = document.createElement("span");
      inner.style.setProperty("--i", i);
      inner.textContent = word;
      w.appendChild(inner);
      el.appendChild(w);
      if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
    });
  });

  // SVG draw-in needs pathLength=1 on every stroked element.
  $$(".draw").forEach((el) => el.setAttribute("pathLength", "1"));

  // Marquee tracks repeat once so the loop is seamless.
  $$("[data-dup]").forEach((track) => {
    $$(":scope > *", track).forEach((n) => {
      const c = n.cloneNode(true);
      c.setAttribute("aria-hidden", "true");
      track.appendChild(c);
    });
  });

  // Spotlight: radial highlight follows the pointer.
  $$(".spot").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", e.clientX - r.left + "px");
      el.style.setProperty("--my", e.clientY - r.top + "px");
    });
  });

  // Magnet: buttons lean toward the pointer.
  $$("[data-magnet]").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      if (reduceMQ.matches) return;
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      el.style.transform = `translate(${(dx * 10).toFixed(1)}px, ${(dy * 8).toFixed(1)}px)`;
    });
    el.addEventListener("pointerleave", () => (el.style.transform = ""));
  });

  /* ---------- count-up ---------- */

  const counters = $$("[data-count]").map((el) => ({ el, to: Number(el.dataset.to), final: el.textContent, raf: 0 }));
  function runCounts(slide) {
    counters
      .filter((c) => slide.contains(c.el))
      .forEach((c) => {
        cancelAnimationFrame(c.raf);
        if (reduceMQ.matches) return void (c.el.textContent = c.final);
        const t0 = performance.now() + 450;
        const dur = 1700;
        const step = (now) => {
          const k = Math.min(1, Math.max(0, (now - t0) / dur));
          const e = 1 - Math.pow(1 - k, 3);
          c.el.textContent = nf.format(Math.round(c.to * e));
          if (k < 1) c.raf = requestAnimationFrame(step);
          else c.el.textContent = c.final;
        };
        c.el.textContent = "0";
        c.raf = requestAnimationFrame(step);
      });
  }

  /* ---------- aurora + dot grid backgrounds ---------- */

  const BLOBS = [
    { x: 0.18, y: 0.28, r: 0.62, c: "29,91,216", a: 0.6, sx: 0.00011, sy: 0.00008, p: 0 },
    { x: 0.82, y: 0.18, r: 0.52, c: "18,135,111", a: 0.34, sx: 0.00007, sy: 0.00012, p: 2 },
    { x: 0.62, y: 0.86, r: 0.64, c: "91,155,255", a: 0.42, sx: 0.00009, sy: 0.0001, p: 4 },
    { x: 0.08, y: 0.92, r: 0.4, c: "155,77,202", a: 0.22, sx: 0.00013, sy: 0.00006, p: 1 },
  ];

  class Backdrop {
    constructor(canvas, slide, strength) {
      this.cv = canvas;
      this.ctx = canvas.getContext("2d");
      this.slide = slide;
      this.k = strength;
      this.px = -999;
      this.py = -999;
      this.visible = false;
      this.resize();
      slide.addEventListener("pointermove", (e) => {
        const r = this.cv.getBoundingClientRect();
        this.px = e.clientX - r.left;
        this.py = e.clientY - r.top;
      });
      slide.addEventListener("pointerleave", () => ((this.px = -999), (this.py = -999)));
      new ResizeObserver(() => this.resize()).observe(slide);
    }
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const r = this.slide.getBoundingClientRect();
      this.w = Math.max(1, Math.round(r.width));
      this.h = Math.max(1, Math.round(r.height));
      this.cv.width = Math.round(this.w * dpr);
      this.cv.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw(0);
    }
    draw(t) {
      const { ctx, w, h } = this;
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const m = Math.max(w, h);
      for (const b of BLOBS) {
        const cx = (b.x + 0.1 * Math.sin(t * b.sx + b.p)) * w;
        const cy = (b.y + 0.1 * Math.cos(t * b.sy + b.p)) * h;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, b.r * m);
        g.addColorStop(0, `rgba(${b.c},${(b.a * this.k).toFixed(3)})`);
        g.addColorStop(1, `rgba(${b.c},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = "source-over";
      const step = 30;
      const reach = 170;
      for (let y = step / 2; y < h; y += step) {
        for (let x = step / 2; x < w; x += step) {
          const d = Math.hypot(x - this.px, y - this.py);
          const n = Math.max(0, 1 - d / reach);
          ctx.fillStyle = `rgba(190,212,255,${(0.09 + 0.6 * n).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(x, y, 0.9 + 1.7 * n, 0, 6.2832);
          ctx.fill();
        }
      }
    }
  }

  const backdrops = slides
    .map((s, i) => {
      const cv = $("canvas.bg", s);
      return cv ? new Backdrop(cv, s, i === 0 || i === total - 1 ? 1 : 0.62) : null;
    })
    .filter(Boolean);

  let looping = false;
  function loop(now) {
    if (document.hidden || reduceMQ.matches) return void (looping = false);
    let any = false;
    for (const b of backdrops) {
      if (!b.visible) continue;
      b.draw(now);
      any = true;
    }
    if (any) requestAnimationFrame(loop);
    else looping = false;
  }
  function kick() {
    if (looping || reduceMQ.matches) {
      if (reduceMQ.matches) backdrops.forEach((b) => b.visible && b.draw(0));
      return;
    }
    looping = true;
    requestAnimationFrame(loop);
  }
  document.addEventListener("visibilitychange", kick);

  /* ---------- chrome ---------- */

  const nav = $("#nav");
  const dots = slides.map((s, i) => {
    const b = document.createElement("button");
    b.className = "dot";
    b.type = "button";
    b.setAttribute("aria-label", `Slide ${i + 1}: ${s.getAttribute("aria-label") || ""}`);
    b.addEventListener("click", () => go(i));
    nav.appendChild(b);
    return b;
  });
  const curEl = $("#cur");
  $("#tot").textContent = String(total).padStart(2, "0");
  const bar = $("#bar");
  const prevBtn = $("#prev");
  const nextBtn = $("#next");
  const hint = $("#hint");
  prevBtn.addEventListener("click", () => go(cur - 1));
  nextBtn.addEventListener("click", () => go(cur + 1));

  function paint(n) {
    cur = n;
    body.dataset.theme = slides[n].dataset.theme;
    curEl.textContent = String(n + 1).padStart(2, "0");
    dots.forEach((d, i) => d.setAttribute("aria-current", i === n ? "true" : "false"));
    prevBtn.disabled = n === 0;
    nextBtn.disabled = n === total - 1;
    if (!flow) bar.style.width = ((n + 1) / total) * 100 + "%";
  }

  /* ---------- presenter mode ---------- */

  function show(n) {
    slides.forEach((s, i) => {
      const active = i === n;
      s.classList.toggle("is-active", active);
      s.toggleAttribute("inert", !active);
      s.setAttribute("aria-hidden", active ? "false" : "true");
      if (!active) {
        // let the fade-out finish, then reset so the slide replays on re-entry
        setTimeout(() => !s.classList.contains("is-active") && s.classList.remove("on"), 650);
      }
    });
    backdrops.forEach((b) => (b.visible = b.slide === slides[n]));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!slides[n].classList.contains("is-active")) return;
        slides[n].classList.add("on");
        runCounts(slides[n]);
        kick();
      })
    );
  }

  function go(n) {
    n = Math.max(0, Math.min(total - 1, n));
    if (flow) {
      slides[n].scrollIntoView({ behavior: reduceMQ.matches ? "auto" : "smooth", block: "start" });
      return;
    }
    if (n === cur && slides[n].classList.contains("is-active")) return;
    paint(n);
    show(n);
    history.replaceState(null, "", "#" + (n + 1));
    hint.classList.add("gone");
  }

  /* ---------- flow mode (phones, short windows): normal scrolling ---------- */

  const seen = new Map();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const i = slides.indexOf(e.target);
        seen.set(i, e.intersectionRatio);
        if (e.isIntersecting && e.intersectionRatio > 0.18 && !e.target.classList.contains("on")) {
          e.target.classList.add("on");
          runCounts(e.target);
        }
        const bd = backdrops.find((b) => b.slide === e.target);
        if (bd) bd.visible = e.isIntersecting;
      }
      if (!flow) return;
      let best = 0;
      let bestR = -1;
      seen.forEach((r, i) => r > bestR && ((bestR = r), (best = i)));
      paint(best);
      kick();
    },
    { threshold: [0, 0.18, 0.4, 0.6, 0.8] }
  );

  function onScroll() {
    if (!flow) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = (max > 0 ? Math.min(1, scrollY / max) * 100 : 0) + "%";
  }
  addEventListener("scroll", onScroll, { passive: true });

  function applyMode() {
    flow = flowMQ.matches;
    body.classList.toggle("flow", flow);
    if (flow) {
      slides.forEach((s) => {
        s.classList.remove("is-active");
        s.removeAttribute("inert");
        s.removeAttribute("aria-hidden");
        io.observe(s);
      });
      onScroll();
    } else {
      slides.forEach((s) => io.unobserve(s));
      slides.forEach((s) => s.classList.remove("on"));
      paint(cur);
      show(cur);
    }
  }
  flowMQ.addEventListener("change", applyMode);
  reduceMQ.addEventListener("change", () => {
    kick();
    if (reduceMQ.matches) counters.forEach((c) => (c.el.textContent = c.final));
  });

  /* ---------- input ---------- */

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === "f" || k === "F") {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => {});
      return;
    }
    if (flow) return;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " ") go(cur + 1);
    else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "Backspace") go(cur - 1);
    else if (k === "Home") go(0);
    else if (k === "End") go(total - 1);
    else return;
    e.preventDefault();
  });

  addEventListener(
    "wheel",
    (e) => {
      if (flow || wheelLock || Math.abs(e.deltaY) < 24) return;
      wheelLock = true;
      go(cur + (e.deltaY > 0 ? 1 : -1));
      setTimeout(() => (wheelLock = false), 800);
    },
    { passive: true }
  );

  let tx = 0;
  let ty = 0;
  addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    tx = e.clientX;
    ty = e.clientY;
  });
  addEventListener("pointerup", (e) => {
    if (flow || e.pointerType === "mouse") return;
    const dx = e.clientX - tx;
    const dy = e.clientY - ty;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(cur + (dx < 0 ? 1 : -1));
    else if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx)) go(cur + (dy < 0 ? 1 : -1));
  });

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-next], [data-go]");
    if (!a) return;
    e.preventDefault();
    if (a.hasAttribute("data-next")) go(cur + 1);
    else go(Number(a.dataset.go));
  });

  addEventListener("hashchange", () => {
    const n = parseInt(location.hash.slice(1), 10);
    if (n >= 1 && n <= total && n - 1 !== cur) go(n - 1);
  });

  /* ---------- start ---------- */

  const start = parseInt(location.hash.slice(1), 10);
  cur = start >= 1 && start <= total ? start - 1 : 0;
  paint(cur);
  const boot = () => {
    applyMode();
    if (flow && cur > 0) slides[cur].scrollIntoView();
  };
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(boot, 60));
})();
