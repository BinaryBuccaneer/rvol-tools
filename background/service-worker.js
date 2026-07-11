// RVOL Tools, background service worker.
// Central message router for the cross-origin work the page scripts can't do
// (CORS): computing Relative Volume for the watchlist sorter + the Top-RVOL
// leaderboard, reading a shared TradingView watchlist, and switching the chart
// symbol in an open TradingView tab.

// On first install, turn the sort ON for both sites so it just works after
// loading. Users can flip it off from the popup.
chrome.runtime.onInstalled.addListener(async () => {
  const s = await chrome.storage.local.get(["rvolTV", "rvolKite"]);
  const set = {};
  if (s.rvolTV === undefined) set.rvolTV = true;
  if (s.rvolKite === undefined) set.rvolKite = true;
  if (Object.keys(set).length) await chrome.storage.local.set(set);
});

const HANDLERS = {
  // Compute Relative Volume for a set of EXCHANGE:TICKER symbols.
  //   RVOL = (today's volume so far) / (avg daily volume over `lookback` days)
  // The lookback average uses only PRIOR closed days, so it's constant for the
  // whole session, fetched once per symbol per day from Yahoo and cached.
  // Today's live volume comes from TradingView's scanner (real-time, batched).
  // Returns { rvol: { "NSE:SUZLON": 0.53, … } }, symbols we couldn't price
  // are simply omitted (the sorter leaves those rows in place).
  async fetchRVOL({ symbols, lookback = 20 }) {
    const uniq = [...new Set((symbols || []).filter(Boolean))];
    if (!uniq.length) return { rvol: {} };

    const today = new Date().toISOString().slice(0, 10);
    const keyOf = (s) => `rvolAvg:${s}:${today}:${lookback}`;

    // 1) lookback-day average volume, cached per symbol per day.
    const cached = await chrome.storage.local.get(uniq.map(keyOf));
    const avg = {};
    const need = [];
    for (const s of uniq) {
      const v = cached[keyOf(s)];
      if (typeof v === "number" && v > 0) avg[s] = v;
      else need.push(s);
    }
    if (need.length) {
      const toStore = {};
      await Promise.all(
        need.map(async (s) => {
          const a = await yahooAvgVolume(s, lookback).catch(() => null);
          if (a > 0) {
            avg[s] = a;
            toStore[keyOf(s)] = a;
          }
        })
      );
      if (Object.keys(toStore).length) await chrome.storage.local.set(toStore);
    }

    // 2) today's live volume from the scanner, grouped by region.
    const todayVol = await scannerVolumes(uniq).catch(() => ({}));

    // 3) RVOL = today / avg, where both are known.
    const rvol = {};
    for (const s of uniq) {
      const a = avg[s];
      const t = todayVol[s];
      if (a > 0 && typeof t === "number") rvol[s] = t / a;
    }
    return { rvol };
  },

  // Top-RVOL leaderboard data: RVOL (reuses fetchRVOL unchanged) + live Chg% for
  // the given EXCHANGE:TICKER symbols, in one round trip. Keys match fetchRVOL
  // (full "NSE:SYM"). Used by content/rvol-board.js.
  async boardQuotes({ symbols, lookback = 20 }) {
    const uniq = [...new Set((symbols || []).filter(Boolean))];
    if (!uniq.length) return { rvol: {}, change: {} };
    const [{ rvol }, change] = await Promise.all([
      HANDLERS.fetchRVOL({ symbols: uniq, lookback }),
      tvScanChange(uniq).catch(() => ({})),
    ]);
    return { rvol, change };
  },

  // Market Pulse data: live Chg% for the given EXCHANGE:TICKER symbols, in one
  // batched scanner call. Keyed by the full "NSE:SYM". The chip turns these into
  // an advance/decline + thrust read. Used by content/market-pulse.js.
  async pulseChange({ symbols }) {
    const uniq = [...new Set((symbols || []).filter(Boolean))];
    if (!uniq.length) return { change: {} };
    const change = await tvScanChange(uniq).catch(() => ({}));
    return { change };
  },

  // Backfill today's advance/decline PATH for the Market Pulse graph, so the line
  // is correct no matter what time you turn the chip on (not just from turn-on).
  // For each symbol we pull today's intraday bars (Yahoo, 5-min) and its prior
  // close, turn each bar into a cumulative day % change, then count advancers vs
  // decliners at every 5-min step. Returns { series: [{t, adv, dec}], capped }.
  // Capped (list too big for one-fetch-per-symbol) → chip builds the line forward.
  async pulseIntraday({ symbols, bucketMins = 5 }) {
    const uniq = [...new Set((symbols || []).filter(Boolean))];
    if (!uniq.length) return { series: [] };
    if (uniq.length > 600) return { series: [], capped: true };

    const perSym = [];
    const CH = 12; // pace Yahoo: 12 symbols per round, a short breath between rounds
    for (let i = 0; i < uniq.length; i += CH) {
      const chunk = uniq.slice(i, i + CH);
      const got = await Promise.all(chunk.map((s) => yahooIntraday(s, bucketMins).catch(() => null)));
      for (const g of got) if (g && g.size) perSym.push(g);
      if (i + CH < uniq.length) await new Promise((r) => setTimeout(r, 100));
    }
    if (!perSym.length) return { series: [] };

    // union time grid across all symbols (they share the NSE 5-min session grid)
    const gridSet = new Set();
    for (const m of perSym) for (const t of m.keys()) gridSet.add(t);
    const grid = [...gridSet].sort((a, b) => a - b);
    const series = grid.map((t) => ({ t, adv: 0, dec: 0 }));

    // forward-fill each symbol's last-known cumulative % across the grid, so a
    // bar-less 5-min slot still carries the stock's day change so far.
    for (const m of perSym) {
      let last = null;
      for (let i = 0; i < grid.length; i++) {
        const v = m.get(grid[i]);
        if (typeof v === "number") last = v;
        if (last != null) { if (last > 0.1) series[i].adv++; else if (last < -0.1) series[i].dec++; }
      }
    }
    // which IST session these bars belong to (today vs the prior close): lets the
    // chip show yesterday pre-open and swap to today at the open, with no gap.
    const lastT = grid[grid.length - 1];
    const sessionDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(lastT * 1000));
    return { series, sessionDate };
  },

  // Fetch a *shared* TradingView watchlist page and extract its symbols, in list
  // order, de-duplicated. Returns bare NSE symbols (no "NSE:" prefix). Lets the
  // leaderboard track a watchlist link instead of a hand-pasted list.
  async fetchTVWatchlist({ url }) {
    if (!url) throw new Error("No TradingView watchlist URL.");
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`TradingView returned HTTP ${res.status}.`);
    const html = await res.text();
    // The watchlist's own symbols live in a "symbols":[...] array in the page
    // data. Parse that array specifically, grepping the whole page also catches
    // unrelated tickers (index bar, popular stocks) on small lists.
    const arr = html.match(/"symbols":\[(.*?)\]/);
    const scope = arr ? arr[1] : html;
    const matches = scope.match(/NSE:[A-Z0-9_&.\-]+/g) || [];
    const seen = new Set();
    const symbols = [];
    for (const m of matches) {
      const bare = m.slice(4); // drop "NSE:"
      if (!seen.has(bare)) { seen.add(bare); symbols.push(bare); }
    }
    return { symbols };
  },

  // Switch the chart in the open TradingView tab WITHOUT activating/focusing it,
  // so clicking/arrowing a row from a panel on another monitor changes the chart
  // while keyboard focus stays where it is. The switch is pure DOM, no focus
  // needed. Used by the leaderboard's click-to-chart + arrow scroller.
  async setTVSymbol({ symbol }) {
    if (!symbol) throw new Error("No symbol.");
    const tabs = await chrome.tabs.query({
      url: ["https://www.tradingview.com/*", "https://in.tradingview.com/*"],
    });
    if (!tabs.length) return { switched: false, reason: "no-tv-tab" };
    const tab = tabs.slice().sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { cmd: "setChartSymbol", symbol });
      return { switched: !!(res && res.ok), tabId: tab.id, detail: res };
    } catch (e) {
      return { switched: false, reason: "no-content-script", tabId: tab.id };
    }
  },

  // Kite twin of setTVSymbol: switch the chart in an open Kite CHART tab
  // without activating/focusing it. Targets the most recently viewed Kite
  // chart tab; chart-scroll.js in its top frame does the actual switch.
  async setKiteSymbol({ symbol }) {
    if (!symbol) throw new Error("No symbol.");
    const tabs = await chrome.tabs.query({ url: "https://kite.zerodha.com/markets/chart/*" });
    if (!tabs.length) return { switched: false, reason: "no-kite-chart-tab" };
    const tab = tabs.slice().sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { cmd: "openKiteSymbol", payload: { symbol } });
      return { switched: !!(res && res.ok), tabId: tab.id, detail: res };
    } catch (e) {
      return { switched: false, reason: "no-content-script", tabId: tab.id };
    }
  },

  // Resolve a tradingsymbol to Zerodha's instrument token (the last URL part
  // of Kite's chart page: /markets/chart/web/tvc/NSE/SYMBOL/TOKEN). Source is
  // Zerodha's PUBLIC instruments dump — api.kite.trade/instruments/<exchange>,
  // a plain CSV, no login — parsed once and cached per exchange per day.
  // Used by chart-scroll.js as the guaranteed way to open any stock's chart.
  async kiteToken({ exchange = "NSE", symbol }) {
    if (!symbol) throw new Error("No symbol given.");
    const map = await instrumentMap(exchange);
    const token = map[symbol.toUpperCase()];
    if (!token) throw new Error(`No ${exchange} instrument token for ${symbol}.`);
    return { token };
  },
};

// --- instrument-token cache for kiteToken -----------------------------------
const tokMem = {};
async function instrumentMap(exchange) {
  const exch = exchange.toUpperCase();
  const day = new Date().toLocaleDateString("en-CA");
  if (tokMem[exch]?.day === day) return tokMem[exch].map;

  const storeKey = `kiteTokens:${exch}`;
  const stored = (await chrome.storage.local.get(storeKey))[storeKey];
  if (stored?.day === day && stored.map) {
    tokMem[exch] = stored;
    return stored.map;
  }

  const res = await fetch(`https://api.kite.trade/instruments/${exch}`, { credentials: "omit" });
  if (!res.ok) throw new Error(`instruments dump HTTP ${res.status}`);
  const csv = await res.text();
  const map = {};
  for (const line of csv.split("\n").slice(1)) {
    const c = line.split(",");
    if (c.length < 3 || !c[0] || !/^\d+$/.test(c[0])) continue;
    map[c[2].toUpperCase()] = c[0];
  }
  if (!Object.keys(map).length) throw new Error("instruments dump parsed empty");
  tokMem[exch] = { day, map };
  await chrome.storage.local.set({ [storeKey]: tokMem[exch] }).catch(() => {});
  return map;
}

// --- helpers for fetchRVOL ------------------------------------------------

// Map an EXCHANGE:TICKER to the symbol Yahoo Finance expects.
//   NSE:SUZLON -> SUZLON.NS   BSE:x -> x.BO   US (NASDAQ/NYSE/…) -> bare ticker
function yahooSymbol(s) {
  const [ex, tk] = s.includes(":") ? s.split(":") : ["", s];
  if (!tk) return s;
  if (ex === "NSE") return tk + ".NS";
  if (ex === "BSE") return tk + ".BO";
  return tk; // US exchanges use the bare ticker on Yahoo
}

// Average daily volume over the `n` most recent CLOSED days (excludes the
// latest, possibly-partial, bar). Pulled from Yahoo's daily chart.
async function yahooAvgVolume(s, n) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      yahooSymbol(s)
    )}?range=3mo&interval=1d`;
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const j = await res.json();
  const vols = (j?.chart?.result?.[0]?.indicators?.quote?.[0]?.volume || [])
    .filter((v) => typeof v === "number" && v > 0);
  if (vols.length < 2) return null;
  const prior = vols.slice(-(n + 1), -1); // drop the latest bar (today)
  if (!prior.length) return null;
  return prior.reduce((a, b) => a + b, 0) / prior.length;
}

// Today's intraday path for one symbol, as a Map(bucketStartEpoch -> cumulative
// % change vs the prior close). Used only for the Market Pulse graph backfill.
async function yahooIntraday(s, bucketMins) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      yahooSymbol(s)
    )}?interval=${bucketMins}m&range=1d`;
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  const prev = r?.meta?.chartPreviousClose ?? r?.meta?.previousClose;
  const ts = r?.timestamp || [];
  const close = r?.indicators?.quote?.[0]?.close || [];
  const map = new Map();
  if (!(prev > 0) || !ts.length) return map;
  const bucket = bucketMins * 60;
  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    if (typeof c !== "number") continue;
    const t = Math.floor(ts[i] / bucket) * bucket;
    map.set(t, ((c / prev) - 1) * 100);
  }
  return map;
}

// Which scanner region serves a given symbol's exchange.
function scannerRegion(s) {
  const ex = s.split(":")[0];
  if (ex === "NSE" || ex === "BSE") return "india";
  if (["NASDAQ", "NYSE", "AMEX", "BATS", "ARCA"].includes(ex)) return "america";
  return null;
}

// Today's live volume per symbol, one scanner call per region.
async function scannerVolumes(symbols) {
  const groups = {};
  for (const s of symbols) {
    const r = scannerRegion(s);
    if (r) (groups[r] = groups[r] || []).push(s);
  }
  const out = {};
  await Promise.all(
    Object.entries(groups).map(async ([region, tickers]) => {
      const res = await fetch(`https://scanner.tradingview.com/${region}/scan`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: { tickers, query: { types: [] } },
          columns: ["volume"],
        }),
      });
      if (!res.ok) return;
      const j = await res.json();
      for (const row of j?.data || []) {
        const v = row?.d?.[0];
        if (typeof v === "number") out[row.s] = v;
      }
    })
  );
  return out;
}

// Live Chg% per EXCHANGE:TICKER symbol from the TV scanner, batched. Keyed by
// the full "NSE:SYM" (same as scannerVolumes). text/plain dodges the preflight.
async function tvScanChange(symbols) {
  const out = {};
  const CH = 400;
  for (let i = 0; i < symbols.length; i += CH) {
    const batch = symbols.slice(i, i + CH);
    const res = await fetch("https://scanner.tradingview.com/india/scan", {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ symbols: { tickers: batch, query: { types: [] } }, columns: ["change"] }),
    });
    if (!res.ok) continue;
    const j = await res.json();
    for (const row of j?.data || []) out[row.s] = row?.d?.[0] ?? null;
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg?.cmd];
  if (!handler) return false; // not ours
  handler(msg.payload || {}, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
  return true; // async response
});
