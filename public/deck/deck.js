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

  function show(i, push) {
    cur = Math.max(0, Math.min(total - 1, i));
    slides.forEach(function (s, k) { s.classList.toggle("on", k === cur); });
    if (prev) prev.disabled = cur === 0;
    if (next) next.disabled = cur === total - 1;
    if (bar) bar.style.width = ((cur + 1) / total) * 100 + "%";
    if (push !== false && location.hash !== "#" + (cur + 1)) history.replaceState(null, "", "#" + (cur + 1));
  }

  function apply() {
    if (flow.matches) {
      slides.forEach(function (s) { s.classList.add("on"); });
      document.documentElement.classList.add("flow");
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
})();
