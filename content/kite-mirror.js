// Kite Tools — watchlist on the RIGHT, TradingView-style.
//
// Kite pins the marketwatch to the left; he charts TV-style and wants the
// chart on the left, list on the right. Grounded in Kite's real (public)
// stylesheet, not guesses — Kite has TWO desktop layouts:
//
//   classic (dashboard/orders/positions/holdings):
//     .app .container            display:flex
//     .container-left            position:fixed; width:var(--left-content-width)
//                                (no `left`, so it sits at its static spot)
//     .container-right           margin-left:var(--left-content-width); flex:1
//     -> mirror = set the panel's fixed `left` to the container's right edge
//        minus its width (computed live, so it tracks the Full-width cap and
//        window resizes), and swap the content margin to the right.
//
//   extended (the /markets/chart pages):
//     .app.extended .container > .container-left-extended   in-flow drawer
//     -> mirror = flex `order:2` on the drawer (pure CSS, no math) and flip
//        its collapse handle to poke out of the LEFT side.
//
// Both are style-only: no DOM moves, so Vue, drag-reorder, hover buttons,
// the sorter, badges and chart-scroll are untouched. Toggle `kiteMirror`
// (default OFF); re-applied on a 1s scan like kite-wide so SPA remounts,
// cap changes and resizes are picked up. Self-contained IIFE (collision-trap
// note in kite-content.js).

(() => {
  "use strict";
  if (window.top !== window) return;
  if (location.hostname !== "kite.zerodha.com") return;

  const STYLE_ID = "rvt-mirror-style";
  const CSS =
    // extended layout (chart page): move the drawer right, flip its handle
    "html.rvt-mirror .app.extended .container > .container-left-extended{order:2}" +
    "html.rvt-mirror .app.extended .container > .container-left-extended .drawer-handle{" +
    "right:auto;left:-23px;border-radius:3px 0 0 3px}" +
    // classic layout: shadow falls to the left once the panel is on the right
    "html.rvt-mirror .app .container .container-left{box-shadow:-1px 0 5px rgba(0,0,0,.35)}";

  let on = false;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function apply() {
    ensureStyle();
    document.documentElement.classList.add("rvt-mirror");
    // classic layout needs computed px for the fixed panel
    const panel = document.querySelector(".app .container > .container-left");
    const main = document.querySelector(".app .container > .container-right");
    const box = panel && panel.parentElement;
    if (!panel || !main || !box) return;
    const br = box.getBoundingClientRect();
    const pw = panel.getBoundingClientRect().width;
    if (!br.width || !pw) return;
    panel.style.setProperty("left", Math.round(br.right - pw) + "px", "important");
    main.style.setProperty("margin-left", "0px", "important");
    main.style.setProperty("margin-right", Math.round(pw) + "px", "important");
  }

  function revert() {
    document.documentElement.classList.remove("rvt-mirror");
    const panel = document.querySelector(".app .container > .container-left");
    const main = document.querySelector(".app .container > .container-right");
    if (panel) panel.style.removeProperty("left");
    if (main) {
      main.style.removeProperty("margin-left");
      main.style.removeProperty("margin-right");
    }
  }

  const refresh = () => (on ? apply() : revert());

  chrome.storage?.local.get({ kiteMirror: false }).then((s) => {
    on = s.kiteMirror === true;
    refresh();
  });
  chrome.storage?.onChanged.addListener((c) => {
    if (!("kiteMirror" in c)) return;
    on = c.kiteMirror.newValue === true;
    refresh();
  });

  setInterval(() => { if (on) apply(); }, 1000);
  window.addEventListener("resize", () => { if (on) apply(); });
})();
