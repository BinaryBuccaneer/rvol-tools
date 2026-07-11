# RVOL Tools

A browser extension that puts live relative volume (RVOL) on the screens most
Indian retail traders actually use: TradingView and Zerodha Kite. Plus a set
of quality-of-life upgrades that make Kite's web app chart like TradingView.

RVOL here means today's volume so far divided by the stock's average daily
volume over the last 20 sessions, shown as a percentage.

- 100% = the stock has already traded a full average day
- 500% = five times an average day
- What you're really after is a normally quiet stock whose volume starts
  building early, before the move is obvious. That's the whole point of
  watching RVOL. By the time a name is printing several times its average,
  the move has usually already happened.

There are no accounts to make and nothing gets sent anywhere. Quotes come from
TradingView's public scanner and Yahoo Finance, read straight from the browser,
and your settings stay in the browser too.

## What's inside

**1. Watchlist sorter**

Keeps the watchlist you're viewing sorted live, by RVOL or by % change, on
TradingView and on Kite. The heaviest names float to the top and keep floating
as the session moves.

- Never edits the list itself, only reorders the rows on screen
- Puts everything back the moment it's switched off
- Overrides any column-header sort while running
- Kite lists you want left in manual order (an options/futures list, say)
  can be excluded by their footer number in the popup

**2. RVOL badge (TradingView)**

A small tag next to each symbol showing its RVOL. One neutral color, no
signals. The row already shows direction (the price columns, and the sorter's
colored left bar), and RVOL builds up through the session anyway, so a badge
that changes color at some threshold would mostly light up late in the day,
after the move is made. The badge just states the number; what to do with it
is your call.

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

**5. Kite extras**

Quality-of-life upgrades for Zerodha Kite's web app, each with its own toggle:

- **Chart scrolling:** on Kite's chart page, the down/up arrow keys open the
  next/previous watchlist stock's chart, TradingView-style, wrapping at both
  ends, with a gold marker on the charted row. Clicking a stock's row opens
  its chart from any Kite page. Works with both of Kite's chart engines
  (TradingView and ChartIQ).
- **Watchlist on the right:** mirrors Kite's columns so the marketwatch sits
  on the right and the chart on the left, the way TradingView lays it out.
- **TradingView colors:** reskins Kite with TradingView's palette (TV's
  vivid green/red, TV blue, TV surfaces). Follows Kite's own light/dark
  setting. Candle colors come from Kite's chart settings, not this.
- **Full width:** stretches Kite's centered fixed-width layout across the
  whole window, with a width cap so an ultrawide doesn't push the watchlist
  to the far edge.
- **₹ buttons in the order window:** preset amount buttons under the
  quantity field; one click sets Qty = amount ÷ price. Amounts are editable.

None of these touch your orders, funds or data. They only restyle the page and
click what you could click yourself. The one network call they add is to
Zerodha's public instruments list (api.kite.trade, no login), used to build
chart URLs.

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
