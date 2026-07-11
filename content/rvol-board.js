// RVOL Tools, Top RVOL leaderboard (any site, with a floating pop-out).
//
// Ranks a symbol list by RELATIVE VOLUME (today's volume vs its 20-day average)
// and floats the heaviest names to the top. Styled like the "Strong Start" TV
// table: a heatmap where the heaviest-volume rows light up green (up) / red
// (down) / amber (flat), opacity scaling with RVOL rank. RVOL shown as a %
// (TV convention: 23.4x = 2340%).
//
// SCREEN-AGNOSTIC: the content script runs on every site, but the panel only
// shows on sites you've switched on in the popup (a per-hostname list). So you
// can put it on your broker, a second-monitor tab, or pop it out to float over
// anything, TV isn't special. Default: off everywhere.
//
//   • Docked panel: draggable / resizable / collapsible, per-site on/off.
//   • "Pop out" → a Document Picture-in-Picture window: one real floating
//     window, always-on-top, drag/resize across monitors and over ANY app.
//   • Click a row to switch the chart in your open TradingView tab; it then
//     LOCKS as a scroller, ↑/↓ step the list (Esc unlocks). Switching does NOT
//     focus the TV tab, so arrows keep working from wherever the panel lives.
//
// Self-contained IIFE + Shadow DOM (content scripts share one isolated world).

(() => {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const HOST = location.hostname;

  const DEFAULTS = {
    rvolBoardSites: [],       // hostnames where the panel is shown
    rvolBoardTopN: 30,
    rvolBoardSymbols: [],     // bare NSE tickers
    rvolBoardUrl: "",         // TV watchlist link to track (blank = static list)
    rvolBoardTheme: "auto",   // auto | dark | light
    rvolBoardCollapsed: false,
  };
  const POS_KEY = "rvolBoardPos";
  const SIZE_KEY = "rvolBoardSize";
  const POLL_MS = 5000;
  const URL_REFRESH_MS = 5 * 60 * 1000;   // re-read a tracked watchlist link
  const DEF_W = 276;

  // Strong-Start thresholds (match the StrongStart_RVOL.pine defaults).
  const RVOL_FLAG = 8;    // RVOL% ≥ this → green RVOL text
  const CHG_FLAG = 1.5;   // move ≥ this → green row; ≤ -this → red; else amber
  const GATE_PCT = 50;    // only the heaviest top X% of shown rows get a heatmap bg
  const HEAT = { up: "76,175,80", down: "244,67,54", flat: "255,152,0" };

  let enabled = false, collapsed = false, topN = 30, symbols = [], boardUrl = "", themePref = "auto";
  let timer = null, urlTimer = null, dragged = false, fetching = false;
  let lastRanked = [], lastFullRanked = [], selectedSym = null;

  let host, shadow;                                 // docked panel (shadow DOM)
  let inPage = null, pip = null, active = null;      // render targets {wrap, body, status, doc}
  let pipWin = null;

  // ---- theme ---------------------------------------------------------------
  // Panel brings its own card background, so it's readable on any page; the
  // theme just swaps that card + text + heatmap palette to suit a light or dark
  // page. "auto" sniffs the page background luminance.
  function pageIsLight() {
    try {
      let el = document.body || document.documentElement;
      let bg = "";
      for (let i = 0; el && i < 4; i++, el = el.parentElement) {
        const c = getComputedStyle(el).backgroundColor;
        if (c && !/rgba?\(0, ?0, ?0, ?0\)|transparent/.test(c)) { bg = c; break; }
      }
      const m = bg && bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const p = m[1].split(",").map((x) => parseFloat(x));
        const a = p.length > 3 ? p[3] : 1;
        if (a === 0) return matchMedia("(prefers-color-scheme: light)").matches;
        const lum = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
        return lum > 140;
      }
    } catch (_) {}
    return matchMedia("(prefers-color-scheme: light)").matches;
  }
  function resolvedTheme() {
    return themePref === "light" ? "light" : themePref === "dark" ? "dark" : pageIsLight() ? "light" : "dark";
  }
  function applyTheme() {
    const t = resolvedTheme();
    [inPage, pip].forEach((x) => {
      if (x && x.wrap) { x.wrap.classList.toggle("light", t === "light"); x.wrap.classList.toggle("dark", t === "dark"); }
    });
  }

  // ---- shared markup -------------------------------------------------------
  const CSS = `
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    .wrap {
      --bg: rgba(16,19,26,.94); --border: rgba(255,255,255,.10); --accent: #f0b429;
      --text: #ecebe6; --muted: #79808b; --hdrbg: rgba(255,255,255,.05); --hdrtx: #aeb4bf;
      --up: #26d07c; --down: #ff5d6c; --flat: #f0b429; --low: #aab0ba;
      --rowline: rgba(255,255,255,.05); --hover: rgba(255,255,255,.06); --selbg: rgba(240,180,41,.16);
      --scroll: rgba(255,255,255,.14);
      width: ${DEF_W}px; position: relative; user-select: none;
      background: var(--bg); backdrop-filter: blur(8px);
      border: 1px solid var(--border); border-left: 3px solid var(--accent);
      border-radius: 11px; box-shadow: 0 8px 26px rgba(0,0,0,.45);
      color: var(--text); overflow: hidden;
    }
    .wrap.light {
      --bg: rgba(255,255,255,.97); --border: rgba(0,0,0,.12); --accent: #d99400;
      --text: #1a1d23; --muted: #6b727d; --hdrbg: #eef0f4; --hdrtx: #3a3f49;
      --up: #0b8043; --down: #cc2222; --flat: #c77800; --low: #5b616b;
      --rowline: rgba(0,0,0,.07); --hover: rgba(0,0,0,.045); --selbg: rgba(217,148,0,.16);
      --scroll: rgba(0,0,0,.18);
      box-shadow: 0 8px 26px rgba(0,0,0,.22);
    }
    .pip .wrap { width: 100%; height: 100vh; border-radius: 0; border: none; border-left: 3px solid var(--accent);
      display: flex; flex-direction: column; box-shadow: none; }
    .head { display: flex; align-items: center; gap: 8px; padding: 8px 10px 7px; cursor: grab; flex: 0 0 auto; }
    .pip .head { cursor: default; }
    .head:active { cursor: grabbing; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: 0 0 auto; }
    .live .dot { animation: pulse 2.4s infinite; }
    @keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(240,180,41,.5)} 70%{box-shadow:0 0 0 6px transparent} 100%{box-shadow:0 0 0 0 transparent} }
    .title { font-size: 11.5px; font-weight: 800; letter-spacing: .07em; color: var(--accent); white-space: nowrap; }
    .lock { font-size: 11px; color: var(--accent); display: none; }
    .locked .lock { display: inline; }
    .status { margin-left: auto; font-size: 10px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .popout, .copybtn, .closeb { background: none; border: none; color: var(--muted); cursor: pointer; padding: 0 2px; font-size: 12px; line-height: 1; flex: 0 0 auto; }
    .copybtn { font-size: 9px; font-weight: 700; letter-spacing: .03em; }
    .popout:hover, .copybtn:hover { color: var(--accent); }
    .closeb { font-size: 13px; margin-left: 2px; }
    .closeb:hover { color: var(--down); }
    .pip .popout, .pip .grip, .pip .closeb { display: none; }

    .cols { display: flex; align-items: center; gap: 8px; }
    .c-sym { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .c-rv  { flex: 0 0 auto; width: 60px; text-align: right; font-variant-numeric: tabular-nums; }
    .c-chg { flex: 0 0 auto; width: 58px; text-align: right; font-variant-numeric: tabular-nums; }

    .thead { padding: 4px 10px 5px; background: var(--hdrbg); border-top: 1px solid var(--border);
      font-size: 9.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--hdrtx); flex: 0 0 auto; }
    .collapsed .thead { display: none; }

    .body { max-height: var(--bodyH, 60vh); overflow-y: auto; transition: max-height .2s ease; }
    .pip .body { max-height: none; flex: 1 1 auto; transition: none; }
    .collapsed .body { max-height: 0; }
    .body::-webkit-scrollbar { width: 7px; }
    .body::-webkit-scrollbar-thumb { background: var(--scroll); border-radius: 4px; }

    .row { padding: 5px 10px; cursor: pointer; border-top: 1px solid var(--rowline); }
    .row:hover { background: var(--hover); }
    .row.sel { box-shadow: inset 0 0 0 2px var(--accent); background: var(--selbg); }
    .row.sel .c-sym.name { color: var(--accent); }
    .c-sym.name { font-size: 12px; font-weight: 600; color: var(--text); }
    .c-rv.val { font-size: 12px; font-weight: 700; }
    .c-chg.mv { font-size: 11px; }
    .up { color: var(--up); } .down { color: var(--down); } .flat { color: var(--flat); }
    .low { color: var(--low); } .na { color: var(--muted); }

    .empty { padding: 12px 12px 14px; font-size: 11.5px; line-height: 1.45; color: var(--muted); }
    .empty b { color: var(--text); }
    .grip { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 0 50%, var(--scroll) 50% 60%, transparent 60% 72%, var(--scroll) 72% 82%, transparent 82%); }
  `;
  const STRUCT = `
    <div class="wrap dark" id="wrap">
      <div class="head" id="head">
        <span class="dot"></span>
        <span class="title">TOP RVOL</span>
        <span class="lock" id="lock">⌨</span>
        <span class="status" id="status"></span>
        <button class="copybtn" id="copy" title="Copy the top 50 by RVOL for TradingView">COPY 50</button>
        <button class="popout" id="popout" title="Pop out as a floating window">⧉</button>
        <button class="closeb" id="closeb" title="Close (turn off for this site)">✕</button>
      </div>
      <div class="thead cols">
        <span class="c-sym">Symbol</span>
        <span class="c-rv">RVOL</span>
        <span class="c-chg">Chg%</span>
      </div>
      <div class="body" id="body"></div>
      <div class="grip" id="grip"></div>
    </div>`;

  // ---- docked panel (shadow DOM) ------------------------------------------
  function build() {
    host = document.createElement("div");
    host.id = "rvt-board-host";
    host.style.cssText = "all:initial; position:fixed; z-index:2147483600; top:140px; left:14px;";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${CSS}</style>${STRUCT}`;
    document.documentElement.appendChild(host);

    inPage = {
      wrap: shadow.getElementById("wrap"),
      body: shadow.getElementById("body"),
      status: shadow.getElementById("status"),
      doc: document,
    };
    active = inPage;

    makeDraggable(shadow.getElementById("head"), () => { if (!dragged) toggleCollapse(); });
    makeResizable(shadow.getElementById("grip"));
    const po = shadow.getElementById("popout");
    po.addEventListener("pointerdown", (e) => e.stopPropagation());
    po.addEventListener("click", (e) => { e.stopPropagation(); openPip(); });
    const cp = shadow.getElementById("copy");
    cp.addEventListener("pointerdown", (e) => e.stopPropagation());
    cp.addEventListener("click", (e) => { e.stopPropagation(); copyTop(50); });
    const cl = shadow.getElementById("closeb");
    cl.addEventListener("pointerdown", (e) => e.stopPropagation());
    cl.addEventListener("click", (e) => { e.stopPropagation(); closeHere(); });
    restorePosSize();
    inPage.wrap.classList.toggle("collapsed", collapsed);
    applyTheme();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDocPointerDown, true);
  }

  function toggleCollapse() {
    collapsed = !collapsed;
    inPage.wrap.classList.toggle("collapsed", collapsed);
    chrome.storage?.local.set({ rvolBoardCollapsed: collapsed });
  }

  // The X button: hide the board on THIS site and untick it in the popup, by
  // dropping this hostname from the enabled-sites list. The storage change then
  // flips `enabled` off and stops the panel (see the onChanged listener).
  async function closeHere() {
    const s = await chrome.storage?.local.get({ rvolBoardSites: [] });
    const cur = new Set(Array.isArray(s.rvolBoardSites) ? s.rvolBoardSites : []);
    cur.delete(HOST);
    chrome.storage?.local.set({ rvolBoardSites: [...cur] });
  }

  // Docked panel shows when this site is enabled (and not popped out).
  function updateDockVisibility() {
    if (!host) return;
    const show = enabled && !pip;
    host.style.display = show ? "" : "none";
    if (show) tick();
  }

  // ---- pop-out (Document Picture-in-Picture) ------------------------------
  async function openPip() {
    if (!("documentPictureInPicture" in window)) {
      if (active) active.status.textContent = "no floating support";
      return;
    }
    if (pipWin) { try { pipWin.focus(); } catch (_) {} return; }
    const w = host ? host.offsetWidth || DEF_W : DEF_W;
    try {
      pipWin = await documentPictureInPicture.requestWindow({ width: w, height: 460 });
    } catch (_) { return; }
    const d = pipWin.document;
    d.body.style.margin = "0";
    d.body.className = "pip";
    const st = d.createElement("style"); st.textContent = CSS; d.head.appendChild(st);
    d.body.innerHTML = STRUCT;

    pip = { wrap: d.getElementById("wrap"), body: d.getElementById("body"), status: d.getElementById("status"), doc: d };
    active = pip;
    applyTheme();
    if (host) host.style.display = "none"; // hide this tab's docked copy while popped

    d.addEventListener("keydown", onKey, true);
    d.getElementById("copy").addEventListener("click", () => copyTop(50));
    pipWin.addEventListener("pagehide", () => {
      pipWin = null; pip = null;
      active = inPage;
      updateDockVisibility();
    });
    tick();
  }

  // ---- render --------------------------------------------------------------
  const fmtRvol = (v) => `${Math.round(v * 100).toLocaleString("en-IN")}%`;
  const fmtChg = (c) => {
    if (c == null || Number.isNaN(c)) return "–";
    const s = Math.abs(c).toFixed(1).replace(/^0(?=\.)/, ""); // ".9%" like the Pine table
    return (c < 0 ? "-" : "") + s + "%";
  };
  const rvClass = (rvPct) => (rvPct == null ? "na" : rvPct >= RVOL_FLAG ? "up" : rvPct >= RVOL_FLAG * 0.6 ? "flat" : "low");
  const chgClass = (c) => (c == null ? "na" : c >= 0 ? "up" : "down");

  function renderEmpty(msg) {
    if (!active) return;
    active.body.innerHTML = `<div class="empty">${msg}</div>`;
    active.status.textContent = "";
    active.wrap.classList.remove("live");
  }

  // Chart routing: a Kite chart tab first (chart-scroll.js does the switch,
  // no focus steal), else the TradingView tab. Neither steals focus, so the
  // board can drive a chart on the other monitor.
  async function switchTo(sym) {
    try {
      const r = await chrome.runtime.sendMessage({ cmd: "setKiteSymbol", payload: { symbol: sym } });
      if (r?.ok && r.data && r.data.switched) return;
    } catch (_) {}
    try { chrome.runtime.sendMessage({ cmd: "setTVSymbol", payload: { symbol: sym } }); } catch (_) {}
  }

  // Copy the top-N RVOL names as a TradingView import string (NSE:SYM,…).
  function copyTop(n = 50) {
    if (!lastFullRanked.length) return;
    const picked = lastFullRanked.slice(0, n);
    const text = picked.map((r) => `NSE:${r.s}`).join(",");
    const done = (msg) => { if (active) active.status.textContent = msg; };
    const ok = `✓ copied ${picked.length}`;
    const win = (active && active.doc && active.doc.defaultView) || window;
    try {
      win.navigator.clipboard.writeText(text).then(() => done(ok)).catch(() => fallbackCopy(text, done, ok));
    } catch (_) { fallbackCopy(text, done, ok); }
  }
  function fallbackCopy(text, done, ok) {
    try {
      const doc = (active && active.doc) || document;
      const ta = doc.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      doc.body.appendChild(ta); ta.focus(); ta.select();
      doc.execCommand("copy"); ta.remove();
      done(ok);
    } catch (_) { done("copy failed"); }
  }

  function applySelHighlight() {
    if (!active) return;
    // Shared isolated-world flag: while the board's arrow scroller is locked,
    // chart-scroll.js stands down so both don't fight over up/down arrows on
    // the Kite chart page (chart-scroll's listener runs first and checks this).
    window.__rvtBoardLock = !!selectedSym;
    active.wrap.classList.toggle("locked", !!selectedSym);
    active.body.querySelectorAll(".row").forEach((el) => el.classList.toggle("sel", el.dataset.sym === selectedSym));
  }

  function render(rvol, change) {
    if (!active) return;
    const all = symbols
      .map((s) => ({ s, rv: rvol[`NSE:${s}`], chg: change[`NSE:${s}`] }))
      .filter((r) => typeof r.rv === "number")
      .sort((a, b) => b.rv - a.rv);
    lastFullRanked = all;            // full ranking, for "copy top N"
    const ranked = all.slice(0, topN);
    lastRanked = ranked;

    if (!ranked.length) { renderEmpty("Waiting for live volume… (market closed shows last session)."); return; }

    // VOLUME LEADS: only the heaviest top GATE_PCT% of the shown rows get a
    // colored (heatmap) background; opacity scales with RVOL rank so the biggest
    // names pop hardest. Lower rows stay plain, exactly like Strong Start.
    const hiCount = Math.max(1, Math.round(ranked.length * GATE_PCT / 100));

    const b = active.body;
    b.innerHTML = "";
    ranked.forEach((r, i) => {
      const rvPct = r.rv * 100;
      const chg = typeof r.chg === "number" ? r.chg : null;
      let rowBg = "";
      if (i < hiCount && chg != null) {
        const tp = 45 + 35 * i / Math.max(1, hiCount - 1);   // 45 (top) → 80
        const alpha = ((100 - tp) / 100).toFixed(2);          // .55 → .20
        const base = chg >= CHG_FLAG ? HEAT.up : chg <= -CHG_FLAG ? HEAT.down : HEAT.flat;
        rowBg = `background: rgba(${base}, ${alpha});`;
      }
      const row = active.doc.createElement("div");
      row.className = "row cols";
      row.dataset.sym = r.s;
      if (rowBg) row.style.cssText = rowBg;
      row.innerHTML =
        `<span class="c-sym name">${r.s}</span>` +
        `<span class="c-rv val ${rvClass(rvPct)}">${fmtRvol(r.rv)}</span>` +
        `<span class="c-chg mv ${chgClass(chg)}">${fmtChg(chg)}</span>`;
      row.addEventListener("click", () => { selectedSym = r.s; switchTo(r.s); applySelHighlight(); });
      b.appendChild(row);
    });
    applySelHighlight();
    active.wrap.classList.add("live");
    const t = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
    active.status.textContent = `${ranked.length}/${symbols.length} · ${t}`;
  }

  // ---- keyboard scroller ---------------------------------------------------
  function onKey(e) {
    if (!enabled || !selectedSym) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Escape") return;
    const a = (e.target && e.target.ownerDocument ? e.target.ownerDocument.activeElement : document.activeElement);
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
    if (e.key === "Escape") { selectedSym = null; applySelHighlight(); return; }
    if (!lastRanked.length) return;
    e.preventDefault(); e.stopPropagation();
    let idx = lastRanked.findIndex((r) => r.s === selectedSym);
    if (idx < 0) idx = 0;
    idx = clamp(idx + (e.key === "ArrowDown" ? 1 : -1), 0, lastRanked.length - 1);
    selectedSym = lastRanked[idx].s;
    switchTo(selectedSym);
    applySelHighlight();
    const sel = active && active.body.querySelector(".row.sel");
    if (sel) sel.scrollIntoView({ block: "nearest" });
  }

  // Clicking anywhere OUTSIDE the docked panel (e.g. on the chart) releases the
  // arrow-key scroller, so ↑/↓ go back to controlling the page instead of the
  // board. Click a row again to resume driving from the board (Esc also exits).
  // Clicks inside the panel are retargeted to the shadow host, so host.contains
  // catches them and we DON'T release on a row click.
  function onDocPointerDown(e) {
    if (!selectedSym) return;
    if (host && host.contains(e.target)) return;
    selectedSym = null;
    applySelHighlight();
  }

  // ---- data loop -----------------------------------------------------------
  function shouldPoll() {
    if (pip) return true;                                  // this tab hosts the floating window
    return enabled && host && host.style.display !== "none";
  }
  async function tick() {
    if (!enabled || fetching || !shouldPoll()) return;
    if (!symbols.length) {
      renderEmpty('No list yet. Open the <b>RVOL Tools</b> popup and paste your symbols (or a TradingView watchlist link), then Load.');
      return;
    }
    fetching = true;
    try {
      const resp = await chrome.runtime.sendMessage({
        cmd: "boardQuotes",
        payload: { symbols: symbols.map((s) => `NSE:${s}`) },
      });
      if (resp?.ok) render(resp.data.rvol || {}, resp.data.change || {});
    } catch (_) { /* worker asleep / transient, next tick retries */ }
    finally { fetching = false; }
  }

  // If a TV watchlist link is set, re-read it so edits on TV flow through
  // without re-pasting. Only writes when the list actually changed.
  async function refreshFromUrl() {
    if (!boardUrl) return;
    try {
      const resp = await chrome.runtime.sendMessage({ cmd: "fetchTVWatchlist", payload: { url: boardUrl } });
      if (resp?.ok && Array.isArray(resp.data.symbols) && resp.data.symbols.length) {
        const next = resp.data.symbols;
        if (next.join(",") !== symbols.join(",")) {
          symbols = next;
          chrome.storage?.local.set({ rvolBoardSymbols: next });
        }
      }
    } catch (_) {}
  }

  function start() {
    if (!host) build();
    updateDockVisibility();
    clearInterval(timer);
    timer = setInterval(tick, POLL_MS);
    refreshFromUrl();
    clearInterval(urlTimer);
    urlTimer = setInterval(refreshFromUrl, URL_REFRESH_MS);
  }
  function stop() {
    clearInterval(timer); timer = null;
    clearInterval(urlTimer); urlTimer = null;
    if (host) host.style.display = "none";
  }

  // ---- drag (docked) -------------------------------------------------------
  function makeDraggable(handle, onClick) {
    let sx, sy, ox, oy, moved;
    const down = (e) => {
      const r = host.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; moved = false; dragged = false;
      host.style.left = r.left + "px"; host.style.top = r.top + "px"; host.style.right = "auto";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      e.preventDefault();
    };
    const move = (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      const w = host.offsetWidth, h = host.offsetHeight;
      host.style.left = clamp(ox + dx, 0, innerWidth - w) + "px";
      host.style.top = clamp(oy + dy, 0, innerHeight - h) + "px";
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) {
        dragged = true;
        chrome.storage?.local.set({ [POS_KEY]: { left: parseFloat(host.style.left), top: parseFloat(host.style.top) } });
      } else if (onClick) onClick();
    };
    handle.addEventListener("pointerdown", down);
  }

  // ---- resize (docked grip) ------------------------------------------------
  function makeResizable(grip) {
    let sx, sy, sw, sh;
    const down = (e) => {
      sx = e.clientX; sy = e.clientY;
      sw = inPage.wrap.offsetWidth;
      sh = inPage.body.offsetHeight || Math.round(innerHeight * 0.6);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      e.preventDefault(); e.stopPropagation();
    };
    const move = (e) => {
      const w = clamp(sw + (e.clientX - sx), 190, Math.round(innerWidth * 0.9));
      const h = clamp(sh + (e.clientY - sy), 60, Math.round(innerHeight * 0.92));
      inPage.wrap.style.width = w + "px";
      inPage.wrap.style.setProperty("--bodyH", h + "px");
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      chrome.storage?.local.set({ [SIZE_KEY]: { w: parseFloat(inPage.wrap.style.width) || DEF_W, h: parseFloat(inPage.wrap.style.getPropertyValue("--bodyH")) || 0 } });
    };
    grip.addEventListener("pointerdown", down);
  }

  function restorePosSize() {
    chrome.storage?.local.get({ [POS_KEY]: null, [SIZE_KEY]: null }).then((s) => {
      const sz = s[SIZE_KEY];
      if (sz && sz.w) {
        inPage.wrap.style.width = clamp(sz.w, 190, innerWidth * 0.9) + "px";
        if (sz.h) inPage.wrap.style.setProperty("--bodyH", clamp(sz.h, 60, innerHeight * 0.92) + "px");
      }
      const p = s[POS_KEY];
      if (p && typeof p.left === "number") {
        const w = host.offsetWidth || DEF_W, h = host.offsetHeight || 60;
        host.style.left = clamp(p.left, 0, innerWidth - w) + "px";
        host.style.top = clamp(p.top, 0, innerHeight - h) + "px";
        host.style.right = "auto";
      }
    });
  }

  // ---- settings (storage-driven) -------------------------------------------
  chrome.storage?.local.get(DEFAULTS).then((s) => {
    enabled = Array.isArray(s.rvolBoardSites) && s.rvolBoardSites.includes(HOST);
    topN = s.rvolBoardTopN || 30;
    symbols = Array.isArray(s.rvolBoardSymbols) ? s.rvolBoardSymbols : [];
    boardUrl = s.rvolBoardUrl || "";
    themePref = s.rvolBoardTheme || "auto";
    collapsed = s.rvolBoardCollapsed === true;
    if (enabled) start();
  });

  chrome.storage?.onChanged.addListener((c) => {
    if ("rvolBoardSites" in c) {
      const sites = Array.isArray(c.rvolBoardSites.newValue) ? c.rvolBoardSites.newValue : [];
      const nowOn = sites.includes(HOST);
      if (nowOn !== enabled) { enabled = nowOn; enabled ? start() : stop(); }
    }
    if ("rvolBoardTopN" in c) topN = c.rvolBoardTopN.newValue || 30;
    if ("rvolBoardSymbols" in c) symbols = Array.isArray(c.rvolBoardSymbols.newValue) ? c.rvolBoardSymbols.newValue : [];
    if ("rvolBoardUrl" in c) boardUrl = c.rvolBoardUrl.newValue || "";
    if ("rvolBoardTheme" in c) { themePref = c.rvolBoardTheme.newValue || "auto"; applyTheme(); }
    if (enabled && ("rvolBoardTopN" in c || "rvolBoardSymbols" in c)) tick();
    if (enabled && "rvolBoardUrl" in c) refreshFromUrl();
  });
})();
