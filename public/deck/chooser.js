/* /deck chooser: scale each cover thumbnail (a 1600×900 iframe of the deck's first slide) to its card. External file because the CSP allows no inline script. */
(function () {
  function fit() {
    document.querySelectorAll(".card-thumb").forEach(function (t) {
      var f = t.firstElementChild;
      f.style.transform = "scale(" + t.clientWidth / 1600 + ")";
    });
  }
  fit();
  window.addEventListener("resize", fit);
})();
