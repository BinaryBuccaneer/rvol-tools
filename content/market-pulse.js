// RVOL Tools, Market Pulse chip (any site).
//
// A subtle, color-coded read of "is the market leaning bullish or bearish right
// now?", computed live from the Chg% of a watchlist you load. It is THRUST-aware,
// not just advance/decline: a thin-breadth day with a cluster of names up 4.5%+
// is a stock-picker's day, not a risk-off day, which is the distinction that
// matters for a long-only RS trader.
//
// Reads REAL data from the TradingView scanner (the same source the web
// dashboard uses), NOT the page's DOM, so it needs no watchlist on screen and
// works on any site. The 4.5% threshold matches the site's MBI "4.5R" thrust.
//
// THE GRAPH: two lines, advancers (green) and decliners (red), across today's
// session. When you switch the chip on it BACKFILLS the full-day path from each
// name's intraday bars (via the SW), so the line is correct whatever time you
// turn it on (9:15 or 1:45), then keeps extending live.
//
// SCREEN-AGNOSTIC: the content script runs on every site, but the chip only
// shows on sites you've switched on in the popup (a per-hostname list). Off
// everywhere by default. Auto-adapts to light or dark page backgrounds.
//
// Self-contained IIFE + Shadow DOM (content scripts share one isolated world).

(() => {
  const HOST = location.hostname;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const DEFAULTS = {
    pulseSites: [],       // hostnames where the chip is shown
    pulseSymbols: [],     // bare NSE tickers
    pulseUrl: "",         // TV watchlist link to track (blank = static list)
    pulseExpanded: false, // remember open / closed
  };
  const POS_KEY = "pulsePos";
  const POLL_MS = 5000;
  const URL_REFRESH_MS = 5 * 60 * 1000;   // re-read a tracked watchlist link
  const HIST_MS = 30000;                  // add a live graph point at most this often
  const HIST_MAX = 500;

  // Strong-move threshold matches the site's MBI "4.5" thrust convention.
  const STRONG = 4.5, MOD = 2, FLAT = 0.1;

  let enabled = false, expanded = false, symbols = [], pulseUrl = "";
  let timer = null, urlTimer = null, dragged = false, fetching = false;
  let lastMetrics = null, lastHistPush = 0, lastBackfillAt = 0;
  let history = []; // [{t (epoch s), adv, dec}], backfilled on turn-on, extended live
  let histDate = "", graphCapped = false; // IST session date the line belongs to

  // Current IST date + minutes-into-day + weekend flag, for keeping the graph on
  // the right session (NSE trades 09:15..15:30 IST, Mon..Fri).
  function istInfo() {
    const d = new Date();
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
    const g = {}; for (const p of parts) g[p.type] = p.value;
    const mins = (parseInt(g.hour, 10) % 24) * 60 + parseInt(g.minute, 10);
    return { date, mins, weekend: g.weekday === "Sat" || g.weekday === "Sun" };
  }

  let host, shadow, wrap;
  const q = (id) => shadow && shadow.getElementById(id);

  // ---- posture model (labels only; no hint text) ---------------------------
  const STATES = {
    riskon:   "RISK-ON",
    selective:"SELECTIVE",
    wait:     "WAIT & WATCH",
    weak:     "WEAK",
    riskoff:  "RISK-OFF",
    gauging:  "GAUGING",
  };
  // Per-state accent, tuned for both a dark and a light card.
  const STATE_COLOR = {
    riskon:   { dark: "#26d07c", light: "#0b8043" },
    selective:{ dark: "#b6d63a", light: "#5f7d0a" },
    wait:     { dark: "#f0b429", light: "#b07d00" },
    weak:     { dark: "#ff8a4c", light: "#c2530a" },
    riskoff:  { dark: "#ff5d6c", light: "#cc2222" },
    gauging:  { dark: "#6c7480", light: "#8a909a" },
  };

  function compute(changes) {
    const n = changes.length;
    if (n < 5) return { state: "gauging", value: 50, n, up: 0, down: 0, strongUp: 0, modUp: 0, strongDn: 0, avg: 0, breadthPct: 0, thrust: 0 };
    let up = 0, down = 0, strongUp = 0, modUp = 0, strongDn = 0, sum = 0;
    for (const c of changes) {
      sum += c;
      if (c > FLAT) up++; else if (c < -FLAT) down++;
      if (c >= STRONG) strongUp++; if (c >= MOD) modUp++; if (c <= -STRONG) strongDn++;
    }
    const avg = sum / n;
    const breadthPct = (up / n) * 100;
    const thrust = strongUp / Math.max(strongDn, 1);

    // continuous 0..100 for the gauge, thrust weighted heavily so pockets of
    // strength light it up even when breadth is mediocre.
    const avgScore = clamp((avg + 1.5) / 3 * 100, 0, 100);
    const thrustScore = clamp(50 + ((strongUp - strongDn) / n) * 250, 0, 100);
    const value = Math.round(0.40 * breadthPct + 0.25 * avgScore + 0.35 * thrustScore);

    // categorical state (ordered decision tree)
    const thrustReal = strongUp >= Math.max(2, Math.ceil(n * 0.10)) && strongUp >= 2 * strongDn;
    let state;
    if (breadthPct >= 60 && avg > 0.3 && strongUp >= strongDn) state = "riskon";
    else if (thrustReal && breadthPct >= 50) state = "riskon";
    else if (thrustReal) state = "selective";
    else if (breadthPct <= 35 && avg < -0.4) state = "riskoff";
    else if (breadthPct < 45) state = "weak";
    else state = "wait";

    return { state, value, n, up, down, strongUp, modUp, strongDn, avg, breadthPct, thrust };
  }

  // ---- theme (auto light/dark from the page background) --------------------
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
  function applyTheme() {
    if (!wrap) return;
    const light = pageIsLight();
    wrap.classList.toggle("light", light);
    wrap.classList.toggle("dark", !light);
  }

  // ---- markup --------------------------------------------------------------
  const CSS = `
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    .wrap {
      --bg: rgba(16,19,26,.94); --border: rgba(255,255,255,.10);
      --text: #ecebe6; --muted: #79808b; --key: #79808b; --foot: #5b626d; --grid: rgba(255,255,255,.06);
      --up: #26d07c; --down: #ff5d6c; --c: #6c7480;
      width: max-content; user-select: none;
      background: var(--bg); backdrop-filter: blur(8px);
      border: 1px solid var(--border); border-left: 3px solid var(--c);
      border-radius: 11px; box-shadow: 0 8px 26px rgba(0,0,0,.45);
      color: var(--text); overflow: hidden;
    }
    .wrap.light {
      --bg: rgba(255,255,255,.97); --border: rgba(0,0,0,.12);
      --text: #1a1d23; --muted: #6b727d; --key: #6b727d; --foot: #8a909a; --grid: rgba(0,0,0,.06);
      --up: #0b8043; --down: #cc2222;
      box-shadow: 0 8px 26px rgba(0,0,0,.22);
    }
    .head { display: flex; align-items: center; gap: 8px; padding: 9px 10px 8px; cursor: grab; }
    .head:active { cursor: grabbing; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c); flex: 0 0 auto; }
    .live .dot { animation: pulse 2.4s infinite; }
    @keyframes pulse { 0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--c) 55%, transparent)} 70%{box-shadow:0 0 0 6px transparent} 100%{box-shadow:0 0 0 0 transparent} }
    .state { font-size: 12px; font-weight: 800; letter-spacing: .06em; color: var(--c); white-space: nowrap; flex: 0 0 auto; }
    .glance { margin-left: auto; font-size: 11px; color: var(--muted); white-space: nowrap;
      font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .glance b { color: var(--text); font-weight: 800; }
    .glance .u { color: var(--up); } .glance .d { color: var(--down); }
    .closeb { background: none; border: none; color: var(--muted); cursor: pointer; padding: 0 2px;
      font-size: 13px; line-height: 1; flex: 0 0 auto; margin-left: 2px; }
    .closeb:hover { color: var(--down); }
    .meter { height: 3px; background: linear-gradient(90deg,#ff5d6c,#f0b429 50%,#26d07c); position: relative; opacity: .9; }
    .needle { position: absolute; top: -2px; width: 2px; height: 7px; background: var(--text); border-radius: 1px;
      box-shadow: 0 0 0 1px rgba(0,0,0,.35); transform: translateX(-50%); transition: left .5s cubic-bezier(.22,.61,.36,1); }
    .body { width: 240px; padding: 0 12px; max-height: 0; overflow: hidden; transition: max-height .22s ease, padding .22s ease; }
    .open .body { max-height: 300px; padding: 8px 12px 12px; }
    .spark { margin-bottom: 4px; }
    .spark svg { display: block; width: 100%; height: 38px; }
    .sparkcap { font-size: 9px; letter-spacing: .04em; color: var(--muted); margin: 0 0 3px; text-transform: uppercase; }
    .sparkcap i { font-style: normal; font-weight: 800; }
    .sparkcap .u { color: var(--up); } .sparkcap .d { color: var(--down); }
    .spark .msg { display: flex; align-items: center; height: 40px; font-size: 10.5px; color: var(--muted); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 12px; font-size: 11.5px; margin-top: 8px; }
    .cell { display: flex; justify-content: space-between; gap: 8px; }
    .cell .k { color: var(--key); } .cell .v { font-variant-numeric: tabular-nums; font-weight: 700; }
    .cell .v.u { color: var(--up); } .cell .v.d { color: var(--down); }
    .foot { margin-top: 10px; font-size: 9.5px; color: var(--foot); letter-spacing: .04em; text-transform: uppercase; }
  `;
  const STRUCT = `
    <div class="wrap dark" id="wrap">
      <div class="head" id="head">
        <span class="dot"></span>
        <span class="state" id="state">GAUGING</span>
        <span class="glance" id="glance"></span>
        <button class="closeb" id="closeb" title="Close (turn off for this site)">✕</button>
      </div>
      <div class="meter"><span class="needle" id="needle" style="left:50%"></span></div>
      <div class="body" id="body">
        <div class="spark" id="spark"></div>
        <div class="grid" id="grid"></div>
        <div class="foot" id="foot"></div>
      </div>
    </div>`;

  // ---- build ---------------------------------------------------------------
  function build() {
    host = document.createElement("div");
    host.id = "rvt-pulse-host";
    host.style.cssText = "all:initial; position:fixed; z-index:2147483600; top:120px; right:14px;";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${CSS}</style>${STRUCT}`;
    document.documentElement.appendChild(host);
    wrap = q("wrap");

    wrap.classList.toggle("open", expanded);
    applyTheme();

    makeDraggable(q("head"), () => { if (!dragged) toggle(); });
    const cl = q("closeb");
    cl.addEventListener("pointerdown", (e) => e.stopPropagation());
    cl.addEventListener("click", (e) => { e.stopPropagation(); closeHere(); });
    restorePos();
  }

  function toggle() {
    expanded = !expanded;
    wrap.classList.toggle("open", expanded);
    chrome.storage?.local.set({ pulseExpanded: expanded });
  }

  // The X button: hide the chip on THIS site and untick it in the popup, by
  // dropping this hostname from the enabled-sites list. The storage change then
  // flips `enabled` off and stops the chip (see the onChanged listener).
  async function closeHere() {
    const s = await chrome.storage?.local.get({ pulseSites: [] });
    const cur = new Set(Array.isArray(s.pulseSites) ? s.pulseSites : []);
    cur.delete(HOST);
    chrome.storage?.local.set({ pulseSites: [...cur] });
  }

  // ---- the ADV/DEC graph ---------------------------------------------------
  function sparkSVG() {
    if (history.length < 2) return "";
    const W = 216, H = 38, pad = 3;
    const t0 = history[0].t, t1 = history[history.length - 1].t;
    const span = Math.max(1, t1 - t0);
    let yMax = 1;
    for (const p of history) yMax = Math.max(yMax, p.adv, p.dec);
    const x = (t) => (pad + ((t - t0) / span) * (W - 2 * pad)).toFixed(1);
    const y = (v) => (H - pad - (v / yMax) * (H - 2 * pad)).toFixed(1);
    const pts = (k) => history.map((p) => `${x(p.t)},${y(p[k])}`).join(" ");
    return `<div class="sparkcap"><i class="u">ADV</i> vs <i class="d">DEC</i> today</div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <polyline points="${pts("dec")}" fill="none" style="stroke:var(--down)" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/>
      <polyline points="${pts("adv")}" fill="none" style="stroke:var(--up)" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }

  // ---- render --------------------------------------------------------------
  function render(m) {
    if (!wrap) return;
    lastMetrics = m;
    const light = wrap.classList.contains("light");
    const col = (STATE_COLOR[m.state] || STATE_COLOR.gauging)[light ? "light" : "dark"];
    wrap.style.setProperty("--c", col);
    wrap.classList.toggle("live", m.state !== "gauging");

    q("state").textContent = STATES[m.state] || "GAUGING";
    q("needle").style.left = clamp(m.value, 2, 98) + "%";

    const glance = q("glance");
    if (m.state === "gauging") glance.textContent = symbols.length ? "reading…" : "load a list";
    else glance.innerHTML =
      `<b>${Math.round(m.breadthPct)}%</b> up · <span class="u">▲${m.up}</span> <span class="d">▼${m.down}</span>`;

    const sv = sparkSVG();
    q("spark").innerHTML = sv
      ? sv
      : symbols.length
        ? `<div class="msg">${graphCapped ? "graph off for very large lists" : "building today's graph…"}</div>`
        : "";

    const cell = (k, v, cls) => `<div class="cell"><span class="k">${k}</span><span class="v ${cls || ""}">${v}</span></div>`;
    const thrustCls = m.thrust >= 2 ? "u" : m.thrust <= 0.5 ? "d" : "";
    const avgCls = m.avg > 0.05 ? "u" : m.avg < -0.05 ? "d" : "";
    q("grid").innerHTML =
      cell("Advancing", m.up, m.up ? "u" : "") +
      cell("Declining", m.down, m.down ? "d" : "") +
      cell("Up ≥4.5%", m.strongUp, m.strongUp ? "u" : "") +
      cell("Down ≥4.5%", m.strongDn, m.strongDn ? "d" : "") +
      cell("Thrust ≥4.5%", `${m.thrust.toFixed(1)}×`, thrustCls) +
      cell("Avg move", `${m.avg >= 0 ? "+" : ""}${m.avg.toFixed(2)}%`, avgCls);

    q("foot").textContent = (m.state === "gauging" && !symbols.length)
      ? "Open the RVOL Tools popup to load a list"
      : `from your ${m.n} names · via scanner · live`;
  }

  // ---- data loop -----------------------------------------------------------
  async function tick() {
    if (!enabled || fetching) return;
    applyTheme();
    if (!symbols.length) { render(compute([])); return; }
    fetching = true;
    try {
      const resp = await chrome.runtime.sendMessage({
        cmd: "pulseChange",
        payload: { symbols: symbols.map((s) => `NSE:${s}`) },
      });
      if (resp?.ok) {
        const ch = resp.data.change || {};
        const changes = [];
        for (const s of symbols) { const v = ch[`NSE:${s}`]; if (typeof v === "number") changes.push(v); }
        const m = compute(changes);
        maintainGraph(m);
        render(m);
      }
    } catch (_) { /* worker asleep / transient, next tick retries */ }
    finally { fetching = false; }
  }

  // Keep the graph on the right session. Pre-open the backfill returns yesterday
  // (which is what we show); once today's session is live we re-backfill to swap
  // to today's path, and only then start appending live points, so there's no
  // ugly overnight gap in the line.
  function maintainGraph(m) {
    if (m.state === "gauging") return;
    const ist = istInfo();
    const inSession = !ist.weekend && ist.mins >= 555 && ist.mins <= 940; // 09:15..15:40 IST
    if (symbols.length && inSession && histDate !== ist.date && Date.now() - lastBackfillAt > 120000) {
      backfill();
    }
    const now = Math.floor(Date.now() / 1000);
    if (inSession && histDate === ist.date && now - lastHistPush > HIST_MS / 1000) {
      history.push({ t: now, adv: m.up, dec: m.down });
      while (history.length > HIST_MAX) history.shift();
      lastHistPush = now;
    }
  }

  // Seed the graph with a full advance/decline path (today's if the session is
  // live, else the prior close's) so the line is right whatever time the chip is
  // switched on. Very large lists come back capped (the SW won't fire hundreds of
  // fetches at once); the graph then just builds forward through the session.
  async function backfill() {
    if (!symbols.length) { history = []; histDate = ""; return; }
    lastBackfillAt = Date.now();
    try {
      const resp = await chrome.runtime.sendMessage({
        cmd: "pulseIntraday",
        payload: { symbols: symbols.map((s) => `NSE:${s}`) },
      });
      if (resp?.ok) {
        graphCapped = !!resp.data.capped;
        if (Array.isArray(resp.data.series) && resp.data.series.length) {
          history = resp.data.series.map((p) => ({ t: p.t, adv: p.adv, dec: p.dec }));
          histDate = resp.data.sessionDate || "";
          if (lastMetrics) render(lastMetrics);
        }
      }
    } catch (_) {}
  }

  // If a TV watchlist link is set, re-read it so edits on TV flow through
  // without re-pasting. Only writes when the list actually changed.
  async function refreshFromUrl() {
    if (!pulseUrl) return;
    try {
      const resp = await chrome.runtime.sendMessage({ cmd: "fetchTVWatchlist", payload: { url: pulseUrl } });
      if (resp?.ok && Array.isArray(resp.data.symbols) && resp.data.symbols.length) {
        const next = resp.data.symbols;
        if (next.join(",") !== symbols.join(",")) {
          symbols = next;
          chrome.storage?.local.set({ pulseSymbols: next });
        }
      }
    } catch (_) {}
  }

  function resetGraph() { history = []; histDate = ""; lastHistPush = 0; lastBackfillAt = 0; backfill(); }

  function start() {
    if (!host) build();
    host.style.display = "";
    resetGraph();
    tick();
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

  // ---- drag (with click-vs-drag detection) ---------------------------------
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

  function restorePos() {
    chrome.storage?.local.get({ [POS_KEY]: null }).then((s) => {
      const p = s[POS_KEY];
      if (p && typeof p.left === "number") {
        const w = host.offsetWidth || 240, h = host.offsetHeight || 60;
        host.style.left = clamp(p.left, 0, innerWidth - w) + "px";
        host.style.top = clamp(p.top, 0, innerHeight - h) + "px";
        host.style.right = "auto";
      }
    });
  }

  // ---- settings (storage-driven) -------------------------------------------
  chrome.storage?.local.get(DEFAULTS).then((s) => {
    enabled = Array.isArray(s.pulseSites) && s.pulseSites.includes(HOST);
    symbols = Array.isArray(s.pulseSymbols) ? s.pulseSymbols : [];
    pulseUrl = s.pulseUrl || "";
    expanded = s.pulseExpanded === true;
    if (enabled) start();
  });

  chrome.storage?.onChanged.addListener((c) => {
    if ("pulseSites" in c) {
      const sites = Array.isArray(c.pulseSites.newValue) ? c.pulseSites.newValue : [];
      const nowOn = sites.includes(HOST);
      if (nowOn !== enabled) { enabled = nowOn; enabled ? start() : stop(); }
    }
    if ("pulseSymbols" in c) symbols = Array.isArray(c.pulseSymbols.newValue) ? c.pulseSymbols.newValue : [];
    if ("pulseUrl" in c) pulseUrl = c.pulseUrl.newValue || "";
    if (enabled && "pulseSymbols" in c) { resetGraph(); tick(); }
    if (enabled && "pulseUrl" in c) refreshFromUrl();
  });
})();
