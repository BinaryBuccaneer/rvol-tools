// Popup for RVOL Tools. Everything is storage-driven: the content scripts react
// to chrome.storage changes live, so flipping a control takes effect on the open
// tab with no reload.

const DEFAULTS = {
  sortTV: false,
  sortKite: false,
  rvolTV: false,
  rvolKite: false,
  rvolBadges: false,
  rvolBoardSites: [],
  rvolBoardTopN: 30,
  rvolBoardSymbols: [],
  rvolBoardUrl: "",
  rvolBoardTheme: "auto",
  pulseSites: [],
  pulseSymbols: [],
  pulseUrl: "",
};

const $ = (id) => document.getElementById(id);

// One-time cleanup: keys left behind by the removed full-list (server) mode.
chrome.storage.local.get(null).then((all) => {
  const stale = Object.keys(all).filter((k) => k === "fullTV" || k.startsWith("svOrig:"));
  if (stale.length) chrome.storage.local.remove(stale);
});

// ---- watchlist sorter: one Off / % Chg / RVOL choice per site --------------
// Stored as the two booleans the content script watches (pct key + rvol key);
// the segmented control just writes them as a pair so only one can be on.
const SEGS = [
  { el: $("segTV"), pctKey: "sortTV", rvolKey: "rvolTV" },
  { el: $("segKite"), pctKey: "sortKite", rvolKey: "rvolKite" },
];

for (const seg of SEGS) {
  const paint = (mode) => {
    for (const b of seg.el.querySelectorAll("button")) {
      b.classList.toggle("on", b.dataset.mode === mode);
    }
  };
  chrome.storage.local.get({ [seg.pctKey]: false, [seg.rvolKey]: false }).then((s) => {
    paint(s[seg.rvolKey] === true ? "rvol" : s[seg.pctKey] === true ? "pct" : "off");
  });
  seg.el.addEventListener("click", (e) => {
    const mode = e.target && e.target.dataset ? e.target.dataset.mode : null;
    if (!mode) return;
    chrome.storage.local.set({
      [seg.pctKey]: mode === "pct",
      [seg.rvolKey]: mode === "rvol",
    });
    paint(mode);
  });
}

// ---- RVOL badge toggle ------------------------------------------------------
chrome.storage.local.get({ rvolBadges: false }).then((s) => {
  const box = $("rvolBadges");
  box.checked = s.rvolBadges === true;
  box.addEventListener("change", () => chrome.storage.local.set({ rvolBadges: box.checked }));
});

// ---- sorter debug: one click shows what the content script is doing -------
// The most common failure is an ORPHANED content script: after the extension
// is reloaded, tabs that were already open still run the OLD script, which
// can no longer talk to the extension. The error branch spells that out.
$("wlDebug").addEventListener("click", async () => {
  const out = $("wlDebugOut");
  // Second click collapses the readout.
  if (out.textContent) { out.textContent = ""; return; }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { out.textContent = "No active tab."; return; }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { cmd: "debugSorter" });
    out.textContent = JSON.stringify(res && res.data ? res.data : res, null, 1);
  } catch (_) {
    out.textContent =
      "The sorter script is NOT running in this tab. Refresh the TradingView " +
      "or Kite tab (Cmd+Shift+R). A refresh is needed after EVERY extension " +
      "reload; until then the sorter in that tab is dead.";
  }
});

// Pull bare symbols out of a pasted list. Prefers NSE: tokens; falls back to
// plain tickers. Any "###" section headers are ignored.
function parseSymbols(text) {
  const out = [], seen = new Set();
  const re = /NSE:([A-Z0-9_&.\-]+)/gi;
  let m;
  while ((m = re.exec(text))) { const t = m[1].toUpperCase(); if (!seen.has(t)) { seen.add(t); out.push(t); } }
  if (out.length) return out;
  for (const tok of text.split(/[\s,]+/)) {
    const t = tok.trim().toUpperCase();
    if (!t || t.startsWith("###")) continue;
    if (/^[A-Z0-9_&.\-]{1,20}$/.test(t) && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

// Bind a per-hostname "Show on this site" switch to a sites-array storage key.
function bindSiteToggle({ box, label, note, key, hostName, initialSites }) {
  const sites = new Set(Array.isArray(initialSites) ? initialSites : []);
  if (hostName) {
    label.textContent = `Show on this site (${hostName})`;
    box.checked = sites.has(hostName);
    box.disabled = false;
    box.addEventListener("change", async () => {
      const cur = new Set((await chrome.storage.local.get({ [key]: [] }))[key] || []);
      box.checked ? cur.add(hostName) : cur.delete(hostName);
      await chrome.storage.local.set({ [key]: [...cur] });
    });
    const others = [...sites].filter((h) => h !== hostName);
    note.textContent = others.length ? `Also on: ${others.join(", ")}` : "";
  } else {
    label.textContent = "Show on this site";
    box.checked = false;
    box.disabled = true;
    note.textContent = "Open a normal website tab to switch it on there.";
  }
}

// Bind a list loader (paste symbols OR a TV watchlist link, auto-detected) to a
// symbols key + a url key, with a status note.
function bindListLoader({ textarea, button, note, symbolsKey, urlKey, state }) {
  const show = (st) => {
    const n = (st[symbolsKey] || []).length;
    if (st[urlKey]) note.textContent = n ? `Tracking a TV watchlist link (${n} symbols).` : "Tracking a TV watchlist link.";
    else note.textContent = n ? `${n} symbols loaded.` : "No list yet. Paste symbols or a link, then Load.";
  };
  show(state);

  button.addEventListener("click", async () => {
    const text = textarea.value.trim();
    if (!text) { note.textContent = "Paste symbols or a TradingView link first."; return; }

    const urlMatch = text.match(/https?:\/\/\S*tradingview\.com\/\S+/i);
    if (urlMatch) {
      note.textContent = "Reading watchlist…";
      let resp = null;
      try { resp = await chrome.runtime.sendMessage({ cmd: "fetchTVWatchlist", payload: { url: urlMatch[0] } }); } catch (_) {}
      if (resp && resp.ok && resp.data.symbols && resp.data.symbols.length) {
        await chrome.storage.local.set({ [symbolsKey]: resp.data.symbols, [urlKey]: urlMatch[0] });
        note.textContent = `Tracking a TV watchlist link (${resp.data.symbols.length} symbols). It re-reads itself, so edits on TV flow through.`;
        textarea.value = "";
      } else {
        note.textContent = "Couldn't read that watchlist link. Is it a shared (public) TradingView watchlist?";
      }
      return;
    }

    const syms = parseSymbols(text);
    if (!syms.length) { note.textContent = "No symbols found in that paste."; return; }
    await chrome.storage.local.set({ [symbolsKey]: syms, [urlKey]: "" });
    note.textContent = `Loaded ${syms.length} symbols.`;
    textarea.value = "";
  });
}

// ---- Top RVOL board + Market Pulse ---------------------------------------
// Both run on every site; the popup turns each on for the site of the tab you're
// currently looking at (a per-hostname list). So they're screen-agnostic: enable
// on any broker, a second-monitor tab, or wherever you want the read.
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let hostName = "";
  try { hostName = tab && tab.url ? new URL(tab.url).hostname : ""; } catch (_) {}

  const s = await chrome.storage.local.get(DEFAULTS);

  // -- Top RVOL board --
  bindSiteToggle({
    box: $("boardHere"), label: $("boardHereLabel"), note: $("boardHereNote"),
    key: "rvolBoardSites", hostName, initialSites: s.rvolBoardSites,
  });

  $("boardTopN").value = s.rvolBoardTopN || 30;
  $("boardTopN").addEventListener("change", () => {
    let v = parseInt($("boardTopN").value, 10);
    if (!Number.isFinite(v) || v < 3) v = 3;
    if (v > 100) v = 100;
    $("boardTopN").value = v;
    chrome.storage.local.set({ rvolBoardTopN: v });
  });

  $("boardTheme").value = s.rvolBoardTheme || "auto";
  $("boardTheme").addEventListener("change", () =>
    chrome.storage.local.set({ rvolBoardTheme: $("boardTheme").value }));

  bindListLoader({
    textarea: $("boardList"), button: $("boardLoad"), note: $("boardNote"),
    symbolsKey: "rvolBoardSymbols", urlKey: "rvolBoardUrl", state: s,
  });

  // -- Market Pulse --
  bindSiteToggle({
    box: $("pulseHere"), label: $("pulseHereLabel"), note: $("pulseHereNote"),
    key: "pulseSites", hostName, initialSites: s.pulseSites,
  });

  bindListLoader({
    textarea: $("pulseList"), button: $("pulseLoad"), note: $("pulseNote"),
    symbolsKey: "pulseSymbols", urlKey: "pulseUrl", state: s,
  });
})();
