// RVOL Tools — full-width layout for kite.zerodha.com.
//
// Kite renders inside a centered, fixed-width box; on a wide monitor most of
// the screen is wasted margin and the chart is far smaller than it could be.
// This stretches the boxed layout across the window, with an optional width
// CAP so that on an ultrawide the watchlist is not shoved to the far left
// edge (the widened app stays centered at the cap).
//
// No selectors are hard-coded: a layout "shell" is detected structurally —
// an element much narrower than the viewport, with roughly equal side gaps,
// holding most of the page width. Every shell found gets
// width:100% / max-width:<cap> / margin:auto inline (with !important), which
// beats Kite's stylesheet without touching it. Re-scanned every 1.5s so SPA
// remounts and route changes are picked up; turning the toggle off restores
// Kite's own styles by removing only the properties we set.
//
// Toggles: kiteWide (default OFF here), kiteWideMax px (default 2600, 0 = no cap).
// Self-contained IIFE — no globals leak (collision-trap note in
// kite-content.js).

(() => {
  "use strict";
  if (window.top !== window) return;
  if (location.hostname !== "kite.zerodha.com") return;

  const PROPS = ["width", "max-width", "margin-left", "margin-right"];
  let on = true;
  let capPx = 2600;
  const touched = new Set();

  const vw = () => document.documentElement.clientWidth;

  function isShell(el) {
    const w = vw();
    const r = el.getBoundingClientRect();
    if (r.width < Math.max(700, w * 0.3)) return false; // too narrow: widgets, modals
    if (r.width > w - 120) return false; // already (nearly) full width
    const left = r.left;
    const right = w - r.right;
    return left > 40 && right > 40 && Math.abs(left - right) < 90; // centered
  }

  function findShells() {
    const out = [];
    const walk = (el, depth) => {
      if (depth > 7) return;
      for (const c of el.children) {
        if (!(c instanceof HTMLElement)) continue;
        if (isShell(c)) out.push(c);
        walk(c, depth + 1);
      }
    };
    if (document.body) walk(document.body, 0);
    return out;
  }

  function widen(el) {
    touched.add(el);
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("max-width", capPx > 0 ? capPx + "px" : "none", "important");
    el.style.setProperty("margin-left", "auto", "important");
    el.style.setProperty("margin-right", "auto", "important");
  }

  function apply() {
    for (const el of touched) if (el.isConnected) widen(el); // cap changes re-paint
    for (const el of findShells()) widen(el);
  }

  function revert() {
    for (const el of touched) for (const p of PROPS) el.style.removeProperty(p);
    touched.clear();
  }

  const refresh = () => (on ? apply() : revert());

  chrome.storage?.local.get({ kiteWide: false, kiteWideMax: 2600 }).then((s) => {
    on = s.kiteWide === true;
    capPx = Number.isFinite(+s.kiteWideMax) ? Math.max(0, Math.round(+s.kiteWideMax)) : 2600;
    refresh();
  });
  chrome.storage?.onChanged.addListener((c) => {
    if ("kiteWide" in c) on = c.kiteWide.newValue === true;
    if ("kiteWideMax" in c) {
      const v = +c.kiteWideMax.newValue;
      capPx = Number.isFinite(v) ? Math.max(0, Math.round(v)) : capPx;
    }
    if ("kiteWide" in c || "kiteWideMax" in c) refresh();
  });

  setInterval(() => { if (on) apply(); }, 1500);
  window.addEventListener("resize", () => { if (on) apply(); });

})();
