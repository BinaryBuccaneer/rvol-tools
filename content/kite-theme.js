// TradingView-flavored colors for Zerodha Kite (light AND dark).
//
// Kite themes entirely through CSS custom properties (--color-*): the light
// values sit on :root and the dark set is re-declared under [data-theme=dark]
// (read from Kite's real public stylesheet, static/css/async/main.*.css). So
// a re-skin is just re-declaring those variables; every component
// (watchlist, order window, header, chart drawer) follows on its own.
//
// Both palettes are injected once and GATED BY SELECTOR, no JS watching:
//   dark  -> [data-theme=dark] { ... }
//   light -> :root:not([data-theme=dark]):not(:has([data-theme=dark])) { ... }
// The :has() covers Kite putting the attribute on any element; flipping
// Kite's theme swaps palettes instantly because the selectors trade places.
//
// The palettes map Kite's tokens to TradingView's look: TV's vivid green/red
// instead of Kite's muted sage/coral (the up/down colors are what make a
// watchlist read "TV" at a glance; confirmed usage: up = --color-text-8,
// down = --color-text-7/-10), TV's blue, near-black surfaces in dark /
// TV-light greys in light, brighter text. DARK/LIGHT below are the tuning
// spots. Values are !important so they beat Kite's later-loading async CSS.
// Toggle `kiteTvTheme` (default OFF). Self-contained IIFE.

(() => {
  "use strict";
  if (window.top !== window) return;
  if (location.hostname !== "kite.zerodha.com") return;

  const STYLE_ID = "rvt-tvtheme-style";

  // token -> TV value. "--rgb" twins are derived automatically.
  const DARK = {
    // surfaces: neutral near-black (Kite dark is #181818 on #111)
    "--color-bg-body": "#0d0d0d",
    "--color-bg-default": "#131313",
    "--color-bg-1": "#101010",
    "--color-bg-9": "#1b1b1b",
    "--color-bg-10": "#1b1b1b",
    "--color-bg-11": "#1b1b1b",
    // lines
    "--color-border-default": "#262626",
    "--color-border-1": "#262626",
    "--color-border-5": "#262626",
    "--color-border-10": "#262626",
    "--color-border-9": "#2e2e2e",
    // text: TV's brighter grey (Kite dark text is #bbb, labels #666)
    "--color-text-default": "#d1d4dc",
    "--color-text-6": "#d1d4dc",
    "--color-text-1": "#7d828c",
    "--color-text-2": "#6f747e",
    // up / green (TV positive)
    "--color-text-8": "#089981",
    "--color-bg-8": "#089981",
    // down / red (TV negative)
    "--color-text-7": "#f23645",
    "--color-text-10": "#f23645",
    "--color-bg-7": "#f23645",
    "--color-border-8": "#f23645",
    // blue accents / buy (TV blue)
    "--color-text-4": "#2962ff",
    "--color-bg-5": "#2962ff",
    "--color-border-6": "#2962ff",
  };

  const LIGHT = {
    // surfaces: white panels on TV's pale blue-grey page
    "--color-bg-body": "#f0f3fa",
    "--color-bg-default": "#ffffff",
    "--color-bg-1": "#f8f9fd",
    "--color-bg-9": "#f0f3fa",
    "--color-bg-10": "#f0f3fa",
    "--color-bg-11": "#f0f3fa",
    // lines
    "--color-border-default": "#e0e3eb",
    "--color-border-1": "#e0e3eb",
    "--color-border-5": "#e0e3eb",
    "--color-border-10": "#e0e3eb",
    "--color-border-9": "#d1d4dc",
    // text: TV's ink
    "--color-text-default": "#131722",
    "--color-text-6": "#131722",
    "--color-text-1": "#787b86",
    "--color-text-2": "#6a6d78",
    // up / down / blue: same TV accents in both themes
    "--color-text-8": "#089981",
    "--color-bg-8": "#089981",
    "--color-text-7": "#f23645",
    "--color-text-10": "#f23645",
    "--color-bg-7": "#f23645",
    "--color-border-8": "#f23645",
    "--color-text-4": "#2962ff",
    "--color-bg-5": "#2962ff",
    "--color-border-6": "#2962ff",
  };

  const rgbOf = (hex) => {
    const h = hex.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",");
  };

  const declBlock = (map) => {
    let body = "";
    for (const [k, v] of Object.entries(map)) {
      body += `${k}:${v}!important;${k}--rgb:${rgbOf(v)}!important;`;
    }
    return body;
  };

  function buildCss() {
    return (
      `[data-theme=dark]{${declBlock(DARK)}scrollbar-color:#2a2a2a #131313!important;}` +
      `:root:not([data-theme=dark]):not(:has([data-theme=dark])){${declBlock(LIGHT)}}`
    );
  }

  function apply() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = buildCss();
    (document.head || document.documentElement).appendChild(st);
  }

  const revert = () => document.getElementById(STYLE_ID)?.remove();

  chrome.storage?.local.get({ kiteTvTheme: false }).then((s) => {
    if (s.kiteTvTheme === true) apply();
  });
  chrome.storage?.onChanged.addListener((c) => {
    if (!("kiteTvTheme" in c)) return;
    c.kiteTvTheme.newValue === true ? apply() : revert();
  });
})();
