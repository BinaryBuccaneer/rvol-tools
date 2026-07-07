# RVOL Tools

A browser extension that puts live relative volume (RVOL) on the screens most
Indian retail traders actually use: TradingView and Zerodha Kite.

RVOL here means today's volume so far divided by the stock's average daily
volume over the last 20 sessions, shown as a percentage.

- 100% = the stock has already traded a full average day
- 500% = five times an average day
- A sleepy stock printing 300% by noon is exactly the kind of thing this
  extension is built to surface

No accounts, no backend, no tracking. Quotes come from TradingView's public
scanner and Yahoo Finance, straight from the browser. Settings stay in the
browser too.

## What's inside

**1. Watchlist sorter**

Keeps the watchlist you're viewing sorted live, by RVOL or by % change, on
TradingView and on Kite. The heaviest names float to the top and keep floating
as the session moves.

- Never edits the list itself, only reorders the rows on screen
- Puts everything back the moment it's switched off
- Overrides any column-header sort while running

**2. RVOL badge (TradingView)**

A small tag next to each symbol showing its RVOL. The color is the direction,
the brightness is the volume:

- Green for a stock that's up, red for one that's down (moves of 1.5% or more)
- The heavier the volume, the brighter the badge: 150%+ RVOL is bright,
  around a full average day is normal, 50 to 100% is dimmed but still colored
- Amber: at least a full average day's volume but the price is going nowhere
  (churn, often worth a look on its own)
- Grey: under half an average day's volume, too quiet to mean much

So a stock down 5% on 80% volume shows a dim red badge instead of a blank grey
one, while a 300% RVOL runner glows.

Works on its own, no sort needs to be on.

**3. Top RVOL board**

A floating panel that ranks any list of symbols by RVOL. No size limit, works
on any website.

- Click a row to switch the chart in an open TradingView tab
- Pop-out button turns it into a small always-on-top window, useful on a
  second monitor

**4. Market Pulse**

A small chip that reads the breadth of a list (advancers vs decliners, plus
how many names are moving 4.5% or more each way) and boils it down to one
word: risk-on, selective, wait and watch, weak, or risk-off. Click it to see
the numbers behind the word.

## Install

Works on Chrome, Edge and Brave, on Windows and Mac.

1. Download this repo (green Code button, Download ZIP) and unzip it somewhere
   permanent. The browser loads the extension from this folder, so don't
   delete it later.
2. Open the browser's extensions page: `chrome://extensions` in Chrome and
   Brave, `edge://extensions` in Edge.
3. Turn on Developer mode.
4. Click "Load unpacked" and pick the unzipped folder (the one containing
   `manifest.json`).

Everything is off by default. Open the extension popup to turn things on.

To update later: download the ZIP again, replace the folder, hit the reload
arrow on the extension card, and refresh any open TradingView/Kite tabs.

## The one thing to understand about the TradingView sorter

This part is unintuitive, so here it is properly.

TradingView doesn't actually draw the whole watchlist. It only draws the rows
that fit on screen plus a few extra, and as you scroll, it reuses those same
rows to display whatever just came into view. A row that's scrolled out of
view doesn't exist at all. The sorter works by moving rows, and it can't move
a row that isn't there.

The practical rules:

- The sorter sorts what's on screen.
- If the watchlist is longer than the screen, zoom the page out (Cmd and minus
  on Mac, Ctrl and minus on Windows) until the list fits. Two zoom steps
  comfortably fit 30 or more rows, and at that point the whole list sorts
  cleanly, live.
- There's a hard ceiling at 50 symbols. Past that, the extension deliberately
  leaves the list alone, because sorting a list it can only partly see makes
  rows tear and overlap. Keep sorted lists at 50 names or fewer.
- For a bigger universe, use the Top RVOL board instead. It has no size limit
  because it doesn't touch the watchlist at all.

Zerodha Kite has none of these problems. Kite draws every row of every list,
so the sorter handles any size there, flawlessly.

## Notes

- During market hours the numbers refresh every few seconds. Off market they
  show the last session, so nothing will move much.
- The first time a symbol is seen each day, its 20 day average volume is
  fetched once and cached for the rest of the day.
- Symbols are treated as NSE (India). The Top RVOL board and Market Pulse take
  either pasted symbols or a public TradingView watchlist link.
- If a sorter seems dead after reloading the extension, refresh the
  TradingView or Kite tab too. The browser cuts the old script's connection on
  every extension reload.

MIT licensed. Use it, fork it, break it, improve it.
