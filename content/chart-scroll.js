// RVOL Tools — arrow-key chart scrolling + click-name-to-open-chart.
//
// On kite.zerodha.com/markets/chart/... (the full-page chart with the
// marketwatch on the left), ArrowDown/ArrowUp opens the NEXT/PREVIOUS
// watchlist stock's chart, TradingView-style, wrapping around at both ends.
// The charted stock's row always carries a gold marker (synced on load and
// whenever the chart changes, however it changes) and scrolls into view.
// Works with BOTH chart engines (TradingView "tvc" and ChartIQ "ciq") —
// the engine is just a path segment we parse, and the switch goes through
// Kite's own chart button, which respects whatever engine is set.
//
// Clicking anywhere on a stock's ROW opens its chart — on ANY Kite page
// (dashboard, positions, holdings, chart page). Name, blank space, the VWAP
// badge: all count. Only the six-dot drag handle and the hover
// Buy/Sell/depth/chart/delete buttons keep their own jobs.
//
// Runs in ALL frames (the chart itself lives in an iframe, which owns the
// keyboard focus most of the time): child frames just relay arrow presses
// to the top frame via postMessage; the top frame does everything else.
//
// How the chart actually switches, in order of preference:
//   1. Click Kite's own chart hover-button on the row (tooltip "Chart (C)")
//      — native SPA switch, instant, engine-aware. This is the proven path.
//   2. pushState to the chart URL + a synthetic popstate, so Kite's router
//      swaps without a reload. Needs the instrument token, which the service
//      worker resolves from Zerodha's PUBLIC instruments dump
//      (api.kite.trade/instruments/<exchange>, no login, cached daily).
//   3. Plain navigation to the chart URL (full reload — always works).
// Attempts are verified (URL/title shows the new symbol) before falling
// through. A synthetic "press C" strategy was tried (v0.10.1) and REVERTED:
// waiting to see whether Kite honored the untrusted keypress added visible
// lag before the button fallback fired.
//
// Toggle: chartScroll (default ON). Self-contained IIFE — no globals leak
// (see the collision-trap note in kite-content.js).

(() => {
  "use strict";

  // engine ("tvc" = TradingView, "ciq" = ChartIQ) / exchange / symbol / token
  const CHART_PATH = /\/markets\/chart\/web\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)/;
  const ROW = ".item-wrapper.draggable-item"; // confirmed Kite watchlist row
  const MSG_KEY = "rvtChartScrollStep";

  let enabled = true;

  // If the (private) Kite Tools extension is also installed and its own
  // chart-scroll is active, it stamps data-kt-cs on the document. This copy
  // then stands down completely so arrows/clicks aren't handled twice.
  const foreignOwner = () => document.documentElement.hasAttribute("data-kt-cs");

  const isTyping = (el) =>
    !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

  // True when the TOP page of this tab is the Kite chart page. Child frames
  // check it through window.top (same-origin on the chart page); cross-origin
  // frames throw -> false, so the arrows stay inert everywhere else.
  function topIsChartPage() {
    try {
      return (
        window.top.location.hostname === "kite.zerodha.com" &&
        CHART_PATH.test(window.top.location.pathname)
      );
    } catch (_) {
      return false;
    }
  }

  // ---- child frames: relay arrows to the top frame, nothing more ----------
  // Injected at document_start into every frame (including opaque/about:blank
  // ones via match_origin_as_fallback), so this capture listener registers
  // BEFORE the chart library's own key handling and wins the arrows.
  if (window.top !== window) {
    // If the top URL is readable, only relay on the chart page. If it is NOT
    // readable (sandboxed/opaque frame — the chart iframe can be one), relay
    // anyway: the top frame re-checks the page before acting, so a stray
    // relay from some other frame is a no-op there.
    const shouldRelay = () => {
      try {
        return (
          window.top.location.hostname === "kite.zerodha.com" &&
          CHART_PATH.test(window.top.location.pathname)
        );
      } catch (_) {
        return true;
      }
    };
    window.addEventListener(
      "keydown",
      (e) => {
        if (!enabled || foreignOwner()) return;
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        if (isTyping(e.target) || isTyping(document.activeElement)) return;
        if (!shouldRelay()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        window.top.postMessage({ [MSG_KEY]: e.key === "ArrowDown" ? 1 : -1 }, "*");
      },
      true
    );
    chrome.storage?.local.get({ chartScroll: true }).then((s) => { enabled = s.chartScroll !== false; });
    chrome.storage?.onChanged.addListener((c) => {
      if ("chartScroll" in c) enabled = c.chartScroll.newValue !== false;
    });
    return;
  }

  // ---- top frame: the controller -------------------------------------------
  if (location.hostname !== "kite.zerodha.com") return;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const csleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // The marker is a pseudo-element OVERLAY, not a background on the row:
  // Kite paints opaque backgrounds on the row for hover / its own charted-row
  // highlight, and any background we set (even !important) ends up visually
  // buried under child-element repaints. An ::after layer with pointer-events
  // none floats above whatever Kite paints, so the gold tint + bar are
  // constant through hover, Kite's own highlight, everything.
  const style = document.createElement("style");
  style.textContent =
    `${ROW}.rvt-cs-sel{position:relative;box-shadow:inset 3px 0 0 #f0b429 !important}` +
    `${ROW}.rvt-cs-sel::after{content:"";position:absolute;inset:0;pointer-events:none;` +
    `z-index:9;background:rgba(240,180,41,.10);border-left:3px solid #f0b429}` +
    // On LIGHT Kite the same gold reads washed-out on white, so the marker
    // deepens to amber there (same :has() light gate as kite-theme.js;
    // Kite marks only dark with data-theme).
    `html:not([data-theme=dark]):not(:has([data-theme=dark])) ${ROW}.rvt-cs-sel{box-shadow:inset 3px 0 0 #c98a00 !important}` +
    `html:not([data-theme=dark]):not(:has([data-theme=dark])) ${ROW}.rvt-cs-sel::after{background:rgba(201,138,0,.12);border-left-color:#c98a00}` +
    // Belt for the synthetic-hover leftovers: on the charted row, Kite's
    // hover-button cluster only shows while the row is REALLY hovered. If
    // these class names miss, the rule is a no-op (the event-based unhover
    // above is the actual fix).
    `${ROW}.rvt-cs-sel:not(:hover) .buttons,${ROW}.rvt-cs-sel:not(:hover) .actions{display:none !important}`;
  (document.head || document.documentElement).appendChild(style);

  function parseChartUrl() {
    const m = location.pathname.match(CHART_PATH);
    return m ? { engine: m[1], exch: m[2], sym: decodeURIComponent(m[3]), token: m[4] } : null;
  }

  // Remember which chart engine his account uses (from the last chart page
  // seen), so a URL we build ourselves opens the SAME engine. Only the
  // fallback paths need this; the chart-button path is engine-aware anyway.
  let lastEngine = "tvc";
  function noteEngine() {
    const cur = parseChartUrl();
    if (cur && cur.engine !== lastEngine) {
      lastEngine = cur.engine;
      chrome.storage?.local.set({ chartEngine: lastEngine }).catch(() => {});
    }
  }
  chrome.storage?.local.get({ chartEngine: "tvc" }).then((s) => {
    lastEngine = s.chartEngine || "tvc";
    noteEngine();
  });

  const symbolOf = (row) => (row.querySelector(".symbol .name")?.textContent || "").trim();
  // Rows carry data-id like "NSE:INE...". The prefix is the exchange.
  const exchOf = (row) => ((row.getAttribute("data-id") || "").split(":")[0] || "").toUpperCase();

  // Visible watchlist rows, top-to-bottom as rendered (robust to live-sort).
  function rowsByVisualOrder() {
    return [...document.querySelectorAll(ROW)]
      .filter((r) => r.offsetHeight || r.offsetWidth || r.getClientRects().length)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  }

  let selectedRow = null;
  function highlight(row) {
    if (selectedRow && selectedRow !== row) selectedRow.classList.remove("rvt-cs-sel");
    selectedRow = row;
    if (row) {
      row.classList.add("rvt-cs-sel");
      row.scrollIntoView({ block: "nearest" });
    }
  }

  // Kite's per-row chart hover-button (tooltip "Chart (C)").
  const CHART_BTN =
    '[data-balloon*="hart"], [data-balloon*="HART"], [title*="hart"], .icon-trending-up, button.chart, a.chart';
  function findChartBtn(row) {
    return row.querySelector(CHART_BTN);
  }
  function hoverRow(row) {
    for (const type of ["pointerover", "mouseover", "mouseenter"]) {
      row.dispatchEvent(new MouseEvent(type, { bubbles: type !== "mouseenter", cancelable: true }));
    }
  }
  // Undo the synthetic hover once the chart button has served: Kite's hover
  // buttons otherwise sit over the price/% until the real mouse moves.
  // Simulates a COMPLETE mouse exit the way the browser would fire it — out
  // events with a relatedTarget outside the row, leave events up the whole
  // ancestor chain (a delegated listener on the list container never hears a
  // non-bubbling leave dispatched on the row alone), then an arrival on a
  // harmless element. If the physical cursor genuinely IS on the row, Kite's
  // hover is left alone.
  function unhoverRow(row) {
    try { if (row.matches(":hover")) return; } catch (_) {}
    const away = document.body;
    const opts = { bubbles: true, cancelable: true, relatedTarget: away };
    row.dispatchEvent(new PointerEvent("pointerout", opts));
    row.dispatchEvent(new MouseEvent("mouseout", opts));
    for (let n = row; n && n !== document.body; n = n.parentElement) {
      n.dispatchEvent(new PointerEvent("pointerleave", { relatedTarget: away }));
      n.dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: away }));
    }
    away.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: row }));
    away.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: row }));
  }

  // Did the app actually move to `sym`? URL is the truth; the tab title
  // ("AEGISVOPAK (NSE) - Kite Chart") is the backup signal.
  async function switchedTo(sym, ms) {
    const until = Date.now() + ms;
    for (;;) {
      const cur = parseChartUrl();
      if ((cur && cur.sym === sym) || document.title.includes(sym)) return true;
      if (Date.now() >= until) return false;
      await csleep(50);
    }
  }

  async function openChart(row) {
    const sym = symbolOf(row);
    if (!sym) return;
    const exch = exchOf(row) || parseChartUrl()?.exch || "NSE";
    noteEngine();

    // 1) Kite's own chart button on the row (buttons may render on hover).
    let btn = findChartBtn(row);
    if (!btn) {
      hoverRow(row);
      await csleep(50);
      btn = findChartBtn(row);
    }
    let opened = false;
    if (btn) {
      if (btn.tagName === "A" && btn.getAttribute("href")) {
        location.assign(btn.href); // same tab, even if the anchor targets a new one
        return;
      }
      if (!strategyDead("btn")) {
        btn.click();
        opened = await switchedTo(sym, 800);
        if (!opened) markDead("btn"); // this engine ignores the click — stop paying the wait
      }
    }
    // Kite re-renders the watchlist while the chart switches (its own
    // charted-row marker), which can REPLACE the row node — an unhover fired
    // on the detached node never reaches Kite. Unhover the LIVE node for this
    // symbol, and once more after the re-render settles.
    const unhover = () => {
      const r = row.isConnected ? row : rowsByVisualOrder().find((x) => symbolOf(x) === sym);
      if (r) unhoverRow(r);
    };
    unhover();
    setTimeout(unhover, 350);
    if (opened) return;

    // 2) + 3) need the instrument token.
    const token = await tokenFor(sym, exch);
    if (!token) return; // can't build the URL; debug command will say why
    await gotoChartUrl(sym, exch, token);
  }

  async function tokenFor(sym, exch) {
    try {
      const res = await chrome.runtime.sendMessage({ cmd: "kiteToken", payload: { exchange: exch, symbol: sym } });
      if (res?.ok) return res.data.token;
    } catch (_) {}
    return null;
  }

  // Per-engine memory of which switch strategies this Kite build actually
  // honors, so a dead one isn't retried (with its verify wait) on every
  // step. sessionStorage, so it survives the hard navigations it causes.
  const strategyDead = (k) => {
    try { return sessionStorage.getItem(`rvtCs:${k}:${lastEngine}`) === "1"; } catch (_) { return false; }
  };
  const markDead = (k) => {
    try { sessionStorage.setItem(`rvtCs:${k}:${lastEngine}`, "1"); } catch (_) {}
  };

  async function titleShows(sym, ms) {
    const until = Date.now() + ms;
    for (;;) {
      if (document.title.includes(sym)) return true;
      if (Date.now() >= until) return false;
      await csleep(50);
    }
  }

  // Open a chart URL we build ourselves: soft route change (pushState +
  // popstate, so Kite's SPA router swaps without a reload), then hard
  // navigation as the catch-all.
  async function gotoChartUrl(sym, exch, token) {
    const url = `/markets/chart/web/${lastEngine}/${exch}/${encodeURIComponent(sym)}/${token}`;
    if (!strategyDead("soft")) {
      try {
        history.pushState(history.state, "", url);
        window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
        // We just wrote the URL ourselves, so the URL proves nothing here —
        // only the tab TITLE updating shows the app really swapped the chart.
        // (The old URL check verified our own pushState: ChartIQ ignored the
        // popstate, the check "passed", and the chart sat frozen while the
        // highlight walked on.)
        if (await titleShows(sym, 800)) return;
        markDead("soft");
      } catch (_) {}
    }
    location.assign(url); // hard navigation always lands right
  }

  // Open requests coalesce: fire IMMEDIATELY when idle (no debounce lag);
  // while one is in flight, only the LATEST requested row is kept, so
  // holding the arrow key skips intermediate charts instead of queuing them.
  let opening = false;
  let pendingRow = null;
  async function requestOpen(row) {
    pendingRow = row;
    if (opening) return;
    opening = true;
    try {
      while (pendingRow) {
        const r = pendingRow;
        pendingRow = null;
        await openChart(r);
      }
    } finally {
      opening = false;
    }
  }

  function step(dir) {
    if (!topIsChartPage()) return;
    const rows = rowsByVisualOrder();
    if (!rows.length) return;
    const curSym =
      (selectedRow && rows.indexOf(selectedRow) >= 0 && symbolOf(selectedRow)) || parseChartUrl()?.sym;
    let idx = rows.findIndex((r) => symbolOf(r) === curSym);
    // Wraps around: down from the last row loops to the first, up from the
    // first loops to the last.
    const next = idx < 0 ? (dir > 0 ? 0 : rows.length - 1) : (idx + dir + rows.length) % rows.length;
    if (next === idx) return; // single-row list
    highlight(rows[next]);
    requestOpen(rows[next]);
  }

  // Keep the gold marker glued to whatever stock the chart shows — including
  // on first load (before any arrow press) and when the chart was switched by
  // something other than us (Kite's own chart button, a search). Skipped while
  // a step is in flight so it never yanks the marker off a just-stepped row.
  function syncHighlight() {
    if (!enabled || opening || pendingRow || foreignOwner()) return;
    if (!topIsChartPage()) {
      if (selectedRow) highlight(null); // stale marker after leaving the chart page
      return;
    }
    const cur = parseChartUrl();
    if (!cur) return;
    if (selectedRow && selectedRow.isConnected && symbolOf(selectedRow) === cur.sym) {
      // Kite (Vue) rewrites the row's class attribute when its own hover /
      // charted-row highlight state changes, wiping our marker class — put it
      // back, so the gold bar survives hovering and Kite's own highlight.
      if (!selectedRow.classList.contains("rvt-cs-sel")) selectedRow.classList.add("rvt-cs-sel");
      return;
    }
    const row = rowsByVisualOrder().find((r) => symbolOf(r) === cur.sym);
    if (row) highlight(row);
  }
  setInterval(syncHighlight, 400);

  function onKey(e) {
    if (!enabled || foreignOwner()) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (window.__rvtBoardLock) return; // the Top RVOL board's scroller owns the arrows
    if (!topIsChartPage()) return;
    if (isTyping(e.target) || isTyping(document.activeElement)) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // Kite's native arrow-highlight stays out of it
    step(e.key === "ArrowDown" ? 1 : -1);
  }
  window.addEventListener("keydown", onKey, true);

  // Click ANYWHERE on a stock's row -> open its chart, on ANY Kite page
  // (v0.11.6, his ask: the name alone was too small a target — empty space
  // and the VWAP badge should work too). Only genuinely interactive bits
  // keep their own meaning: the hover B/S/depth/chart/delete buttons (all
  // data-balloon-tooltipped), links, inputs, the six-dot drag handle, and
  // anything inside an expanded market-depth block. The click is consumed
  // (no Kite default handling) so "click a row" means exactly one thing —
  // note this also means row-click no longer toggles Kite's inline depth;
  // the hover depth button still does.
  function onClick(e) {
    if (!enabled || foreignOwner()) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const row = e.target.closest(ROW);
    if (!row || !symbolOf(row)) return;
    if (
      e.target.closest(
        "button, a, input, .icon, [data-balloon], .buttons, .actions, .nudge, " +
        ".market-depth, .depth, table"
      )
    ) return;
    // Six-dot drag handle, matched by class fragment. The row ITSELF is
    // "draggable-item" (contains "drag"), so this check must ignore a match
    // on the row — v0.11.6 didn't, which ate EVERY click on the row. The
    // name text is never the handle, so it bypasses this check entirely:
    // whatever the handle's real markup is, name-click always works.
    if (!e.target.closest(".symbol .name")) {
      const drag = e.target.closest('[class*="drag" i], [class*="handle" i]');
      if (drag && drag !== row) return;
    }
    e.preventDefault();
    e.stopPropagation();
    highlight(row);
    requestOpen(row);
  }
  document.addEventListener("click", onClick, true);

  // Arrow presses relayed from the chart iframe.
  window.addEventListener("message", (e) => {
    if (!enabled || foreignOwner()) return;
    if (window.__rvtBoardLock) return; // board scroller owns the arrows
    const dir = e.data && e.data[MSG_KEY];
    if (dir !== 1 && dir !== -1) return;
    if (!/\.zerodha\.com$|^https:\/\/kite\.zerodha\.com$/.test(e.origin) && !e.origin.endsWith(".zerodha.com")) return;
    step(dir);
  });

  chrome.storage?.local.get({ chartScroll: true }).then((s) => { enabled = s.chartScroll !== false; });
  chrome.storage?.onChanged.addListener((c) => {
    if ("chartScroll" in c) {
      enabled = c.chartScroll.newValue !== false;
      if (!enabled) highlight(null);
    }
  });

  // Chart switch requested from elsewhere (the Top RVOL board via the SW's
  // setKiteSymbol). Symbols may arrive in TV form (& and - become _), so try
  // the plausible tradingsymbol spellings: watchlist row first (fast button
  // path), else resolve a token and navigate.
  chrome.runtime?.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.cmd !== "openKiteSymbol") return;
    (async () => {
      const raw = ((msg.payload && msg.payload.symbol) || "").trim().toUpperCase();
      if (!raw) { sendResponse({ ok: false, error: "no symbol" }); return; }
      const cands = [...new Set([raw, raw.replace(/_/g, "-"), raw.replace(/_/g, "&")])];
      const rows = rowsByVisualOrder();
      for (const c of cands) {
        const row = rows.find((r) => symbolOf(r) === c);
        if (row) { highlight(row); requestOpen(row); sendResponse({ ok: true, via: "row" }); return; }
      }
      for (const c of cands) {
        const token = await tokenFor(c, "NSE");
        if (token) { gotoChartUrl(c, "NSE", token); sendResponse({ ok: true, via: "token" }); return; }
      }
      sendResponse({ ok: false, error: `no NSE token for ${raw}` });
    })();
    return true;
  });

  // Popup debug: everything needed to tune selectors without devtools,
  // including the tab's frame list (is the chart iframe reachable?).
  chrome.runtime?.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.cmd !== "debugChartScroll") return;
    (async () => {
      const cur = parseChartUrl();
      const rows = rowsByVisualOrder();
      const idx = cur ? rows.findIndex((r) => symbolOf(r) === cur.sym) : -1;
      const curRow = idx >= 0 ? rows[idx] : rows[0] || null;
      let btn = curRow && findChartBtn(curRow);
      if (curRow && !btn) { hoverRow(curRow); btn = findChartBtn(curRow); }
      sendResponse({
        ok: true,
        data: {
          enabled,
          onChartPage: topIsChartPage(),
          path: location.pathname,
          chartEngine: cur ? cur.engine : lastEngine,
          currentSymbol: cur ? cur.sym : null,
          rowCount: rows.length,
          matchedRowIndex: idx,
          chartButtonFound: !!btn,
          chartButtonHTML: btn ? btn.outerHTML.slice(0, 400) : null,
          standingDownForKiteTools: foreignOwner(),
          sampleRowHTML: curRow ? curRow.outerHTML.slice(0, 2500) : null,
        },
      });
    })();
    return true;
  });
})();
