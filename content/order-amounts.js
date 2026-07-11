// RVOL Tools — quick-amount buttons inside Kite's order window.
//
// When an order window is open (new order, or the Orders-page Modify
// window), a row of ₹ buttons appears under the quantity field; clicking
// one sets Qty = floor(amount ÷ price), so a trade is sized in one click.
// Price = the price input for Limit/SL orders, else the live LTP of the
// selected exchange from the window header.
//
// Amounts are editable in the popup (`orderAmounts`); the whole feature
// toggles with `orderAmountsOn` (default ON). The injected bar reuses the
// `.kt-amounts` class on purpose: the private Kite Tools extension injects
// the same bar under the same class, and each copy's dedupe guard sees the
// other's, so with both extensions installed exactly one bar appears.
// Self-contained IIFE.

(() => {
  "use strict";
  if (window.top !== window) return;
  if (location.hostname !== "kite.zerodha.com") return;

  const ORDER_SEL = {
    qty: ["input#order-quantity", 'input[name="quantity"]', ".quantity input", "input.quantity"],
    price: ["input#order-price", 'input[name="price"]', ".price input", "input.price"],
  };

  const q1 = (sels, root = document) => {
    for (const s of sels) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  };

  let featureOn = true;
  let AMOUNTS = [50000, 100000, 150000, 200000];
  chrome.storage?.local.get({ orderAmountsOn: true, orderAmounts: AMOUNTS }).then((s) => {
    featureOn = s.orderAmountsOn !== false;
    if (Array.isArray(s.orderAmounts) && s.orderAmounts.length) AMOUNTS = s.orderAmounts;
  });
  chrome.storage?.onChanged.addListener((c) => {
    if ("orderAmountsOn" in c) {
      featureOn = c.orderAmountsOn.newValue !== false;
      if (!featureOn) document.querySelectorAll(".kt-amounts").forEach((e) => e.remove());
    }
    if (c.orderAmounts?.newValue) {
      AMOUNTS = c.orderAmounts.newValue;
      document.querySelectorAll(".kt-amounts").forEach((e) => e.remove());
    }
  });

  function setNativeValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fmtAmount(a) {
    if (a >= 100000) return "₹" + +(a / 100000).toFixed(2) + "L";
    if (a >= 1000) return "₹" + +(a / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return "₹" + a;
  }

  // Find the open order window by locating a Qty input whose ancestor also
  // holds a Buy/Sell/Modify button — robust against class-name changes.
  function findOrderWindow() {
    const qtyInput = q1(ORDER_SEL.qty);
    if (!qtyInput) return null;
    let el = qtyInput;
    for (let i = 0; i < 8 && el; i++) {
      if (el.querySelector && /buy|sell|modify/i.test(el.textContent || "") && el.querySelector("button"))
        return { win: el, qtyInput };
      el = el.parentElement;
    }
    return { win: qtyInput.parentElement, qtyInput };
  }

  function parsePrice(text) {
    const m = (text || "").match(/(\d{1,3}(?:,\d{3})*\.\d+|\d+\.\d+)/);
    return m ? parseFloat(m[1].replace(/,/g, "")) : 0;
  }

  // Live LTP of the SELECTED exchange, read next to the checked exchange
  // radio (never from a node spanning both exchanges, which would mix up
  // BSE vs NSE prices). Single-exchange stocks have no radios; their price
  // sits in .exchange-selector .last-price.
  function getLTP() {
    const ex = document.querySelector('input[name="exchange"]:checked');
    if (ex) {
      const wrap = ex.closest(".su-radio-wrap") || ex.parentElement;
      const priceFrom = (node) => {
        if (!node || !node.querySelectorAll) return 0;
        if (node.querySelectorAll('input[name="exchange"]').length > 1) return 0;
        return parsePrice(node.textContent);
      };
      const v =
        priceFrom(wrap) ||
        priceFrom(wrap?.nextElementSibling) ||
        priceFrom(wrap?.previousElementSibling) ||
        priceFrom(wrap?.parentElement);
      if (v) return v;
    }
    const lp = document.querySelector(".exchange-selector .last-price");
    if (lp) return parsePrice(lp.textContent);
    return 0;
  }

  function getOrderPrice(win) {
    const pInput = q1(ORDER_SEL.price, win);
    if (pInput) {
      const v = parseFloat(String(pInput.value || "").replace(/,/g, ""));
      if (v > 0) return v;
    }
    return getLTP();
  }

  function injectAmountButtons() {
    if (!featureOn) return;
    const found = findOrderWindow();
    if (!found) return;
    const { win, qtyInput } = found;

    // Work out the exact insertion point up front, and guard THERE (a guard
    // on `win` alone misses the Modify window's tiny fallback win).
    const anchor = qtyInput.closest(".field, .su-field, .input-field") || qtyInput.parentElement;
    const parent = anchor.parentElement || anchor;
    if (parent.querySelector(":scope > .kt-amounts")) return;
    if (win.querySelector(".kt-amounts")) return;

    const bar = document.createElement("div");
    bar.className = "kt-amounts";
    bar.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 2px;";
    for (const amt of AMOUNTS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = fmtAmount(amt);
      b.title = `Set quantity for ${fmtAmount(amt)}`;
      // transparent base so the buttons sit right on Kite's light AND dark
      b.style.cssText =
        "padding:3px 9px;font-size:12px;font-weight:600;cursor:pointer;" +
        "border:1px solid #ff5722;color:#ff5722;background:transparent;border-radius:5px;";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const price = getOrderPrice(win);
        if (!price) {
          b.textContent = "no price";
          setTimeout(() => (b.textContent = fmtAmount(amt)), 900);
          return;
        }
        const qty = Math.max(1, Math.floor(amt / price));
        setNativeValue(qtyInput, String(qty));
        b.style.background = "#ff5722";
        b.style.color = "#fff";
        setTimeout(() => {
          b.style.background = "transparent";
          b.style.color = "#ff5722";
        }, 250);
      });
      bar.appendChild(b);
    }
    if (anchor.parentElement) parent.insertBefore(bar, anchor.nextSibling);
    else anchor.appendChild(bar);
  }

  let orderTimer = null;
  new MutationObserver(() => {
    clearTimeout(orderTimer);
    orderTimer = setTimeout(injectAmountButtons, 120);
  }).observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
