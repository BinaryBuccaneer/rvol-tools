// RVOL Tools, TradingView symbol switcher.
// Receives {cmd:"setChartSymbol", symbol} from the service worker (fired by a
// click / arrow-key on the Top-RVOL leaderboard) and switches the open chart by
// using TradingView's "just start typing to open symbol search" behaviour:
// open search → type NSE:SYMBOL → Enter. No reload, no fragile layout API.
//
// IIFE + private names → no collision with the other content scripts.
(() => {
  const TAG = "[RVOLTools/TVsym]";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeout = 1400, step = 60) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  // React-friendly value set, TV's search box is a controlled input, so a plain
  // `.value =` won't register; use the native setter + an input event.
  function setNativeValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function key(el, type, k) {
    el.dispatchEvent(new KeyboardEvent(type, {
      key: k, code: k.length === 1 ? "Key" + k.toUpperCase() : k,
      keyCode: k === "Enter" ? 13 : k.toUpperCase().charCodeAt(0),
      which: k === "Enter" ? 13 : k.toUpperCase().charCodeAt(0),
      bubbles: true, cancelable: true,
    }));
  }

  const isTextInput = (el) =>
    el && el.tagName === "INPUT" && ["text", "search", "", null].includes(el.getAttribute("type"));

  // The MAIN chart symbol button in the header (shows the current symbol).
  // Clicking it opens the real symbol-search dialog, NOT the "+" Compare button.
  function findSymbolButton() {
    return (
      document.querySelector("#header-toolbar-symbol-search") ||
      document.querySelector('[data-name="symbol-search-button"]') ||
      document.querySelector('button[aria-label*="Symbol Search" i]') ||
      document.querySelector('[id*="symbol-search"]')
    );
  }

  // The search dialog's input: prefer whatever TV auto-focused on open, else the
  // documented main-search input. (Narrow so we don't grab the Compare box.)
  function findSearchInput() {
    const a = document.activeElement;
    if (isTextInput(a)) return a;
    return document.querySelector('input[data-role="search"]');
  }

  async function setChartSymbol(raw) {
    const sym = "NSE:" + String(raw).replace(/^NSE:/i, "").trim();
    // 1) Open the MAIN symbol search by clicking the header symbol button.
    const btn = findSymbolButton();
    if (!btn) {
      console.warn(TAG, "header symbol button not found, needs a live selector tweak");
      return { ok: false, reason: "no-button" };
    }
    btn.click();

    // 2) Find the search input (auto-focused on open).
    const input = await waitFor(findSearchInput, 1600);
    if (!input) {
      console.warn(TAG, "symbol-search input not found, needs a live selector tweak");
      return { ok: false, reason: "no-input" };
    }

    // 3) Type the full symbol, let results populate, commit with Enter.
    input.focus();
    setNativeValue(input, sym);
    await sleep(350);
    key(input, "keydown", "Enter");
    key(input, "keyup", "Enter");
    console.log(TAG, "switched to", sym);
    return { ok: true, symbol: sym };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.cmd !== "setChartSymbol") return false;
    setChartSymbol(msg.symbol)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: String(e && e.message || e) }));
    return true; // async response
  });

  console.log(TAG, "ready");
})();
