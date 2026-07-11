RVOL Tools
==========

Live-market tools and Zerodha Kite upgrades in one browser extension:

1. WATCHLIST SORTER keeps your TradingView and Zerodha Kite watchlist sorted
   live by RVOL or by % change, so the names moving the hardest right now float
   to the top. It doesn't touch your watchlist contents; it only re-orders the
   rows while a sort is on, and puts them straight back when you turn it off.
   Plus an optional RVOL badge next to each symbol name on TradingView.

2. TOP RVOL BOARD is a floating panel that ranks a list of symbols by RVOL, with
   a Strong-Start style heatmap (heavy-volume rows light up green when up, red
   when down, amber when flat). No watchlist-size limit. Click a row to switch
   the chart in your open TradingView tab; then Up/Down arrows step through the
   list (Esc stops).

3. MARKET PULSE is a small floating chip that reads the live breadth of a list
   you load (advancers vs decliners, plus the count of names moving 4.5%+ each
   way) into a one-glance posture: RISK-ON, SELECTIVE, WAIT & WATCH, WEAK or
   RISK-OFF. Click it to expand the numbers behind the read.

4. KITE EXTRAS make Zerodha Kite's web app chart like TradingView, each with
   its own toggle: arrow-key CHART SCROLLING (down/up opens the next/previous
   watchlist stock's chart, wrapping around; clicking a stock's row opens its
   chart from any Kite page), WATCHLIST ON THE RIGHT (mirrors the columns,
   chart on the left), TRADINGVIEW COLORS (TV's palette on Kite, follows
   Kite's light/dark setting), FULL WIDTH (uses the whole window, with a cap
   for ultrawides), and RUPEE BUTTONS in the order window (one click sets
   Qty = amount ÷ price; amounts editable). None of these touch your orders
   or data; they restyle the page and click what you could click yourself.

RVOL = today's volume so far ÷ the average daily volume over the last 20 days,
shown as a % (100% = a full average day already traded; 500% = five times).

Works on Chrome, Edge, or Brave, on Windows and Mac (same steps).


Install
-------
1. Unzip this folder somewhere you'll keep it (don't delete it later, the
   browser loads it from here).
2. Open your browser's extensions page:
     Chrome / Brave:  chrome://extensions
     Edge:            edge://extensions
3. Turn on "Developer mode" (top-right toggle in Chrome/Brave, left sidebar in
   Edge).
4. Click "Load unpacked" and select this folder (the one with manifest.json).


The watchlist sorter
--------------------
- In the popup, pick a sort for each site: Off, % Chg (biggest gainer on top)
  or RVOL (heaviest volume on top). TradingView and Zerodha Kite are set
  independently.
- It doesn't touch your watchlist contents; it only re-orders the rows on
  screen while the sort is on, and puts them straight back when you turn it
  off. It also overrides any column-header sort while running.
- Size limit: lists up to 50 symbols. On TradingView, longer lists are left
  untouched on purpose: TV only draws the rows currently on screen and recycles
  them as you scroll, so sorting a long list would fight TV's own redraw and
  tear the layout. Keep the list you sort at 50 or fewer.
- RVOL BADGE (TradingView only): an optional tiny badge next to each symbol's
  name showing its RVOL as a %. One neutral color, no signals: the row already
  shows direction through the price columns and the sorter's left bar, and
  RVOL builds through the session, so threshold colors would mostly fire late
  in the day. The badge just states the number. Works on its own, no sort
  needs to be on.
- Give it a few seconds after the page loads to fetch volume the first time.
- "Sorter state" in the popup prints what the sorter sees on the current tab
  (handy if it seems to be doing nothing, e.g. the list is over the 50 cap).


The Top RVOL board
------------------
- Screen-agnostic: the board can appear on ANY site. In the popup, "Show on
  <this site>" turns it on for whatever tab you're currently looking at. Use it
  on your broker, on a spare tab on a second monitor, or click the pop-out (⧉)
  to float it as an always-on-top window over anything at all. It's off
  everywhere until you switch it on.
- Give it a list: in the popup, either
    • paste symbols (e.g.  NSE:SUZLON, NSE:HFCL, NSE:IDEA), or
    • paste a TradingView watchlist LINK (a shared/public watchlist URL).
  Paste and click Load. A link keeps itself fresh; the board re-reads it every
  few minutes, so edits you make on TradingView flow through without re-pasting.
- "Show top" sets how many names the board shows; "Theme" is Auto / Dark / Light
  (Auto follows the page's background).
- Drag it by the header, resize from the bottom-right grip, click the header to
  collapse. "COPY 50" copies the top 50 by RVOL as a TradingView import string.
- Note: symbols are treated as NSE (India). Click-a-row to switch the chart only
  does something when you have a TradingView tab open.


The Market Pulse chip
---------------------
- Screen-agnostic, same as the board: "Show on <this site>" turns it on for
  whatever tab you're looking at. Off everywhere until you switch it on. It
  auto-matches light or dark page backgrounds.
- Give it a list the same way (paste symbols OR a TradingView watchlist LINK,
  then Load). A broad list (e.g. a Nifty 500 watchlist) reads the market truer
  than an RS-leaders list, which always leans green.
- The chip shows the posture word, a colored gauge, and a quick "62% up ▲18 ▼11"
  glance. Click it to expand: advancing / declining counts, up and down ≥4.5%,
  the 4.5% thrust ratio, average move, and whether breadth is improving or
  rolling over vs ~20 minutes ago.
- It is thrust-aware: a thin-breadth day with a cluster of names up 4.5%+ reads
  SELECTIVE (a stock-picker's day), not risk-off.
- Drag it by anywhere on the chip; click to expand or collapse; the X closes it
  (turns it off for this site).


Notes
-----
- Numbers follow live prices during market hours (refresh every few seconds).
- Off-market it uses the last session's numbers, so things won't move much.
- The first time a symbol is seen each day it fetches its average volume once,
  then caches it for the rest of the day.
