// Sruthi Arts — renders the shop and page text from data/shop.json and runs PayPal checkout.
// shop.json is built from content/ by scripts/build-data.mjs; edit content through /admin, not this file.
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const SVGNS = "http://www.w3.org/2000/svg";
  const MULTI_ICON = () => {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    for (const [x, y] of [[8, 3], [3, 8]]) {
      const r = document.createElementNS(SVGNS, "rect");
      Object.entries({ x, y, width: 13, height: 13, rx: 2.5 }).forEach(([k, v]) => r.setAttribute(k, v));
      svg.append(r);
    }
    return svg;
  };
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    children.flat().forEach((c) => c !== null && c !== undefined && c !== false && node.append(c));
    return node;
  };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isPhone = () => matchMedia("(max-width: 700px)").matches;

  // Shop categories, in menu order. The "id" is what each item's "category" stores.
  const CATEGORIES = [
    { id: "all", label: "All" },
    { id: "ludo-boards", label: "Ludo boards" },
    { id: "clocks", label: "Clocks" },
    { id: "originals", label: "Originals" },
    { id: "prints", label: "Prints" },
  ];
  const state = { paintings: [], artist: {}, pages: null, filter: "all", current: -1, photo: 0, qty: 1 };
  let money = (n) => `$${n}`;

  const spec = (p) => `${p.medium} · ${p.width} × ${p.height} cm`;
  const stockOf = (p) => (p.status === "sold" ? 0 : Number.isFinite(Number(p.quantity)) ? Math.max(0, Number(p.quantity)) : 1);
  const isSold = (p) => stockOf(p) === 0;
  const stockLabel = (p) => { const n = stockOf(p); return n === 0 ? "Sold out" : `${n} available`; };
  const stockClass = (p) => (stockOf(p) === 0 ? "sold" : "ok");

  // Images fade in once decoded; a failed image shows the mat instead of a broken icon.
  function img(attrs) {
    const node = el("img", { decoding: "async", ...attrs });
    const done = () => node.classList.add("is-loaded");
    node.addEventListener("load", done, { once: true });
    node.addEventListener("error", () => { node.classList.add("is-broken"); done(); }, { once: true });
    if (node.complete && node.naturalWidth) done();
    return node;
  }

  function renderHero() {
    const p = state.paintings.find((x) => !isSold(x)) || state.paintings[0];
    if (!p) return;
    $("#hero-art").replaceChildren(el("div", { class: "frame tilt" }, img({ src: p.image, alt: "", width: "800", height: "1000" })));
  }

  function renderFilters() {
    const count = (id) => (id === "all" ? state.paintings.length : state.paintings.filter((p) => p.category === id).length);
    $("#filters").replaceChildren(
      ...CATEGORIES.map((c) =>
        el("button", {
          type: "button",
          "aria-pressed": String(c.id === state.filter),
          onclick: (e) => {
            state.filter = c.id; renderFilters(); renderWall();
            e.currentTarget && e.currentTarget.scrollIntoView && e.currentTarget.scrollIntoView({ inline: "center", block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
          },
        }, c.label, el("span", { class: "count", text: String(count(c.id)) }))
      )
    );
  }

  function renderWall() {
    const list = state.paintings
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => state.filter === "all" || p.category === state.filter);
    const wall = $("#wall");
    wall.classList.remove("is-swapping"); void wall.offsetWidth; wall.classList.add("is-swapping");
    if (!list.length) {
      const label = CATEGORIES.find((c) => c.id === state.filter)?.label.toLowerCase() || "pieces";
      const empty = el("li", { class: "empty" }, el("p", { text: `No ${label} listed right now.` }));
      if (igHandle()) empty.append(el("p", {}, el("a", { href: igUrl(), target: "_blank", rel: "noopener" }, `Follow @${igHandle()}`), " for new pieces, or message to ask about one."));
      wall.replaceChildren(empty);
      return;
    }
    wall.replaceChildren(
      ...list.map(({ p, idx }, i) =>
        el("li", { class: `piece${isSold(p) ? " is-sold" : ""}`, style: `--i:${Math.min(i, 12)}` },
          el("button", { type: "button", "aria-label": `View ${p.title}, ${stockLabel(p)}`, onclick: () => open(idx) },
            el("div", { class: "frame" },
              img({ src: p.image, alt: p.alt || p.title, loading: i < 4 ? "eager" : "lazy", width: "800", height: "1000" }),
              photosOf(p).length > 1 ? el("span", { class: "multi-badge", title: `${photosOf(p).length} photos` }, MULTI_ICON(), el("span", { class: "sr", text: `${photosOf(p).length} photos` })) : null,
              isSold(p) ? el("span", { class: "ribbon", text: "Sold" }) : null
            )
          ),
          el("div", { class: "label" },
            el("h3", { text: p.title }),
            el("p", { class: "label-spec", text: spec(p) }),
            el("div", { class: "label-row" },
              el("span", { class: "price", text: isSold(p) ? "—" : money(p.price) }),
              el("span", { class: `status ${stockClass(p)}`, text: stockLabel(p) })
            )
          )
        )
      )
    );
  }

  function copyButton(text) {
    const btn = el("button", { type: "button", class: "copy", text: "Copy" });
    btn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; }
      catch { const r = document.createRange(); r.selectNodeContents(btn.previousElementSibling); getSelection().removeAllRanges(); getSelection().addRange(r); btn.textContent = "Selected — press Ctrl+C"; }
      setTimeout(() => (btn.textContent = "Copy"), 2200);
    });
    return btn;
  }

  function mailto(subject) {
    return `mailto:${state.artist.email}?subject=${encodeURIComponent(subject)}`;
  }
  const igHandle = () => (state.artist.instagram || "").replace(/^@/, "").trim();
  const igUrl = () => `https://www.instagram.com/${igHandle()}/`;
  const IG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none"/></svg>';
  const PP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M7.3 21H4.1a.5.5 0 0 1-.5-.6L6.4 3.5A.6.6 0 0 1 7 3h6.4c3.3 0 5.3 1.7 4.8 4.8-.6 3.6-3 5.3-6.4 5.3H9.9a.6.6 0 0 0-.6.5L8.4 19.3"/><path d="M19.6 8.6c.9.8 1.2 2 .9 3.6-.6 3.4-2.9 4.9-6 4.9h-1.2a.6.6 0 0 0-.6.5l-.7 3.8a.5.5 0 0 1-.5.4H9.3" opacity=".6"/></svg>';

  // Fallback when checkout isn't set up: PayPal.me link with the price filled in, or a per-item PayPal link.
  function paypalUrl(p) {
    if (p.paypalLink) return p.paypalLink;
    const user = (state.artist.paypal || "").replace(/^https?:\/\/(www\.)?paypal\.me\//i, "").replace(/^paypal\.me\//i, "").trim().replace(/^@/, "").replace(/[/?#].*$/, "");
    return user ? `https://www.paypal.me/${user}/${p.price}${state.artist.currency || "CAD"}` : "";
  }
  const checkoutOn = () => /^https:\/\//.test(state.artist.checkoutApi || "") && !/paypal\.(me|com)/i.test(state.artist.checkoutApi) && /^[A-Za-z0-9_-]{40,}$/.test(state.artist.paypalClientId || "");
  const api = (path) => state.artist.checkoutApi.replace(/\/+$/, "") + path;

  function iconLink(cls, href, icon, label) {
    const a = el("a", { class: cls, href, target: "_blank", rel: "noopener" });
    a.innerHTML = icon;
    a.append(" " + label);
    return a;
  }

  function applyInstagram() {
    const h = igHandle();
    document.querySelectorAll("[data-ig]").forEach((a) => { if (h) a.href = igUrl(); else a.hidden = true; });
    document.querySelectorAll("[data-ig-handle]").forEach((n) => (n.textContent = `@${h}`));
  }

  // Page text from content/pages.json. The HTML carries the same defaults, so the page reads fine before this runs.
  const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  function renderPages() {
    const pages = state.pages;
    if (!pages) return;
    document.querySelectorAll("[data-content]").forEach((n) => {
      const v = get(pages, n.dataset.content);
      if (typeof v === "string" && v.trim()) n.textContent = v;
    });
    const about = pages.about || {};
    if (about.text) $("#about-body").replaceChildren(...about.text.split(/\n\s*\n/).map((para) => el("p", { text: para.trim() })));
    const photo = $("#about-photo");
    if (about.photo) { photo.src = about.photo; photo.alt = about.photoAlt || `Photo of ${state.artist.name || "the artist"}`; photo.hidden = false; }
    splitHeadline();
    const steps = (pages.buy && pages.buy.steps) || [];
    if (steps.length) $("#steps").replaceChildren(...steps.map((st) => el("li", {}, el("strong", { text: st.title || "" }), el("span", { text: st.text || "" }))));
  }

  // Headline words rise in one by one.
  function splitHeadline() {
    if (reduceMotion) return;
    let d = 0;
    document.querySelectorAll("#hero-title [data-content]").forEach((part) => {
      const words = part.textContent.trim().split(/\s+/);
      part.replaceChildren(...words.flatMap((w, i) => [el("span", { class: "w", style: `--d:${d++}`, text: w }), i < words.length - 1 ? " " : ""]));
    });
  }

  function renderContact() {
    const { email } = state.artist;
    const intro = (state.pages && state.pages.contact && state.pages.contact.text) || "For questions about a piece, custom commissions or delivery, message Sruthi directly.";
    const parts = [el("p", { text: intro })];
    const links = el("div", { class: "contact-links" });
    if (igHandle()) links.append(iconLink("btn", igUrl(), IG_ICON, `Message @${igHandle()}`));
    if (email) links.append(el("a", { class: "btn ghost", href: mailto("Painting enquiry") }, "Email Sruthi"));
    if (links.childElementCount) parts.push(links);
    if (email) parts.push(el("div", { class: "address" }, el("code", { text: email }), copyButton(email)));
    if (!email && !igHandle()) parts.push(el("p", { text: "Contact details are on their way. Check back soon." }));
    $("#contact-body").replaceChildren(...parts);
  }

  // ---------- PayPal checkout ----------
  let sdkPromise = null;
  function loadPayPal() {
    if (window.paypal) return Promise.resolve(window.paypal);
    if (!sdkPromise) {
      sdkPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(state.artist.paypalClientId)}&currency=${encodeURIComponent(state.artist.currency || "CAD")}&intent=capture&components=buttons`;
        s.onload = () => resolve(window.paypal);
        s.onerror = () => { sdkPromise = null; reject(new Error("PayPal didn't load")); };
        document.head.append(s);
      });
    }
    return sdkPromise;
  }

  async function postJson(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || "Something went wrong. You have not been charged."); err.data = data; throw err; }
    return data;
  }

  // ---------- Cart and checkout ----------
  // The cart lives in this browser only (localStorage). Prices, stock and delivery fees are checked again by the
  // checkout server, so nothing here decides what a buyer pays.
  const CART_KEY = "sruthiarts.cart";
  const testParam = /[?&]test\b/.test(location.search);
  const cartTest = (() => { try { if (testParam) sessionStorage.setItem("sruthiarts.test", "1"); return sessionStorage.getItem("sruthiarts.test") === "1"; } catch { return testParam; } })();
  // In test mode (Studio → Settings) the cart only appears for people who open the site with ?test.
  const cartOn = () => checkoutOn() && (!state.artist.checkoutTest || cartTest);
  let cart = [];
  try { cart = (JSON.parse(localStorage.getItem(CART_KEY) || "[]") || []).filter((c) => c && typeof c.id === "string" && Number(c.qty) > 0); } catch { cart = []; }
  const findPiece = (id) => state.paintings.find((p) => p.id === id);
  const cartLines = () => cart.map((c) => ({ ...c, p: findPiece(c.id) })).filter((c) => c.p);
  const cartCount = () => cartLines().reduce((t, c) => t + c.qty, 0);
  const cartSubtotal = () => cartLines().reduce((t, c) => t + Number(c.p.price) * c.qty, 0);
  function saveCart() {
    cart = cart.filter((c) => c.qty > 0);
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart.map(({ id, qty }) => ({ id, qty })))); } catch {}
    updateCartBadge();
  }
  function updateCartBadge() {
    const n = cartCount();
    document.querySelectorAll("[data-cart-count]").forEach((b) => { b.textContent = String(n); b.hidden = n === 0; });
    document.querySelectorAll("[data-cart-open]").forEach((b) => { b.hidden = !cartOn(); b.setAttribute("aria-label", n ? `Cart, ${n} item${n > 1 ? "s" : ""}` : "Cart"); });
    document.documentElement.classList.toggle("has-cart", cartOn());
  }
  function bumpCart() {
    document.querySelectorAll("[data-cart-open]").forEach((b) => { b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); });
  }
  // Returns how many were actually added (stock may cap it).
  function addToCart(p, qty) {
    const left = Math.min(stockOf(p), 20);
    const line = cart.find((c) => c.id === p.id);
    const before = line ? line.qty : 0;
    const after = Math.min(left, before + qty);
    if (line) line.qty = after; else if (after > 0) cart.push({ id: p.id, qty: after });
    saveCart(); bumpCart();
    return after - before;
  }
  // Keep the cart honest after the shop data reloads: drop sold-out pieces, cap quantities at what's left.
  function reconcileCart() {
    const notes = [];
    cart.forEach((c) => {
      const p = findPiece(c.id);
      if (!p) { c.qty = 0; return; }
      const left = stockOf(p);
      if (left === 0) { notes.push(`“${p.title}” has sold out and was removed.`); c.qty = 0; }
      else if (c.qty > left) { notes.push(`Only ${left} of “${p.title}” left, so your cart was updated.`); c.qty = left; }
    });
    saveCart();
    return notes;
  }

  // Delivery fees (Studio → Settings → Delivery). The server uses the same rule.
  function shipCfg() {
    const s = state.artist.shipping || {};
    const fee = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== "" ? Number(v) : d);
    return { CA: fee(s.CA, 15), US: fee(s.US, 25), intl: fee(s.intl, 40), pickup: s.pickup !== false, pickupNote: s.pickupNote || "" };
  }
  const feeFor = (d) => { const c = shipCfg(); return d.method === "pickup" ? 0 : d.country === "CA" ? c.CA : d.country === "US" ? c.US : c.intl; };
  const moneyOrFree = (n) => (n > 0 ? money(n) : "Free");

  const COUNTRY_CODES = "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IS IT JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV MA MC MD ME MF MG MH MK ML MN MO MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RW SA SB SC SE SG SH SI SK SL SM SN SO SR ST SV SX SZ TC TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YT ZA ZM ZW".split(" ");
  const countryName = (() => { let dn = null; try { dn = new Intl.DisplayNames(["en"], { type: "region" }); } catch {} return (c) => (dn && dn.of(c)) || c; })();
  const COUNTRIES = ["CA", "US", ...COUNTRY_CODES.filter((c) => c !== "CA" && c !== "US").sort((a, b) => countryName(a).localeCompare(countryName(b)))];
  const PROVINCES = { AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon" };
  const STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico" };

  // What the buyer typed. Kept in memory only, so nothing personal stays on a shared device.
  const buyer = { method: "ship", name: "", email: "", phone: "", country: "CA", line1: "", line2: "", city: "", region: "", postal: "", note: "" };
  const deliveryPayload = () => ({
    method: buyer.method, name: buyer.name.trim(), email: buyer.email.trim(), phone: buyer.phone.trim(), note: buyer.note.trim(),
    ...(buyer.method === "ship" ? { address: { line1: buyer.line1.trim(), line2: buyer.line2.trim(), city: buyer.city.trim(), region: buyer.region.trim(), postal: buyer.postal.trim().toUpperCase(), country: buyer.country } } : {}),
  });
  function validateBuyer() {
    const b = buyer;
    if (b.name.trim().length < 2) return ["name", "Please enter your full name."];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email.trim())) return ["email", "Please enter a valid email address. Your receipt goes there."];
    if (b.method === "pickup") return b.phone.trim() ? null : ["phone", "Please add a phone number so Sruthi can arrange the pickup."];
    if (!b.line1.trim()) return ["line1", "Please enter your street address."];
    if (!b.city.trim()) return ["city", "Please enter your city."];
    if ((b.country === "CA" || b.country === "US") && !b.region) return ["region", b.country === "CA" ? "Please choose your province." : "Please choose your state."];
    if (b.country === "CA" && !/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i.test(b.postal.trim())) return ["postal", "Please enter a valid postal code, like M5V 2T6."];
    if (b.country === "US" && !/^\d{5}(-\d{4})?$/.test(b.postal.trim())) return ["postal", "Please enter a valid ZIP code, like 10001."];
    return null;
  }
  const addressLines = () => buyer.method === "pickup"
    ? ["Pickup", shipCfg().pickupNote].filter(Boolean)
    : [buyer.name, buyer.line1, buyer.line2, [buyer.city, buyer.region, buyer.postal.toUpperCase()].filter(Boolean).join(" "), countryName(buyer.country)].filter(Boolean);

  // ---- Cart panel ----
  const cartDlg = $("#cart");
  let cartStep = "cart";
  function openCart(step = "cart") {
    if (!cartOn()) return;
    if (viewer.open) closeViewer();
    const notes = reconcileCart();
    showStep(cartLines().length ? step : "cart", notes);
    if (!cartDlg.open) { cartDlg.classList.remove("is-closing"); cartDlg.showModal(); document.documentElement.classList.add("sheet-open"); }
  }
  function closeCart() {
    if (!cartDlg.open || cartDlg.classList.contains("is-closing")) return;
    if (reduceMotion) return cartDlg.close();
    cartDlg.classList.add("is-closing");
    setTimeout(() => { cartDlg.close(); cartDlg.classList.remove("is-closing"); }, 240);
  }
  cartDlg.addEventListener("close", () => { document.documentElement.classList.remove("sheet-open"); if (cartStep === "done") showStep("cart"); });
  cartDlg.addEventListener("click", (e) => { if (e.target === cartDlg) closeCart(); });
  cartDlg.addEventListener("cancel", (e) => { e.preventDefault(); closeCart(); });
  $("#cart-close").addEventListener("click", closeCart);
  $("#cart-back").addEventListener("click", () => showStep(cartStep === "pay" ? "details" : "cart"));
  document.querySelectorAll("[data-cart-open]").forEach((b) => b.addEventListener("click", () => openCart()));

  function showStep(step, notes = []) {
    cartStep = step;
    const titles = { cart: "Your cart", details: "Delivery details", pay: "Payment", done: "Order placed" };
    $("#cart-title").textContent = titles[step];
    $("#cart-back").hidden = step === "cart" || step === "done";
    const idx = { cart: 0, details: 1, pay: 2, done: 3 }[step];
    [...$("#cart-steps").children].forEach((li, i) => { li.className = i < idx ? "done" : i === idx ? "on" : ""; });
    $("#cart-steps").hidden = step === "done";
    const body = $("#cart-body");
    const view = step === "cart" ? cartView(notes) : step === "details" ? detailsView() : step === "pay" ? payView() : null;
    if (view) { body.replaceChildren(view); body.scrollTop = 0; $("#cart-inner").scrollTop = 0; }
  }

  function stepper(value, min, max, onChange, label) {
    const out = el("output", { text: String(value) });
    const set = (d) => { const v = Math.max(min, Math.min(max, value + d)); if (v === value) return; value = v; out.textContent = String(v); out.classList.remove("bump"); void out.offsetWidth; out.classList.add("bump"); onChange(v); };
    return el("div", { class: "stepper small" },
      el("button", { type: "button", "aria-label": `One fewer ${label}`, onclick: () => set(-1) }, "−"), out,
      el("button", { type: "button", "aria-label": `One more ${label}`, disabled: value >= max, onclick: (e) => { set(1); e.currentTarget.disabled = value >= max; } }, "+"));
  }

  function totalsBlock(withFee) {
    const sub = cartSubtotal();
    const fee = withFee ? feeFor(buyer) : null;
    return el("dl", { class: "totals" },
      el("div", {}, el("dt", { text: "Subtotal" }), el("dd", { text: money(sub) })),
      el("div", {}, el("dt", { text: buyer.method === "pickup" && withFee ? "Pickup" : "Delivery" }), el("dd", { text: withFee ? moneyOrFree(fee) : "Next step" })),
      el("div", { class: "grand" }, el("dt", { text: "Total" }), el("dd", { text: `${money(sub + (fee || 0))} ${state.artist.currency || "CAD"}` })));
  }

  function cartView(notes) {
    const lines = cartLines();
    const wrap = el("div", { class: "cart-view" });
    if (state.artist.checkoutTest) wrap.append(el("p", { class: "test-banner", text: "Test mode: payments use PayPal's sandbox. No real money is charged." }));
    notes.forEach((n) => wrap.append(el("p", { class: "cart-note", text: n })));
    if (!lines.length) {
      wrap.append(el("div", { class: "cart-empty" },
        el("div", { class: "ring", "aria-hidden": "true" }),
        el("p", { class: "big", text: "Your cart is empty" }),
        el("p", { text: "Open any piece marked Available and tap “Add to cart”." }),
        el("button", { type: "button", class: "btn", onclick: () => { closeCart(); setTimeout(() => $("#gallery").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }), 250); } }, "Browse the shop")));
      return wrap;
    }
    const list = el("ul", { class: "cart-lines" }, lines.map((c, i) => {
      const left = Math.min(stockOf(c.p), 20);
      const lineTotal = el("span", { class: "line-total", text: money(c.p.price * c.qty) });
      return el("li", { class: "cart-line", style: `--i:${i}` },
        el("img", { src: c.p.image, alt: "", width: "80", height: "100", loading: "lazy" }),
        el("div", { class: "cl-info" },
          el("p", { class: "cl-title", text: c.p.title }),
          el("p", { class: "cl-spec", text: `${money(c.p.price)} each · ${left} available` }),
          el("div", { class: "cl-row" },
            stepper(c.qty, 1, left, (v) => { const line = cart.find((x) => x.id === c.id); line.qty = v; lineTotal.textContent = money(c.p.price * v); saveCart(); wrap.querySelector(".totals").replaceWith(totalsBlock(false)); }, c.p.title),
            el("button", { type: "button", class: "cl-remove", onclick: (e) => { const li = e.currentTarget.closest("li"); li.classList.add("leaving"); setTimeout(() => { cart = cart.filter((x) => x.id !== c.id); saveCart(); showStep("cart"); }, reduceMotion ? 0 : 220); } }, "Remove"))),
        lineTotal);
    }));
    wrap.append(list, totalsBlock(false),
      el("button", { type: "button", class: "btn block", onclick: () => showStep("details") }, "Checkout"),
      el("p", { class: "fine center", text: "Secure payment by PayPal: PayPal account or any debit or credit card." }));
    return wrap;
  }

  function detailsView() {
    const cfg = shipCfg();
    if (!cfg.pickup) buyer.method = "ship";
    const form = el("form", { class: "ship-form", novalidate: true });
    const err = el("p", { class: "form-error", role: "alert", hidden: true });
    const field = (key, label, attrs = {}, hint) => {
      const input = el(attrs.tag || "input", { ...attrs, tag: null, id: `f-${key}`, name: key, value: buyer[key] || "", oninput: (e) => { buyer[key] = e.target.value; e.target.removeAttribute("aria-invalid"); err.hidden = true; } });
      input.value = buyer[key] || "";
      return el("label", { class: `field f-${key}` }, el("span", { text: label }), input, hint ? el("small", { text: hint }) : null);
    };
    const totalsSlot = el("div", {}, totalsBlock(true));
    const refreshTotals = () => totalsSlot.replaceChildren(totalsBlock(true));

    const regionSlot = el("div", { class: "region-slot" });
    function renderRegion() {
      const opts = buyer.country === "CA" ? PROVINCES : buyer.country === "US" ? STATES : null;
      if (opts && !opts[buyer.region]) buyer.region = "";
      regionSlot.replaceChildren(opts
        ? el("label", { class: "field f-region" }, el("span", { text: buyer.country === "CA" ? "Province" : "State" }),
            el("select", { id: "f-region", onchange: (e) => { buyer.region = e.target.value; e.target.removeAttribute("aria-invalid"); err.hidden = true; } },
              el("option", { value: "", text: "Choose…" }),
              Object.entries(opts).map(([code, name]) => el("option", { value: code, selected: buyer.region === code ? true : null, text: name }))))
        : field("region", "State / province / region (optional)", { autocomplete: "address-level1" }));
      const postal = form.querySelector("#f-postal");
      if (postal) {
        postal.placeholder = buyer.country === "CA" ? "M5V 2T6" : buyer.country === "US" ? "10001" : "";
        postal.closest("label").querySelector("span").textContent = buyer.country === "US" ? "ZIP code" : buyer.country === "CA" ? "Postal code" : "Postal code (if any)";
      }
    }
    const address = el("fieldset", { class: "addr" },
      el("legend", { text: "Delivery address" }),
      el("label", { class: "field f-country" }, el("span", { text: "Country" }),
        el("select", { id: "f-country", autocomplete: "country", onchange: (e) => { buyer.country = e.target.value; renderRegion(); refreshTotals(); } },
          COUNTRIES.map((c) => el("option", { value: c, selected: buyer.country === c ? true : null, text: countryName(c) })))),
      field("line1", "Street address", { autocomplete: "address-line1", placeholder: "123 Maple Street" }),
      field("line2", "Apartment, suite, unit (optional)", { autocomplete: "address-line2" }),
      el("div", { class: "row2" }, field("city", "City", { autocomplete: "address-level2" }), field("postal", "Postal code", { autocomplete: "postal-code", autocapitalize: "characters" })),
      regionSlot);

    const methods = el("div", { class: "method", role: "radiogroup", "aria-label": "How would you like to get your order?" },
      [["ship", "Delivery", "Shipped to your door"], ...(cfg.pickup ? [["pickup", "Pickup", cfg.pickupNote || "Collect from Sruthi"]] : [])].map(([id, title, sub]) =>
        el("button", { type: "button", role: "radio", class: "method-opt", "aria-checked": String(buyer.method === id), onclick: () => { buyer.method = id; methods.querySelectorAll(".method-opt").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.m === id))); address.hidden = id === "pickup"; phoneHint.textContent = id === "pickup" ? "Required for pickup." : "Optional, in case the courier needs it."; refreshTotals(); }, "data-m": id },
          el("strong", { text: title }), el("small", { text: sub }))));
    const phoneField = field("phone", "Phone", { type: "tel", autocomplete: "tel", inputmode: "tel" });
    const phoneHint = el("small", { text: buyer.method === "pickup" ? "Required for pickup." : "Optional, in case the courier needs it." });
    phoneField.append(phoneHint);
    address.hidden = buyer.method === "pickup";

    form.append(
      methods,
      el("fieldset", { class: "contact-f" }, el("legend", { text: "Your details" }),
        field("name", "Full name", { autocomplete: "name" }),
        field("email", "Email", { type: "email", autocomplete: "email", inputmode: "email" }, "For your PayPal receipt and order updates."),
        phoneField),
      address,
      field("note", "Note for Sruthi (optional)", { tag: "textarea", rows: 2, maxlength: 300, placeholder: "Gift message, delivery instructions…" }),
      totalsSlot, err,
      el("button", { type: "submit", class: "btn block" }, "Continue to payment"));
    renderRegion();
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const bad = validateBuyer();
      if (bad) {
        err.textContent = bad[1]; err.hidden = false;
        const f = form.querySelector(`#f-${bad[0]}`);
        if (f) { f.setAttribute("aria-invalid", "true"); f.focus(); f.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" }); }
        return;
      }
      showStep("pay");
    });
    return form;
  }

  function payView() {
    const lines = cartLines();
    const note = el("p", { class: "checkout-msg", role: "status" });
    const box = el("div", { class: "paypal-box" }, el("div", { class: "pp-skeleton" }, el("span"), el("span")));
    const wrap = el("div", { class: "pay-view" },
      state.artist.checkoutTest ? el("p", { class: "test-banner", text: "Test mode: use a PayPal sandbox buyer account. No real money is charged." }) : null,
      el("section", { class: "recap" },
        el("div", { class: "recap-head" }, el("h3", { text: buyer.method === "pickup" ? "Pickup" : "Delivering to" }), el("button", { type: "button", class: "link", onclick: () => showStep("details") }, "Change")),
        el("address", {}, addressLines().map((l) => el("span", { text: l }))),
        el("p", { class: "recap-contact", text: [buyer.email.trim(), buyer.phone.trim()].filter(Boolean).join(" · ") })),
      el("section", { class: "recap" },
        el("div", { class: "recap-head" }, el("h3", { text: `${cartCount()} item${cartCount() > 1 ? "s" : ""}` }), el("button", { type: "button", class: "link", onclick: () => showStep("cart") }, "Edit")),
        el("ul", { class: "recap-items" }, lines.map((c) => el("li", {}, el("img", { src: c.p.image, alt: "", width: "44", height: "55" }), el("span", { text: `${c.p.title} × ${c.qty}` }), el("b", { text: money(c.p.price * c.qty) }))))),
      totalsBlock(true), box, note,
      el("p", { class: "fine center", text: "You'll pay securely with PayPal or any debit or credit card. Your card details never touch this site." }));

    loadPayPal().then((paypal) => {
      box.replaceChildren();
      paypal.Buttons({
        style: { layout: "vertical", shape: "pill", color: "gold", label: "pay", height: 48 },
        createOrder: async () => {
          note.textContent = ""; note.className = "checkout-msg";
          try {
            return (await postJson(api("/api/orders"), { items: cartLines().map((c) => ({ id: c.id, qty: c.qty })), delivery: deliveryPayload() })).id;
          } catch (e) {
            note.textContent = e.message; note.className = "checkout-msg error";
            throw e;
          }
        },
        onApprove: async (data, actions) => {
          note.textContent = "Confirming your payment…"; note.className = "checkout-msg";
          box.classList.add("busy");
          try {
            const r = await postJson(api(`/api/orders/${data.orderID}/capture`));
            orderDone(r);
          } catch (e) {
            box.classList.remove("busy");
            if (e.data && e.data.restart) { note.textContent = e.message; note.className = "checkout-msg error"; return actions.restart(); }
            note.textContent = e.message; note.className = "checkout-msg error";
          }
        },
        onCancel: () => { note.textContent = "Payment cancelled. Nothing was charged."; note.className = "checkout-msg"; },
        onError: () => { if (!note.textContent) { note.textContent = "PayPal hit a problem. Please try again in a moment."; note.className = "checkout-msg error"; } },
      }).render(box);
    }).catch(() => {
      box.replaceChildren();
      note.className = "checkout-msg error";
      note.textContent = "Payment couldn't load. Check your connection and try again" + (igHandle() ? `, or message @${igHandle()} to order.` : ".");
    });
    return wrap;
  }

  function orderDone(r) {
    // Show the new stock straight away; the site itself refreshes about a minute later.
    (r.stock || []).forEach((s) => {
      const i = state.paintings.findIndex((p) => p.id === s.id);
      if (i >= 0 && typeof s.left === "number") state.paintings[i] = { ...state.paintings[i], quantity: s.left, status: s.left > 0 ? "available" : "sold" };
    });
    const first = (buyer.name.trim().split(/\s+/)[0]) || "";
    const pickup = buyer.method === "pickup";
    cart = []; saveCart();
    renderFilters(); renderWall();
    cartStep = "done";
    $("#cart-title").textContent = "Order placed";
    $("#cart-back").hidden = true;
    $("#cart-steps").hidden = true;
    $("#cart-body").replaceChildren(el("div", { class: "thanks done" },
      el("div", { class: "tick", "aria-hidden": "true" }),
      el("h3", { text: first ? `Thank you, ${first}!` : "Thank you!" }),
      el("p", { class: "order-no" }, "Order ", el("b", { text: r.number || "" })),
      el("ul", { class: "recap-items plain" }, (r.items || []).map((i) => el("li", { text: `${i.title} × ${i.qty}` }))),
      el("p", { text: `Paid ${money(Number(r.total))} ${r.currency || ""}. PayPal is emailing your receipt to ${buyer.email.trim()}.` }),
      el("p", { text: pickup ? "Sruthi has your order and will message you to arrange the pickup." : "Sruthi has your order and will ship it to the address you gave. Keep your order number handy if you have questions." }),
      igHandle() ? el("p", {}, "Questions? Message ", el("a", { href: igUrl(), target: "_blank", rel: "noopener" }, `@${igHandle()}`), ` with order ${r.number || ""}.`) : null,
      el("button", { type: "button", class: "btn ghost", onclick: () => closeCart() }, "Keep browsing")));
    petals();
  }

  // Viewer buttons when the cart is on: quantity, Add to cart, Buy now.
  function cartBlock(p) {
    const left = Math.min(stockOf(p), 20);
    const inCart = () => (cart.find((c) => c.id === p.id) || {}).qty || 0;
    let qty = 1;
    const msg = el("p", { class: "checkout-msg", role: "status" });
    const addBtn = el("button", { type: "button", class: "btn add-cart" });
    const refresh = () => {
      const room = left - inCart();
      addBtn.disabled = room < 1;
      addBtn.textContent = room < 1 ? (inCart() ? "All available are in your cart" : "Sold out") : `Add to cart · ${money(p.price * Math.min(qty, room))}`;
    };
    addBtn.addEventListener("click", () => {
      const added = addToCart(p, qty);
      if (added > 0) {
        addBtn.classList.remove("added"); void addBtn.offsetWidth; addBtn.classList.add("added");
        msg.className = "checkout-msg ok";
        msg.replaceChildren(`Added ${added} to your cart. `, el("button", { type: "button", class: "link", onclick: () => openCart() }, "View cart"));
      }
      refresh();
    });
    const qtyRow = left > 1 ? el("div", { class: "qty" }, el("span", { text: "Quantity" }), stepper(1, 1, left, (v) => { qty = v; refresh(); }, p.title)) : null;
    refresh();
    return el("div", { class: "checkout" }, qtyRow,
      el("div", { class: "cart-actions" }, addBtn,
        el("button", { type: "button", class: "btn ghost", onclick: () => { if (inCart() < Math.min(qty, left)) addToCart(p, Math.min(qty, left) - inCart()); openCart("details"); } }, "Buy now")),
      msg);
  }

  // A short burst of petals — the one celebratory moment on the site.
  function petals() {
    if (reduceMotion) return;
    const c = el("canvas", { class: "petals", "aria-hidden": "true" });
    document.body.append(c);
    const ctx = c.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    const colors = ["#e0789c", "#f7b6cb", "#c8927a", "#a8325e", "#fde6ec"];
    const bits = Array.from({ length: 90 }, () => ({ x: innerWidth / 2 * dpr, y: innerHeight * 0.55 * dpr, vx: (Math.random() - 0.5) * 16 * dpr, vy: (-Math.random() * 16 - 6) * dpr, r: (4 + Math.random() * 5) * dpr, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3, c: colors[(Math.random() * colors.length) | 0] }));
    let t = 0;
    (function frame() {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const b of bits) {
        b.vy += 0.45 * dpr; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.a += b.va;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.c; ctx.globalAlpha = Math.max(0, 1 - t / 110);
        ctx.beginPath(); ctx.ellipse(0, 0, b.r, b.r * 0.55, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      if (++t < 120) requestAnimationFrame(frame); else c.remove();
    })();
  }

  // ---------- Viewer (bottom sheet on phones, dialog on larger screens) ----------
  const viewer = $("#viewer");
  const photosOf = (p) => (p && p.images && p.images.length ? p.images : [p && p.image].filter(Boolean));
  // Show photo i of the open piece; dir slides it in from the right (1) or left (-1).
  function showPhoto(i, dir = 0) {
    const p = state.paintings[state.current];
    const list = photosOf(p);
    if (!list.length) return;
    state.photo = (i + list.length) % list.length;
    const vimg = $("#viewer-img");
    vimg.classList.remove("is-loaded", "slide-l", "slide-r");
    if (dir) { void vimg.offsetWidth; vimg.classList.add(dir > 0 ? "slide-l" : "slide-r"); }
    vimg.onload = () => vimg.classList.add("is-loaded");
    vimg.src = list[state.photo];
    if (vimg.complete && vimg.naturalWidth) vimg.classList.add("is-loaded");
    vimg.alt = list.length > 1 ? `${p.alt || p.title} (photo ${state.photo + 1} of ${list.length})` : p.alt || p.title;
    const multi = list.length > 1;
    $("#viewer-art").classList.toggle("multi", multi);
    const dots = $("#viewer-dots");
    dots.hidden = !multi;
    dots.replaceChildren(...(multi ? list.map((_, k) => el("button", {
      type: "button", class: k === state.photo ? "on" : "", "aria-label": `Photo ${k + 1} of ${list.length}`,
      "aria-current": k === state.photo ? "true" : null, onclick: () => showPhoto(k, k > state.photo ? 1 : -1),
    })) : []));
    if (multi) list.forEach((src, k) => { if (k !== state.photo) { const pre = new Image(); pre.src = src; } });
  }
  function open(idx, { push = true } = {}) {
    const p = state.paintings[idx];
    if (!p) return;
    const dir = state.current === -1 || !viewer.open ? 0 : idx > state.current ? 1 : -1;
    state.current = idx;
    showPhoto(0, dir);
    $("#viewer-artist").textContent = state.artist.name || "Sruthi";
    $("#viewer-title").textContent = p.title;
    $("#viewer-spec").textContent = spec(p);
    $("#viewer-desc").textContent = p.description;
    $("#viewer-price").textContent = isSold(p) ? "Sold — in a private collection" : money(p.price);
    $("#viewer-stock").textContent = isSold(p) ? "" : stockLabel(p);
    $("#viewer-stock").className = `stock ${stockClass(p)}`;

    const actions = [];
    if (!isSold(p)) {
      if (cartOn()) {
        actions.push(cartBlock(p));
        if (igHandle()) actions.push(iconLink("btn ghost small", igUrl(), IG_ICON, "Ask a question on Instagram"));
      } else if (paypalUrl(p)) {
        actions.push(iconLink("btn paypal", paypalUrl(p), PP_ICON, `Buy with PayPal · ${money(p.price)}`));
        if (igHandle()) actions.push(iconLink("btn ghost", igUrl(), IG_ICON, "Ask a question on Instagram"));
        actions.push(el("p", { class: "fine", text: igHandle()
          ? `After paying, message @${igHandle()} with “${p.title}” and your address so Sruthi can arrange delivery.`
          : "After paying, Sruthi will contact you through PayPal to arrange delivery." }));
      } else if (igHandle()) {
        actions.push(iconLink("btn", igUrl(), IG_ICON, "Buy on Instagram"));
        actions.push(el("p", { class: "fine", text: `Message @${igHandle()} with “${p.title}” to reserve it.` }));
      } else if (state.artist.email) {
        actions.push(el("a", { class: "btn", href: mailto(`Enquiry: ${p.title}`) }, "Enquire about this piece"));
      }
    } else if (igHandle()) {
      actions.push(el("p", { class: "fine" }, "Love this one? ", el("a", { href: igUrl(), target: "_blank", rel: "noopener" }, `Message @${igHandle()}`), " about similar pieces or a commission."));
    }
    $("#viewer-actions").replaceChildren(...actions);
    if (!viewer.open) {
      viewer.classList.remove("is-closing");
      viewer.showModal();
      document.documentElement.classList.add("sheet-open");
    }
    $("#viewer-inner").scrollTop = 0;
    if (push && location.hash !== `#${p.id}`) history.replaceState(null, "", `#${p.id}`);
    document.title = `${p.title} · Sruthi Arts`;
  }

  function closeViewer() {
    if (!viewer.open || viewer.classList.contains("is-closing")) return;
    if (reduceMotion) return viewer.close();
    viewer.classList.add("is-closing");
    setTimeout(() => { viewer.close(); viewer.classList.remove("is-closing"); $("#viewer-inner").style.transform = ""; }, 240);
  }

  const step = (d) => open((state.current + d + state.paintings.length) % state.paintings.length);
  $("#viewer-prev").addEventListener("click", () => step(-1));
  $("#viewer-next").addEventListener("click", () => step(1));
  $("#viewer-close").addEventListener("click", closeViewer);
  $("#photo-prev").addEventListener("click", () => showPhoto(state.photo - 1, -1));
  $("#photo-next").addEventListener("click", () => showPhoto(state.photo + 1, 1));
  viewer.addEventListener("click", (e) => { if (e.target === viewer) closeViewer(); });
  viewer.addEventListener("cancel", (e) => { e.preventDefault(); closeViewer(); });
  viewer.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); });
  viewer.addEventListener("close", () => {
    document.documentElement.classList.remove("sheet-open");
    document.title = "Sruthi Arts";
    state.current = -1;
    if (state.paintings.some((p) => `#${p.id}` === location.hash)) history.replaceState(null, "", location.pathname + location.search);
  });

  // Touch gestures: swipe the photo left/right to browse; drag the sheet down to close (phones).
  (function gestures() {
    const inner = $("#viewer-inner"), art = $("#viewer-art");
    let sx = 0, sy = 0, dy = 0, mode = "";
    inner.addEventListener("touchstart", (e) => {
      const t = e.touches[0]; sx = t.clientX; sy = t.clientY; dy = 0;
      mode = isPhone() && inner.scrollTop <= 0 ? "maybe-drag" : "";
    }, { passive: true });
    inner.addEventListener("touchmove", (e) => {
      const t = e.touches[0], mx = t.clientX - sx, my = t.clientY - sy;
      if (mode === "maybe-drag" && my > 8 && Math.abs(my) > Math.abs(mx)) mode = "drag";
      if (mode === "drag") { dy = Math.max(0, my); inner.style.transform = `translateY(${dy}px)`; inner.style.transition = "none"; }
    }, { passive: true });
    inner.addEventListener("touchend", (e) => {
      const t = e.changedTouches[0], mx = t.clientX - sx, my = t.clientY - sy;
      if (mode === "drag") {
        inner.style.transition = "";
        if (dy > 110) closeViewer(); else inner.style.transform = "";
      } else if (art.contains(e.target) && Math.abs(mx) > 50 && Math.abs(mx) > Math.abs(my) * 1.5) {
        // Swipe through this piece's photos first, then on to the next piece (like Instagram).
        const d = mx < 0 ? 1 : -1, n = photosOf(state.paintings[state.current]).length, next = state.photo + d;
        if (n > 1 && next >= 0 && next < n) showPhoto(next, d); else step(d);
      }
      mode = "";
    });
  })();

  function openFromHash() {
    const idx = state.paintings.findIndex((p) => `#${p.id}` === location.hash);
    if (idx >= 0) open(idx, { push: false });
  }
  window.addEventListener("hashchange", openFromHash);

  // Gentle 3D tilt on the hero painting for mouse users.
  (function tilt() {
    if (reduceMotion || !matchMedia("(pointer: fine)").matches) return;
    const hero = $(".hero");
    hero.addEventListener("pointermove", (e) => {
      const f = hero.querySelector(".tilt"); if (!f) return;
      const r = hero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      f.style.transform = `perspective(900px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg)`;
    });
    hero.addEventListener("pointerleave", () => { const f = hero.querySelector(".tilt"); if (f) f.style.transform = ""; });
  })();

  // Depth on scroll: the hero painting drifts slower than the page; framed pieces lean toward the cursor.
  (function depth() {
    if (reduceMotion) return;
    const art = $("#hero-art");
    let ticking = false;
    addEventListener("scroll", () => {
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => { const y = Math.min(scrollY, 900); art.style.translate = `0 ${y * 0.12}px`; ticking = false; });
    }, { passive: true });
    if (!matchMedia("(pointer: fine)").matches) return;
    const wall = $("#wall");
    wall.addEventListener("pointermove", (e) => {
      const f = e.target.closest(".piece .frame"); if (!f) return;
      const r = f.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      f.style.transform = `perspective(700px) translateY(-4px) rotateY(${x * 7}deg) rotateX(${-y * 7}deg)`;
    });
    wall.addEventListener("pointerout", (e) => { const f = e.target.closest && e.target.closest(".piece .frame"); if (f && !f.contains(e.relatedTarget)) f.style.transform = ""; });
  })();

  // Highlight the tab bar item for the section in view (phones).
  (function tabbar() {
    const links = [...document.querySelectorAll(".tabbar a[href^='#']")];
    if (!("IntersectionObserver" in window) || !links.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${en.target.id}`)); });
    }, { rootMargin: "-45% 0px -50% 0px" });
    ["gallery", "about", "buy"].forEach((id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  })();

  $("#year").textContent = new Date().getFullYear();

  // "no-cache" makes the browser check for a newer copy every visit, so admin edits show up right after each deploy.
  fetch("data/shop.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      state.paintings = data.paintings || [];
      state.artist = data.artist || {};
      state.pages = data.pages || null;
      const fmt = new Intl.NumberFormat("en-CA", { style: "currency", currency: state.artist.currency || "CAD", maximumFractionDigits: 2, minimumFractionDigits: 0 });
      money = (n) => fmt.format(n);
      applyInstagram(); renderPages(); renderHero(); renderFilters(); renderWall(); renderContact(); reconcileCart(); updateCartBadge(); openFromHash();
    })
    .catch(() => {
      $("#wall").replaceChildren(el("li", { class: "note", text: "The shop couldn’t load. Refresh the page to try again." }));
    });
})();
