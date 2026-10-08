/* Buku decks — slide engine. No dependencies, no network.
   Stage mode: one slide at a time (arrows, space, PageUp/PageDown, Home/End, swipe, #n, F for fullscreen).
   Flow mode (narrow or portrait): plain scroll, nothing paginated. */
(function () {
  "use strict";
  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  if (!slides.length) return;
  var total = slides.length;
  var flow = window.matchMedia("(max-width: 899px), (max-aspect-ratio: 5/4)");
  var prev = document.getElementById("prev");
  var next = document.getElementById("next");
  var bar = document.getElementById("bar");
  var cur = 0;

  function pad(n) { return n < 10 ? "0" + n : String(n); }
  slides.forEach(function (s, i) {
    s.id = "s" + (i + 1);
    var n = s.querySelector(".s-foot .n");
    if (n) n.textContent = pad(i + 1) + " / " + pad(total);
  });

  function fromHash() {
    var m = /^#(\d+)$/.exec(location.hash);
    var i = m ? parseInt(m[1], 10) - 1 : 0;
    return Math.max(0, Math.min(total - 1, i));
  }

  var show = function (i, push) {
    cur = Math.max(0, Math.min(total - 1, i));
    slides.forEach(function (s, k) { s.classList.toggle("on", k === cur); });
    if (prev) prev.disabled = cur === 0;
    if (next) next.disabled = cur === total - 1;
    if (bar) bar.style.width = ((cur + 1) / total) * 100 + "%";
    if (push !== false && location.hash !== "#" + (cur + 1)) history.replaceState(null, "", "#" + (cur + 1));
  };

  function apply() {
    if (flow.matches) {
      slides.forEach(function (s) { s.classList.add("on"); });
      document.documentElement.classList.add("flow");
      // Slide ids are assigned after the browser's own fragment navigation, so honour #n here.
      if (/^#\d+$/.test(location.hash)) slides[fromHash()].scrollIntoView();
    } else {
      document.documentElement.classList.remove("flow");
      show(fromHash(), false);
    }
  }

  function go(d) { if (!flow.matches) show(cur + d); }

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || flow.matches) return;
    var k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " " || k === "Enter") { e.preventDefault(); go(1); }
    else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "Backspace") { e.preventDefault(); go(-1); }
    else if (k === "Home") { e.preventDefault(); show(0); }
    else if (k === "End") { e.preventDefault(); show(total - 1); }
    else if (k === "f" || k === "F") {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    }
  });

  if (prev) prev.addEventListener("click", function () { go(-1); });
  if (next) next.addEventListener("click", function () { go(1); });

  var sx = null, sy = null;
  document.addEventListener("touchstart", function (e) { var t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
  document.addEventListener("touchend", function (e) {
    if (sx === null || flow.matches) return;
    var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    sx = sy = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  window.addEventListener("hashchange", function () { if (!flow.matches) show(fromHash(), false); });
  if (flow.addEventListener) flow.addEventListener("change", apply); else flow.addListener(apply);

  // in-deck links like <a href="#3">
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || flow.matches) return;
    var m = /^#(\d+)$/.exec(a.getAttribute("href"));
    if (m) { e.preventDefault(); show(parseInt(m[1], 10) - 1); }
  });

  apply();

  /* ---- motion: vanilla ports in the manner of React Bits (CountUp, AnimatedList, DotGrid, SpotlightCard) ----
     Everything is skipped under prefers-reduced-motion and in flow mode; print shows the final state. */
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var STAGGER = ".c, .file, .bubble, .mini, .reader, .tool, .chain li, .cascade li, .pts li, .qa, .tn, .msg-r, .tags span, .ans li, .kinds li, .how3 li, .calcbig, .paper, .bridge, .src2 > div, .out2 > div, .gate, .side3 .pk, table.seq tr";
  var DRAW = ".pill svg, .so i svg, .dc svg";

  slides.forEach(function (s) {
    var n = 0;
    s.querySelectorAll(STAGGER).forEach(function (el) {
      el.setAttribute("data-s", "");
      el.style.setProperty("--d", Math.min(n, 18) * 65);
      n++;
    });
    var k = 0;
    s.querySelectorAll(DRAW).forEach(function (el) { el.style.setProperty("--k", Math.min(k, 14) * 110); k++; });
  });

  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function countUp(el) {
    var full = el.getAttribute("data-final") || el.textContent;
    el.setAttribute("data-final", full);
    var m = /^(\D*?)([\d][\d.]*)(\D*)$/.exec(full.trim());
    if (!m) return;
    var to = parseInt(m[2].replace(/\./g, ""), 10);
    if (!isFinite(to) || to < 10) { el.textContent = full; return; }
    var t0 = null, dur = 1100, delay = 450;
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var t = (ts - t0 - delay) / dur;
      if (t < 0) { el.textContent = m[1] + "0" + m[3]; requestAnimationFrame(frame); return; }
      if (t >= 1) { el.textContent = full; return; }
      el.textContent = m[1] + Math.round(to * ease(t)).toLocaleString("id-ID") + m[3];
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function enter(i) {
    var s = slides[i];
    if (!s || reduce.matches || flow.matches) return;
    s.querySelectorAll("[data-count]").forEach(countUp);
  }
  var baseShow = show;
  show = function (i, push) { baseShow(i, push); enter(cur); };

  // DotGrid (navy slides): quiet dots that brighten near the pointer; redraws only when the pointer moves.
  slides.forEach(function (s) {
    if (!s.classList.contains("navy")) return;
    var c = document.createElement("canvas");
    c.className = "dots"; c.setAttribute("aria-hidden", "true");
    s.insertBefore(c, s.firstChild);
    var ctx = c.getContext("2d"), px = { x: -1e4, y: -1e4 }, raf = 0, W = 0, H = 0, dots = [];
    function build() {
      var r = s.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      W = r.width; H = r.height; if (!W) return;
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var gap = W / 64; dots = [];
      for (var y = gap / 2; y < H; y += gap) for (var x = gap / 2; x < W; x += gap) dots.push([x, y]);
      draw();
    }
    function draw() {
      raf = 0; ctx.clearRect(0, 0, W, H);
      var prox = W * 0.09, p2 = prox * prox, r0 = W / 900;
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i], dx = d[0] - px.x, dy = d[1] - px.y, dd = dx * dx + dy * dy, t = dd < p2 ? 1 - Math.sqrt(dd) / prox : 0;
        ctx.fillStyle = "rgba(" + (160 + 60 * t) + "," + (190 + 50 * t) + ",255," + (0.10 + 0.7 * t) + ")";
        ctx.beginPath(); ctx.arc(d[0], d[1], r0 * (1 + 1.2 * t), 0, 6.2832); ctx.fill();
      }
    }
    s.addEventListener("mousemove", function (e) {
      if (reduce.matches) return;
      var r = s.getBoundingClientRect(); px.x = e.clientX - r.left; px.y = e.clientY - r.top;
      if (!raf) raf = requestAnimationFrame(draw);
    });
    s.addEventListener("mouseleave", function () { px.x = px.y = -1e4; if (!raf) raf = requestAnimationFrame(draw); });
    window.addEventListener("resize", build);
    build();
  });

  // print / PDF always shows the final numbers, even if a count-up is mid-flight
  window.addEventListener("beforeprint", function () {
    document.querySelectorAll("[data-final]").forEach(function (el) { el.textContent = el.getAttribute("data-final"); });
  });
  enter(cur);
})();
