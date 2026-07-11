// RVOL Tools, shared watchlist content script.
// Runs on BOTH Kite and TradingView. This is where the live "keep the
// watchlist sorted by % change (gainers on top)" feature lives, so a single
// file serves both sites.
//
// For now it ships ONE read-only command, captureWatchlist, used to confirm
// each site's real DOM (row container + the % cell) before the sorter is wired
// to it. Read-only and safe.

const WLS_TAG = "[RVOL Tools/WL]";
const wlog = (...a) => console.log(WLS_TAG, ...a);

const SITE = /tradingview\.com/.test(location.hostname)
  ? "tradingview"
  : /kite\.zerodha\.com/.test(location.hostname)
  ? "kite"
  : "other";

// A standalone percent value. Note the minus class includes ASCII "-",
// the Unicode minus "−" (U+2212, used by TradingView) and an en-dash.
const PCT_RE = /^[+\-−–]?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*%$/;

function parsePct(text) {
  const t = (text || "").replace(/,/g, "").replace(/[−–]/g, "-");
  const m = t.match(/[+-]?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// True if `el` is the innermost element whose text is a percent value.
// Tolerates icon-only children (e.g. Kite's ▾ arrow inside the change cell):
// it's a pct cell as long as no *child* also reads as a full percent.
function isPctCell(el) {
  const t = (el.textContent || "").trim();
  if (!PCT_RE.test(t)) return false;
  for (const c of el.children) {
    if (PCT_RE.test((c.textContent || "").trim())) return false;
  }
  return true;
}

// How many direct children of `parent` contain a percent cell somewhere.
function rowsWithPct(parent) {
  let n = 0;
  for (const child of parent.children) {
    if (isPctCell(child)) {
      n++;
      continue;
    }
    for (const l of child.querySelectorAll("*")) {
      if (isPctCell(l)) {
        n++;
        break;
      }
    }
  }
  return n;
}

// From a percent cell, climb until we reach a "row": an element whose parent
// (the list container) holds several sibling rows that each carry a percent.
function rowAndContainer(cell) {
  let el = cell;
  for (let i = 0; i < 12 && el.parentElement; i++) {
    const parent = el.parentElement;
    if (parent.children.length >= 3 && rowsWithPct(parent) >= 3) {
      return { row: el, container: parent };
    }
    el = parent;
  }
  return null;
}

function describe(el) {
  if (!el) return null;
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    class: el.className && el.className.toString ? el.className.toString() : null,
    children: el.children.length,
  };
}

function bestSelector(el) {
  if (!el) return null;
  if (el.id) return `#${el.id}`;
  const cls = (el.className || "").toString().trim().split(/\s+/).filter(Boolean);
  if (cls.length) return el.tagName.toLowerCase() + "." + cls.join(".");
  return el.tagName.toLowerCase();
}

function pctCellOf(row) {
  for (const l of [row, ...row.querySelectorAll("*")]) {
    if (isPctCell(l)) return l;
  }
  return null;
}

// Locate candidate watchlists on whatever page we're on: every element that is
// the common parent of several percent-bearing rows. Returned ranked by how
// many such rows it holds (most first) so the real watchlist surfaces.
function findWatchlists() {
  const cells = [...document.querySelectorAll("*")].filter(isPctCell);
  const tally = new Map(); // container element -> {count, row}
  for (const c of cells) {
    const rc = rowAndContainer(c);
    if (!rc) continue;
    const cur = tally.get(rc.container) || { count: 0, row: rc.row };
    cur.count++;
    tally.set(rc.container, cur);
  }
  return [...tally.entries()]
    .map(([container, info]) => ({ container, ...info }))
    .sort((a, b) => b.count - a.count);
}

function summarizeCandidate(cand, withHtml) {
  const rows = [...cand.container.children].slice(0, 6);
  const sample = rows.map((row) => {
    const pctEl = pctCellOf(row);
    const o = {
      text: (row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      pct: pctEl ? parsePct(pctEl.textContent) : null,
      pctCellSelector: pctEl ? bestSelector(pctEl) : null,
    };
    if (withHtml) {
      const h = row.outerHTML;
      o.html = h.length > 1400 ? h.slice(0, 1400) + " …[truncated]" : h;
    }
    return o;
  });
  return {
    containerSelector: bestSelector(cand.container),
    container: describe(cand.container),
    rowSelector: bestSelector(cand.row),
    rowCount: cand.container.children.length,
    rowsWithPct: cand.count,
    sample,
  };
}

// Capture the structure so the sorter can be tuned without devtools. Reports
// the top candidate lists; the one whose sample shows your ticker symbols is
// the watchlist.
function captureWatchlist() {
  const cands = findWatchlists();
  if (!cands.length) {
    return { site: SITE, found: false, note: "No percent-bearing list found." };
  }
  return {
    site: SITE,
    found: true,
    candidateCount: cands.length,
    candidates: cands.slice(0, 3).map((c, i) => summarizeCandidate(c, i === 0)),
  };
}

const WL_COMMANDS = {
  captureWatchlist,
  debugKiteSort: () => debugKiteSort(),
  debugSorter: () => debugSorter(),
};

// =========================================================================
// Live watchlist sort, biggest gainer on top → biggest loser at the bottom.
// Two completely different mechanisms because the two sites are built
// differently:
//
//  • KITE , plain (non-virtualized) list. We use CSS `order` only: no row
//    node is ever moved/removed, so live price updates keep flowing and
//    nothing flickers. Applied to ALL lists (1/2/3 are all in the DOM).
//    Fully reversible when switched off. Sort panel never touched.
//
//  • TRADINGVIEW, virtualized, absolutely-positioned list, so reordering
//    its DOM would fight the renderer. Instead we drive TV's OWN column
//    sort by clicking the "Chg%" header until the list is descending. TV
//    then maintains the sort live as quotes update; we only re-assert when
//    the set of symbols changes (add/remove/list switch).
// =========================================================================

// NOTE: kite-content.js (loaded first, SAME isolated world) already declares
// `const sleep`, content scripts share one global scope, so re-declaring it
// here throws a SyntaxError that kills THIS whole file on load. Hence wsleep.
const wsleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sortEnabled = false; // default OFF until storage says otherwise
let sortMetric = "pct"; // "pct" = % change (reads the row); "rvol" = relative volume (from rvolMap)

// --- Relative-volume data (only used when sortMetric === "rvol") ----------
// rvolMap: EXCHANGE:TICKER -> RVOL number, refreshed from the background
// worker (Yahoo 20-day avg, cached + TradingView scanner live volume).
const RVOL_LOOKBACK = 20;
let rvolMap = new Map();
let rvolTimer = null;

// Symbols currently shown in the watchlist, as EXCHANGE:TICKER for the scanner.
function collectSymbols() {
  const out = new Set();
  if (SITE === "kite") {
    // Excluded list open (options/MCX): nothing to rank, don't poll for it.
    const activeNo = kiteActiveListNo();
    if (activeNo > 0 && kiteSkipLists.has(activeNo)) return [];
    for (const c of kiteContainers()) {
      if (getComputedStyle(c).display === "none") continue;
      for (const r of c.children) {
        if (r.matches && r.matches(KITE_ROW) && !kiteRowIsDeriv(r)) {
          const s = kiteSymbolOf(r);
          if (s) out.add(s);
        }
      }
    }
  } else if (SITE === "tradingview") {
    tvRowWrappers().forEach((w) => {
      const s = tvSymbolOf(w);
      if (s) out.add(s);
    });
  }
  return [...out];
}

async function refreshRVOL() {
  const symbols = collectSymbols();
  if (!symbols.length) return;
  try {
    const res = await chrome.runtime.sendMessage({
      cmd: "fetchRVOL",
      payload: { symbols, lookback: RVOL_LOOKBACK },
    });
    if (res && res.ok && res.data && res.data.rvol) {
      rvolMap = new Map(Object.entries(res.data.rvol));
      if (SITE === "kite") applyKiteSort();
      else if (SITE === "tradingview") applyTVSort();
    }
  } catch (e) {
    wlog("rvol fetch failed", e);
  }
}

// The 20-day average is cached per day, so each poll only re-fetches today's
// live volume from the scanner, cheap (one POST per region). 5s keeps the
// order fresh, faster than the TV screener's 10s floor, without hammering.
function startRVOLPolling() {
  stopRVOLPolling();
  refreshRVOL();
  rvolTimer = setInterval(refreshRVOL, 5000);
}
function stopRVOLPolling() {
  clearInterval(rvolTimer);
  rvolTimer = null;
}

// --- Kite ----------------------------------------------------------------
const KITE_ROW = ".item-wrapper.draggable-item";
const KITE_PCT = ".change-percentage";

let kiteObserver = null;
let kiteTimer = null;

// Marketwatch lists the sorter must LEAVE ALONE (many people keep an
// options/futures/MCX list, and sorting that one is just confusing).
// Editable in the popup (kiteSkipLists, e.g. "3" or "3,4"); default: none.
let kiteSkipLists = new Set();
function parseSkipLists(v) {
  return new Set(
    String(v ?? "")
      .split(/[\s,]+/)
      .map((x) => parseInt(x, 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 9)
  );
}

// The numbered list tabs at the marketwatch footer, selector-free. A tab is
// any SMALL visible element whose text is a single digit; the tab bar is the
// parent whose direct children's digits run 1..n. Tabs are deliberately NOT
// required to be leaf elements — the active tab can wrap its digit with an
// underline/marker child.
function kiteListTabs() {
  const byParent = new Map();
  for (const el of document.querySelectorAll("span,li,a,div,button")) {
    if (!/^[1-9]$/.test((el.textContent || "").trim())) continue;
    if (el.offsetWidth > 80 || el.offsetHeight > 60 || !el.offsetParent) continue;
    const p = el.parentElement;
    if (!p) continue;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(el);
  }
  let best = [];
  for (const els of byParent.values()) {
    if (els.length < 2 || els.length <= best.length) continue;
    const ds = els.map((e) => parseInt(e.textContent, 10)).sort((a, b) => a - b);
    if (ds[0] === 1 && ds.every((d, i) => d === i + 1)) best = els;
  }
  return best;
}

// The element inside a tab that actually holds the digit text (the styling —
// color, weight — often sits there, not on the wrapper).
function kiteTabTextEl(tab) {
  let n = tab;
  const txt = (tab.textContent || "").trim();
  while (n.firstElementChild && (n.firstElementChild.textContent || "").trim() === txt) {
    n = n.firstElementChild;
  }
  return n;
}

// Which marketwatch list is open, from the footer tabs. In order: an
// active/selected/current class on the tab OR anything inside it, else the
// odd-one-out by styling signature (text color + font weight + class) — the
// active tab is the one styled unlike its siblings. 0 = couldn't tell; then
// only the derivatives auto-skip below protects, not the numbered exclusions.
function kiteActiveListNo() {
  const tabs = kiteListTabs();
  if (tabs.length < 2) return 0;
  const act = tabs.find(
    (t) =>
      /active|selected|current/i.test((t.className && t.className.toString()) || "") ||
      t.querySelector('[class*="active" i],[class*="selected" i],[class*="current" i]')
  );
  if (act) return parseInt(act.textContent, 10);
  const sigs = tabs.map((t) => {
    const cs = getComputedStyle(kiteTabTextEl(t));
    return `${cs.color}|${cs.fontWeight}|${(t.className || "").toString()}`;
  });
  const counts = {};
  for (const sg of sigs) counts[sg] = (counts[sg] || 0) + 1;
  const rare = Object.keys(counts).filter((sg) => counts[sg] === 1);
  if (rare.length === 1 && Object.keys(counts).length === 2) {
    return parseInt(tabs[sigs.indexOf(rare[0])].textContent, 10);
  }
  return 0;
}

// Rows that aren't sortable stocks: futures / options / commodity. Caught by
// the data-id exchange prefix (MCX/NFO/BFO/CDS) or a FUT/CE/PE-suffixed name.
// A list holding 2+ such rows is treated as a derivatives list and is NEVER
// sorted, whatever its number — the safety net that protects an options list
// even when the active-list number can't be read (and with no setup at all).
function kiteRowIsDeriv(row) {
  const id = row.getAttribute("data-id") || "";
  if (/^(MCX|NFO|BFO|CDS)\b/i.test(id)) return true;
  const name = (row.querySelector(".symbol .name")?.textContent || "").trim();
  return /\b(FUT|CE|PE)$/i.test(name);
}
function kiteDerivHeavy(container) {
  let n = 0;
  for (const r of container.children) {
    if (r.matches && r.matches(KITE_ROW) && kiteRowIsDeriv(r)) n++;
    if (n >= 2) return true;
  }
  return false;
}

// Undo any sort styling on one container (row `order`s + the forced flex),
// so an excluded list snaps back to its manual order.
function clearKiteContainer(container) {
  for (const r of container.children) {
    if (r.matches && r.matches(KITE_ROW) && r.style.order !== "") r.style.order = "";
  }
  if (container.style.display) {
    container.style.removeProperty("display");
    container.style.removeProperty("flex-direction");
  }
}

// Robust "is on screen" test. NOT offsetParent (that's null for elements
// inside position:fixed ancestors, which Kite's panel uses, it would wrongly
// flag the visible list as hidden). A display:none element has no box here.
function isShown(el) {
  return !!(el.offsetHeight || el.offsetWidth || el.getClientRects().length);
}

function rowId(row) {
  return row.getAttribute("data-id") || "";
}

// Kite marketwatch is NSE/BSE; the visible symbol is the trading symbol, so
// "NSE:" + name is the scanner/Yahoo ticker (good enough for this watchlist).
function kiteSymbolOf(row) {
  const n = (row.querySelector(".symbol .name")?.textContent || "").trim();
  return n ? "NSE:" + n : "";
}

// The value a Kite row is ranked by, per the active metric. Unknowns sink.
function kiteRowValue(row) {
  if (sortMetric === "rvol") {
    const v = rvolMap.get(kiteSymbolOf(row));
    return v == null ? -Infinity : v;
  }
  const cell = row.querySelector(KITE_PCT);
  const p = cell ? parsePct(cell.textContent) : null;
  return p == null ? -Infinity : p;
}

// All marketwatch list containers currently in the DOM, de-duplicated. Kite
// mounts lists 1/2/3 at once and hides the inactive ones, so this can include
// hidden containers, callers must decide which to touch.
function kiteContainers() {
  const set = new Set();
  document.querySelectorAll(KITE_ROW).forEach((r) => {
    if (r.parentElement) set.add(r.parentElement);
  });
  return [...set];
}

// Sort by CSS `order`: make each list a flex column and give every row an
// `order` by % rank. No row node is moved/removed, so Kite's live updates keep
// flowing. Two things that bit us before, now fixed:
//   1. `display:flex` is set with !important, Kite's own stylesheet was
//      overriding a plain inline value, so `order` silently did nothing.
//   2. We sort EVERY list whose container isn't display:none (so lists 2/3
//      work too), but we NEVER override a display:none container, doing that
//      is what revealed hidden lists and corrupted the panel.
function applyKiteSort() {
  if (!sortEnabled || SITE !== "kite") return;
  const activeNo = kiteActiveListNo();
  const skipActive = activeNo > 0 && kiteSkipLists.has(activeNo);
  for (const container of kiteContainers()) {
    const cs = getComputedStyle(container);
    if (cs.display === "none") continue; // hidden/inactive list, leave it alone
    if (skipActive || kiteDerivHeavy(container)) {
      // Excluded or derivatives list: make sure it's unsorted and move on.
      clearKiteContainer(container);
      continue;
    }
    const rows = [...container.children].filter((r) => r.matches(KITE_ROW));
    if (rows.length < 2) continue;

    if (cs.display !== "flex" && cs.display !== "inline-flex") {
      container.style.setProperty("display", "flex", "important");
      container.style.setProperty("flex-direction", "column", "important");
    }

    // Rank by the active metric desc; rows with no value sink in place.
    const ranked = rows
      .map((row, i) => ({ row, i, val: kiteRowValue(row) }))
      .sort((a, b) => b.val - a.val || a.i - b.i);

    ranked.forEach(({ row }, rank) => {
      const v = String(rank);
      if (row.style.order !== v) row.style.order = v;
    });
  }
}

function startKiteSort() {
  if (SITE !== "kite") return;
  if (!kiteObserver) {
    kiteObserver = new MutationObserver(() => {
      clearTimeout(kiteTimer);
      kiteTimer = setTimeout(applyKiteSort, 150);
    });
    kiteObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  applyKiteSort();
}

function stopKiteSort() {
  if (kiteObserver) {
    kiteObserver.disconnect();
    kiteObserver = null;
  }
  clearTimeout(kiteTimer);
  // Undo: clear every order, and remove the flex we forced on each list.
  document.querySelectorAll(KITE_ROW).forEach((r) => (r.style.order = ""));
  kiteContainers().forEach((c) => {
    c.style.removeProperty("display");
    c.style.removeProperty("flex-direction");
  });
}

// Diagnostic: report what the Kite sorter sees, so failures can be pinned down
// without devtools. Read-only.
function debugKiteSort() {
  const containers = kiteContainers();
  return {
    site: SITE,
    sortEnabled,
    rowMatches: document.querySelectorAll(KITE_ROW).length,
    containerCount: containers.length,
    containers: containers.map((c) => {
      const rows = [...c.children].filter((r) => r.matches(KITE_ROW));
      return {
        shown: isShown(c),
        display: getComputedStyle(c).display,
        offsetHeight: c.offsetHeight,
        childCount: c.children.length,
        rowCount: rows.length,
        sample: rows.slice(0, 5).map((r) => {
          const cell = r.querySelector(KITE_PCT);
          return {
            id: rowId(r),
            name: (r.querySelector(".symbol .name")?.textContent || "").trim(),
            pctText: cell ? (cell.textContent || "").replace(/\s+/g, " ").trim() : null,
            parsed: cell ? parsePct(cell.textContent) : null,
          };
        }),
      };
    }),
  };
}

// --- TradingView ---------------------------------------------------------
// Same idea as Kite, adapted to TV's layout: TV positions each watchlist row
// as an absolutely-positioned wrapper at `top: Npx`. We never click TV's sort
// header, we just REASSIGN each row's `top` to its rank slot, so rows glide
// into gainer→loser order (TV animates `top`, so it slides like Kite). TV only
// rewrites `top` when the list is (re)composed, not on price ticks, so our
// positions stick, and we re-apply on a short timer to follow live moves.
let tvInterval = null;
let tvScrolling = false; // true while the user is scrolling the watchlist
let tvScrollTimer = null;
let tvScrollHandler = null;
const tvOriginalTop = new Map(); // data-symbol-full -> its original top (px)

// Only sort watchlists up to this many TOTAL symbols; bigger lists are left
// completely untouched. TradingView VIRTUALIZES the watchlist: it never builds
// a row element for every symbol, only for the screenful in view, and as you
// scroll it RECYCLES those same elements to show whichever symbols are now
// visible (re-positioning each with a `top` pixel value). This sorter works by
// rewriting those `top` values, so on a long list it can only see the
// on-screen slice, and reordering that slice fights TV's own recycler: rows
// tear, overlap, or leave gaps. 50 is the hard cap: at that size the list is
// at most a screenful or so past the fold and sorting stays clean.
const TV_MAX_LIST = 50;

// Each symbol row is an absolutely-positioned wrapper inside the scroller.
function tvRowWrappers() {
  const wraps = new Set();
  document.querySelectorAll("[data-symbol-full]").forEach((s) => {
    let el = s;
    for (let i = 0; i < 12 && el; i++) {
      if (el.style && /absolute/.test(el.style.position || "")) {
        wraps.add(el);
        break;
      }
      el = el.parentElement;
    }
  });
  return [...wraps];
}

// Estimate the TOTAL symbol count of the current watchlist. It's virtualized so
// only ~30 rows are mounted, but the holder (their parent) is sized to the full
// virtual height, so holder height ÷ row height ≈ the real count. This is how
// we tell the curated Watchlist (~30) apart from RS Rank / Indices (hundreds).
function tvTotalRows(wraps) {
  wraps = wraps || tvRowWrappers();
  if (!wraps.length) return 0;
  const holder = wraps[0].parentElement;
  const rowH = wraps[0].offsetHeight || 30;
  if (!holder || rowH < 1) return wraps.length;
  const h = Math.max(holder.scrollHeight || 0, holder.offsetHeight || 0);
  return Math.max(wraps.length, Math.round(h / rowH));
}

function tvSymbolOf(w) {
  const el = w.querySelector("[data-symbol-full]");
  return el ? el.getAttribute("data-symbol-full") : null;
}

// The value a TV row is ranked by, per the active metric. Unknowns sink.
function tvRowValue(w) {
  if (sortMetric === "rvol") {
    const v = rvolMap.get(tvSymbolOf(w));
    return v == null ? -Infinity : v;
  }
  const cell = pctCellOf(w);
  const p = cell ? parsePct(cell.textContent) : null;
  return p == null ? -Infinity : p;
}

// Reposition the watchlist rows into % order by swapping their `top` values
// among the existing row slots. The slot SET never changes (we just permute
// which row occupies which), so the section header/spacer stay put.
function applyTVSort() {
  // While scrolling, TV is recycling/repositioning rows itself, touching
  // `top` then is what causes the glitchy gaps/overlaps. Stay out of its way.
  if (!sortEnabled || SITE !== "tradingview" || tvScrolling) return;
  const wraps = tvRowWrappers();
  if (wraps.length < 2) return;

  // Big lists (RS Rank / Indices) are left untouched: never reorder a list we
  // can only partially see.
  if (tvTotalRows(wraps) > TV_MAX_LIST) {
    clearTVHighlight();
    return;
  }

  const rows = wraps.map((w, i) => {
    const sym = tvSymbolOf(w);
    if (sym && !tvOriginalTop.has(sym)) tvOriginalTop.set(sym, w.style.top);
    return {
      w,
      i, // DOM order, stable tie-break (unaffected by our `top` writes)
      top: parseFloat(w.style.top || "0"),
      val: tvRowValue(w),
    };
  });

  // Compute a CLEAN, evenly-spaced layout from scratch each cycle instead of
  // reusing TV's live `top`s. TV resets a row's `top` whenever its price ticks,
  // which corrupted the reused slot-set into gaps/overlaps. Anchor at the
  // topmost row and step by one row height, so the result is always contiguous.
  const anchor = Math.min(...rows.map((r) => r.top));
  const rowH =
    rows[0].w.offsetHeight ||
    (() => {
      const ts = rows.map((r) => r.top).sort((a, b) => a - b);
      for (let k = 1; k < ts.length; k++) if (ts[k] - ts[k - 1] > 0) return ts[k] - ts[k - 1];
      return 30;
    })();
  if (!(rowH > 0)) return;

  const ranked = [...rows].sort(
    (a, b) => b.val - a.val || a.i - b.i // value desc; ties keep order; nulls last
  );

  ranked.forEach((r, rank) => {
    const t = anchor + rank * rowH + "px";
    if (r.w.style.top !== t) r.w.style.top = t;
  });

  // Volume-led row highlight. Guarded so a failure here can NEVER break the sort.
  try {
    if (sortMetric === "rvol") applyTVHighlight(wraps);
    else clearTVHighlight();
  } catch (e) {
    wlog("highlight failed (sort unaffected)", e);
  }
}

// --- Volume-led color coding (TV) ----------------------------------------
// Same idea as the Pine "Strong Start" table: color only the names that
// actually have heavy volume. Just the top HALF of the list BY RVOL (GATE_FRAC
// below) gets a colored left-bar, it's a rank, not a fixed cutoff, so it
// re-calibrates through the day and picks up names whose RVOL climbs later.
// Those eligible rows are then colored by the move:
//   green = up · amber = flat (volume but no real move) · red = down.
// The bar fades down the rank, so the heaviest-volume names show brightest and
// the borderline ones show faint. The bottom half (lighter volume) stays plain.
const HL = { green: "38,208,124", amber: "240,180,41", red: "255,93,108" };
const HL_MOVE = 1.5; // |Chg%| below this = "flat" (amber)
const GATE_FRAC = 0.5; // top half by RVOL gets colored, matches the Pine script
let tvHighlighted = new Set();

// Paint a thin colored left-bar (or with rgb=null, wipe it). box-shadow never
// affects layout, so this is fully reversible and can't shift the row. We mark
// the inner [data-symbol-full] row element with !important so TV's own row
// styles don't win.
function paintRow(w, rgb, alpha) {
  const els = [w];
  const inner = w.querySelector && w.querySelector("[data-symbol-full]");
  if (inner && inner !== w) els.push(inner);
  for (const el of els) {
    if (!el || !el.style) continue;
    if (rgb) el.style.setProperty("box-shadow", `inset 3px 0 0 0 rgba(${rgb},${alpha})`, "important");
    else el.style.removeProperty("box-shadow");
  }
}

function clearTVHighlight() {
  tvHighlighted.forEach((w) => paintRow(w, null));
  tvHighlighted.clear();
  tvRowWrappers().forEach((w) => paintRow(w, null)); // wipe any recycled node too
}

function applyTVHighlight(wraps) {
  wraps = wraps || tvRowWrappers();
  const ranked = [];
  for (const w of wraps) {
    const rv = rvolMap.get(tvSymbolOf(w));
    if (rv != null && isFinite(rv)) ranked.push({ w, rv });
  }
  if (ranked.length < 3) {
    clearTVHighlight();
    return;
  }
  ranked.sort((a, b) => b.rv - a.rv);
  const hiCount = Math.max(1, Math.round(ranked.length * GATE_FRAC));

  const next = new Set();
  ranked.forEach((row, i) => {
    let rgb = null,
      alpha = 0;
    if (i < hiCount) {
      const cell = pctCellOf(row.w);
      const cg = cell ? parsePct(cell.textContent) : null;
      if (cg != null) {
        rgb = cg >= HL_MOVE ? HL.green : cg <= -HL_MOVE ? HL.red : HL.amber;
        alpha = 1 - 0.55 * (i / Math.max(1, hiCount - 1)); // brightest at top of rank
      }
    }
    paintRow(row.w, rgb, alpha);
    if (rgb) next.add(row.w);
  });
  // wipe anything that didn't qualify (incl. rows with no RVOL value)
  for (const w of wraps) if (!next.has(w)) paintRow(w, null);
  tvHighlighted = next;
}

// Re-apply ~3x/sec: cheap (a no-op write-wise once ordered) and makes rank
// changes follow live prices smoothly. No header clicks, so nothing to run away.
// We pause entirely while the user scrolls and re-sort once they stop.
function startTVSort() {
  if (SITE !== "tradingview") return;
  stopTVSort();
  tvScrollHandler = () => {
    tvScrolling = true;
    clearTimeout(tvScrollTimer);
    tvScrollTimer = setTimeout(() => {
      tvScrolling = false;
      applyTVSort();
    }, 250); // settle after the last scroll, then re-sort
  };
  // Capture phase catches scrolling inside the watchlist's own scroller.
  document.addEventListener("scroll", tvScrollHandler, true);
  document.addEventListener("wheel", tvScrollHandler, { capture: true, passive: true });
  applyTVSort();
  tvInterval = setInterval(applyTVSort, 300);
}

function stopTVSort() {
  clearInterval(tvInterval);
  tvInterval = null;
  clearTimeout(tvScrollTimer);
  tvScrolling = false;
  if (tvScrollHandler) {
    document.removeEventListener("scroll", tvScrollHandler, true);
    document.removeEventListener("wheel", tvScrollHandler, { capture: true });
    tvScrollHandler = null;
  }
  clearTVHighlight();
  // Restore each row to where TV originally had it (your manual order).
  tvRowWrappers().forEach((w) => {
    const sym = tvSymbolOf(w);
    if (sym && tvOriginalTop.has(sym)) w.style.top = tvOriginalTop.get(sym);
  });
  tvOriginalTop.clear();
}

// --- RVOL badge on each row (TradingView) ---------------------------------
// TV has no RVOL watchlist column, so we paint one: a small badge pinned just
// right of each symbol's NAME showing its RVOL as a % (TV convention, 100% =
// an average full day's volume already traded). Virtualization is a non-issue
// because badges only need to exist for mounted rows; a 1s repaint follows
// TV's row recycling as you scroll. The badge toggle works on its OWN: it
// quietly runs the same RVOL polling the sorter uses, so it doesn't need any
// sort to be on. Green = above an average day, grey = below. Purely cosmetic,
// removed cleanly on toggle-off.
let badgeTimer = null;
const BADGE_CLASS = "rvt-rvol-badge";

// Where the badge should start (px, viewport coords): the right edge of the
// symbol NAME, extended past anything TV parks immediately after it (the
// off-market status dot, a flag). Two failed approaches, kept for the record:
// anchoring on the name text alone overlapped the dot; taking the rightmost
// leaf in the row's "left half" caught long PRICES whose left edge crosses the
// midpoint, throwing badges into the Last/Chg columns. So: find the name leaf,
// then keep extending the edge over any leaf that STARTS within 22px of it.
// That swallows the dot (a real element sitting a few px after the name) but
// can never reach the price columns, which start much further right.
function tvBadgeAnchor(cell, wr) {
  const tick = (cell.getAttribute("data-symbol-full") || "").split(":").pop();
  if (!tick) return -Infinity;
  let name = null;
  for (const el of cell.querySelectorAll("*")) {
    if (!el.children.length && (el.textContent || "").trim() === tick) {
      name = el;
      break;
    }
  }
  if (!name) return -Infinity;
  let edge = name.getBoundingClientRect().right;
  const leaves = [];
  for (const el of cell.querySelectorAll("*")) {
    if (el.children.length) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.bottom < wr.top || r.top > wr.bottom) continue;
    leaves.push(r);
  }
  for (let pass = 0; pass < 3; pass++) {
    let grew = false;
    for (const r of leaves) {
      if (r.left >= edge - 2 && r.left <= edge + 22 && r.right > edge) {
        edge = r.right;
        grew = true;
      }
    }
    if (!grew) break;
  }
  return edge;
}

// Effective background luminance behind a row: walk up from the element to
// the first non-transparent background color. Used to keep the badge readable
// on BOTH TradingView themes (the dark-theme palette disappears on white).
function tvBgLuma(el) {
  let node = el;
  for (let i = 0; i < 10 && node; i++) {
    const c = getComputedStyle(node).backgroundColor || "";
    const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s]+([\d.]+))?\s*\)/);
    if (m && (m[4] === undefined || parseFloat(m[4]) > 0.5)) {
      return 0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3];
    }
    node = node.parentElement;
  }
  return 0; // nothing found, assume dark
}

function paintRVOLBadges() {
  if (SITE !== "tradingview") return;
  const show = badgesOn && rvolMap.size > 0;
  const wraps = tvRowWrappers();
  // One theme check per paint cycle (rows all share a background).
  const light = wraps.length ? tvBgLuma(wraps[0]) > 140 : false;
  for (const w of wraps) {
    let b = w.querySelector(":scope > ." + BADGE_CLASS);
    const v = rvolMap.get(tvSymbolOf(w));
    const cell = show && v != null ? w.querySelector("[data-symbol-full]") : null;
    if (!cell) {
      if (b) b.remove();
      continue;
    }
    const wr = w.getBoundingClientRect();
    const edge = tvBadgeAnchor(cell, wr);
    if (!isFinite(edge) || !wr.width) {
      if (b) b.remove();
      continue;
    }
    if (!b) {
      // A child of the row WRAPPER, absolutely positioned. Never inserted
      // into TV's own row markup: React owns those nodes, and a foreign
      // child there can crash TV's renderer when the row recycles.
      b = document.createElement("span");
      b.className = BADGE_CLASS;
      b.style.cssText =
        "position:absolute;z-index:4;pointer-events:none;" +
        "top:50%;transform:translateY(-50%);" +
        "font:600 10px/1.5 -apple-system,'Segoe UI',sans-serif;" +
        "padding:0 4px;border-radius:4px;letter-spacing:0;";
      w.appendChild(b);
    }
    const left = Math.round(edge - wr.left) + 7 + "px";
    if (b.style.left !== left) b.style.left = left;
    const txt = Math.round(v * 100) + "%";
    if (b.textContent !== txt) b.textContent = txt;
    // ONE neutral color, deliberately signal-free. Direction schemes and a
    // gold-at-100% tier were both tried and scrapped: the row already shows
    // direction (TV's price colors + the sorter's left bar), and a fixed
    // 100% threshold mostly trips late in the session when the move is
    // already made, so any color "signal" here just misleads. The badge is
    // pure information; the number speaks, the reader decides. Steel blue,
    // flipped per theme: pale on dark rows, deep on light rows.
    b.style.background = light ? "rgba(70,100,150,.12)" : "rgba(125,155,195,.16)";
    b.style.color = light ? "#3f608f" : "#a5bcd9";
  }
}

function clearRVOLBadges() {
  document.querySelectorAll("." + BADGE_CLASS).forEach((e) => e.remove());
}

function startRVOLBadges() {
  if (SITE !== "tradingview" || badgeTimer) return;
  paintRVOLBadges();
  badgeTimer = setInterval(paintRVOLBadges, 1000);
}

function stopRVOLBadges() {
  clearInterval(badgeTimer);
  badgeTimer = null;
  clearRVOLBadges();
}

// One-click state dump for the popup's Debug button: everything needed to see
// why the sorter is (or isn't) doing anything, without opening devtools.
function debugSorter() {
  const wraps = SITE === "tradingview" ? tvRowWrappers() : [];
  return {
    site: SITE,
    version: chrome.runtime.getManifest().version,
    toggles: { pct: pctOn, rvol: rvolOn, badges: badgesOn },
    sortRunning: sortEnabled,
    metric: sortMetric,
    listSizeCap: SITE === "tradingview" ? TV_MAX_LIST : "none (Kite mounts every row)",
    totalRowsInList: SITE === "tradingview" ? tvTotalRows(wraps) : document.querySelectorAll(KITE_ROW).length,
    mountedRows: SITE === "tradingview" ? wraps.length : document.querySelectorAll(KITE_ROW).length,
    rvolValuesKnown: rvolMap.size,
    kite: SITE === "kite" ? {
      activeListNo: kiteActiveListNo(),
      skipLists: [...kiteSkipLists],
      derivListsDetected: kiteContainers().filter(kiteDerivHeavy).length,
    } : undefined,
  };
}

// --- shared on/off -------------------------------------------------------
function startSort() {
  if (SITE === "kite") startKiteSort();
  else if (SITE === "tradingview") startTVSort();
}
function stopSort() {
  if (SITE === "kite") stopKiteSort();
  else if (SITE === "tradingview") stopTVSort();
}

// Each site has an independent sort setting, DEFAULT OFF, so the extension
// never auto-sorts a watchlist unless you turn it on. Two metrics per site:
// % change and RVOL. If both keys are somehow on, RVOL wins (you can't order
// rows two ways at once); the popup writes them as one Off / % / RVOL choice.
const PCT_KEY =
  SITE === "kite" ? "sortKite" : SITE === "tradingview" ? "sortTV" : null;
const RVOL_KEY =
  SITE === "kite" ? "rvolKite" : SITE === "tradingview" ? "rvolTV" : null;
// Per-row RVOL badges, opt-in, TradingView-only (Kite has no room for them).
const BADGE_KEY = SITE === "tradingview" ? "rvolBadges" : null;

let pctOn = false;
let rvolOn = false;
let badgesOn = false;

function recompute() {
  const mode = rvolOn ? "rvol" : pctOn ? "pct" : "off";
  // Tear down whatever's running, then start fresh for the new mode.
  stopSort();
  stopRVOLPolling();
  stopRVOLBadges();
  sortEnabled = false;
  const badges = badgesOn && SITE === "tradingview";
  if (mode === "off" && !badges) return;
  sortMetric = mode === "off" ? "rvol" : mode;
  sortEnabled = mode !== "off";
  // RVOL data feeds the RVOL sort AND the badges; either one starts the poll.
  if (rvolOn || badges) startRVOLPolling();
  if (sortEnabled) startSort();
  if (badges) startRVOLBadges();
}

if (PCT_KEY && RVOL_KEY) {
  const defaults = { [PCT_KEY]: false, [RVOL_KEY]: false, kiteSkipLists: "" };
  if (BADGE_KEY) defaults[BADGE_KEY] = false;
  chrome.storage.local.get(defaults).then((s) => {
    pctOn = s[PCT_KEY] === true;
    rvolOn = s[RVOL_KEY] === true;
    if (SITE === "kite") kiteSkipLists = parseSkipLists(s.kiteSkipLists);
    badgesOn = BADGE_KEY ? s[BADGE_KEY] === true : false;
    recompute();
  });
  chrome.storage.onChanged.addListener((c) => {
    let touched = false;
    if (PCT_KEY in c) {
      pctOn = c[PCT_KEY].newValue === true;
      touched = true;
    }
    if (RVOL_KEY in c) {
      rvolOn = c[RVOL_KEY].newValue === true;
      touched = true;
    }
    if (BADGE_KEY && BADGE_KEY in c) {
      badgesOn = c[BADGE_KEY].newValue === true;
      touched = true;
    }
    if (SITE === "kite" && "kiteSkipLists" in c) {
      kiteSkipLists = parseSkipLists(c.kiteSkipLists.newValue);
      touched = true; // recompute clears a newly excluded list right away
    }
    if (touched) recompute();
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const fn = WL_COMMANDS[msg?.cmd];
  if (!fn) return false; // not ours, let the site-specific script handle it
  try {
    sendResponse({ ok: true, data: fn(msg.payload || {}) });
  } catch (e) {
    sendResponse({ ok: false, error: String(e.message || e) });
  }
  return true;
});

wlog(`ready on ${SITE} (v${chrome.runtime.getManifest().version})`);
