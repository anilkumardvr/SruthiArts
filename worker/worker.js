// Sruthi Arts checkout server — a single-file Cloudflare Worker (no dependencies).
//
// What it does
//   POST /api/orders                 Cart checkout: check stock and real prices in the repo, add the delivery fee
//                                    (content/settings.json → shipping), then create a PayPal order.
//   POST /api/requests               PayPal.me mode: save the order + address, reserve the pieces, return the pay link.
//   POST /api/orders/:id/capture     Take the payment, lower each item's quantity in the repo (Sold at 0),
//                                    save the order with the delivery address, and send Sruthi a WhatsApp alert.
//   GET  /api/stock                  Public live stock: { items: { [id]: { quantity, status, price } } } read from
//                                    content/items/*.json in one GitHub GraphQL call, cached for 10 seconds (memory + edge).
//   GET  /api/auctions               Live and ended auctions: high bid, bid count, masked bidders, endsAt, status.
//   GET  /api/auctions/:id           One auction.
//   POST /api/auctions/:id/bid       Place a bid (needs a bidder token from /api/bidders/verify).
//   POST /api/bidders/start          { name, email } → emails a 6-digit code (Resend).
//   POST /api/bidders/verify         { email, code } → signed bidder token, valid 30 days.
//   GET  /api/pay/:number?t=         Auction winner's pay page data; POST …/delivery, …/paypal, …/capture to pay.
//   GET  /api/admin/orders           Orders list for the admin (GitHub login required).
//   GET  /api/admin/auctions         Auctions with full bidder details (admin). POST …/:id/close, …/:id/offer-next.
//   GET  /api/admin/paypal           PayPal setup check (admin): which credentials are set, sandbox or live.
//   PATCH /api/admin/orders/:key     Update an order: status (awaiting/new/packed/shipped/cancelled), tracking, note.
//   GET  /auth, /callback            "Continue with GitHub" login for the admin (Decap/Sveltia-compatible).
//   GET  /                           Health check: shows which features are configured.
//   Cron (hourly)                    Reminds Sruthi about unpaid PayPal.me orders at 36 hours; cancels orders still
//                                    unpaid after 48 hours (PayPal.me: stock goes back on sale).
//
// Settings (Cloudflare → Worker → Settings → Variables and Secrets). Secrets are marked (secret).
//   ALLOWED_ORIGINS            https://www.sruthiarts.com,https://sruthiarts.com   (comma-separated)
//   GITHUB_REPO                anilkumardvr/SruthiArts
//   GITHUB_BRANCH              main
//   GITHUB_TOKEN (secret)      fine-grained token: this repo only, Contents read/write — used to update stock
//   PAYPAL_ENV                 sandbox | live
//   PAYPAL_CLIENT_ID           from developer.paypal.com → Apps & Credentials
//   PAYPAL_CLIENT_SECRET (secret)
//   GITHUB_OAUTH_CLIENT_ID     GitHub OAuth App for admin login (optional)
//   GITHUB_OAUTH_CLIENT_SECRET (secret)
//   WhatsApp — pick one:
//     CALLMEBOT_PHONE (secret), CALLMEBOT_APIKEY (secret)                        free, via callmebot.com
//     WHATSAPP_TOKEN (secret), WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TO (secret),    official Meta Cloud API
//     WHATSAPP_TEMPLATE (default new_order), WHATSAPP_LANG (default en), WHATSAPP_API_VERSION (default v21.0)
//   Auctions: RESEND_API_KEY (secret), BIDDER_SECRET (secret, any long random string), RESEND_FROM (optional,
//     default "Sruthi Arts <auctions@sruthiarts.com>"), SHOP_URL (default: first ALLOWED_ORIGINS entry)
// Bindings: KV namespace "ORDERS" (stores orders privately; the repo is public, so buyer details never go there),
//   Durable Object "AUCTION" (class Auction, SQLite-backed: one per auction, holds its bids).

import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64encode = (str) => { let bin = ""; for (const b of enc.encode(str)) bin += String.fromCharCode(b); return btoa(bin); };
const b64decode = (b64) => dec.decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

// ---------- CORS ----------
function allowedOrigin(env, request) {
  const origin = request.headers.get("origin") || "";
  const list = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : "";
}
function cors(env, request) {
  const origin = allowedOrigin(env, request);
  return origin
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST,PATCH,OPTIONS", "access-control-allow-headers": "content-type,authorization", "access-control-max-age": "86400", vary: "origin" }
    : {};
}

// ---------- GitHub contents API ----------
async function gh(env, path, init = {}, token = env.GITHUB_TOKEN) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "sruthiarts-checkout", "x-github-api-version": "2022-11-28", ...(init.headers || {}) },
  });
  return res;
}
async function readRepoJson(env, file) {
  const res = await gh(env, `/repos/${env.GITHUB_REPO}/contents/${file}?ref=${env.GITHUB_BRANCH || "main"}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `GitHub read failed (${res.status})`);
  const body = await res.json();
  return { sha: body.sha, data: JSON.parse(b64decode(body.content)) };
}
async function writeRepoJson(env, file, data, sha, message) {
  return gh(env, `/repos/${env.GITHUB_REPO}/contents/${file}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, content: b64encode(JSON.stringify(data, null, 2) + "\n"), sha, branch: env.GITHUB_BRANCH || "main" }),
  });
}

// Same rule as scripts/build-data.mjs: quantity defaults to 1; status "sold" means 0 left.
const stockOf = (item) => (item.status === "sold" ? 0 : Number.isFinite(Number(item.quantity)) ? Math.max(0, Math.floor(Number(item.quantity))) : 1);
const itemFile = (id) => {
  if (!/^[a-z0-9-]{1,80}$/.test(id || "")) throw new HttpError(400, "Unknown item.", "bad_item");
  return `content/items/${id}.json`;
};

async function loadItem(env, id) {
  const file = await readRepoJson(env, itemFile(id));
  if (!file) throw new HttpError(404, "This item is no longer listed.", "not_found");
  return file;
}

// Lower the stock with optimistic locking (the file's sha). Retries if someone edited it at the same moment.
async function decrementStock(env, id, qty, orderId, label = "PayPal") {
  return changeStock(env, id, -qty, (t, left) => `Sale: ${t} ×${qty} (${label} ${orderId}) — ${left} left`);
}
// Put pieces back when an unpaid order is cancelled.
async function restock(env, id, qty, number) {
  return changeStock(env, id, qty, (t, left) => `Cancelled ${number}: ${t} back in stock (${left} available)`);
}
async function changeStock(env, id, delta, message) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { sha, data } = await loadItem(env, id);
    const left = Math.max(0, stockOf(data) + delta);
    const next = { ...data, quantity: left, status: left > 0 ? "available" : "sold" };
    const res = await writeRepoJson(env, itemFile(id), next, sha, message(data.title, left));
    if (res.ok) return { ok: true, left, title: data.title };
    if (res.status !== 409 && res.status !== 422) return { ok: false, error: `GitHub write failed (${res.status})` };
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  return { ok: false, error: "Could not update stock after several tries" };
}

// ---------- Live stock ----------
// Lets the shop show Studio changes to stock, sold/available and price within seconds, without waiting for a deploy.
// One GraphQL call returns every item file's text; the response is cached for 10 seconds (see stockResponse) so
// GitHub sees at most one request per 10 seconds per Worker isolate.
const STOCK_TTL = 10;
const STOCK_QUERY = `query($owner: String!, $name: String!, $expr: String!) {
  repository(owner: $owner, name: $name) { object(expression: $expr) { ... on Tree { entries { name object { ... on Blob { text } } } } } }
}`;
// Every item file, parsed: { [id]: item }. Files that aren't valid JSON are skipped.
async function readItems(env) {
  const [owner, name] = String(env.GITHUB_REPO || "").split("/");
  if (!owner || !name || !env.GITHUB_TOKEN) throw new Error("items: GITHUB_REPO or GITHUB_TOKEN not set");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, "content-type": "application/json", "user-agent": "sruthiarts-checkout" },
    body: JSON.stringify({ query: STOCK_QUERY, variables: { owner, name, expr: `${env.GITHUB_BRANCH || "main"}:content/items` } }),
  });
  if (!res.ok) throw new Error(`items: GitHub GraphQL ${res.status}`);
  const body = await res.json();
  const entries = body && body.data && body.data.repository && body.data.repository.object && body.data.repository.object.entries;
  if (body.errors || !Array.isArray(entries)) throw new Error(`items: GitHub GraphQL returned ${JSON.stringify(body.errors || "no tree").slice(0, 300)}`);
  const items = {};
  for (const e of entries) {
    const id = String(e.name || "").replace(/\.json$/, "");
    if (!e.name.endsWith(".json") || !/^[a-z0-9-]{1,80}$/.test(id) || !e.object || typeof e.object.text !== "string") continue;
    try { items[id] = JSON.parse(e.object.text); } catch { /* a half-saved file: the shop keeps its built value */ }
  }
  itemsMemo = { at: Date.now(), items };
  return items;
}
// Items for auctions, kept 10 seconds in memory like the stock (fresh = true skips the copy, for the admin).
let itemsMemo = null;
async function getItems(env, fresh = false) {
  if (!fresh && itemsMemo && Date.now() - itemsMemo.at < STOCK_TTL * 1000) return itemsMemo.items;
  return readItems(env);
}
async function readStock(env) {
  const all = await readItems(env);
  const items = {};
  for (const [id, item] of Object.entries(all)) {
    // Same rule as scripts/build-data.mjs: quantity defaults to 1; status "sold" means 0 left.
    const quantity = stockOf(item);
    items[id] = { quantity, status: quantity > 0 ? "available" : "sold", price: Number(item.price) };
  }
  return { items };
}
// Two cache layers, both 10 seconds. The Cache API (caches.default) does nothing on *.workers.dev addresses, only on a
// custom domain, so a copy is also kept in this isolate's memory. Each Cloudflare isolate has its own copy.
let stockMemo = null; // { at: ms timestamp, body: JSON text }
async function stockResponse(env, request, ctx) {
  const fresh = (body) => new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${STOCK_TTL}` } });
  if (stockMemo && Date.now() - stockMemo.at < STOCK_TTL * 1000) return fresh(stockMemo.body);
  const cache = caches.default;
  const key = new Request(new URL("/api/stock", request.url).toString(), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, hit);
  let body;
  try {
    body = JSON.stringify(await readStock(env));
  } catch (e) {
    console.log("stock failed", e.message);
    return new Response(null, { status: 503, headers: { "cache-control": "no-store" } });
  }
  stockMemo = { at: Date.now(), body };
  const res = fresh(body);
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ---------- PayPal ----------
const paypalBase = (env) => (env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
async function paypalToken(env) {
  const res = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new HttpError(502, "PayPal is unavailable right now. Please try again.", "paypal_auth");
  return (await res.json()).access_token;
}
async function paypal(env, path, body) {
  const token = await paypalToken(env);
  const res = await fetch(`${paypalBase(env)}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
const money = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

// ---------- Cart checkout ----------
// Delivery fees live in content/settings.json ("shipping"), so the server, not the browser, decides what's charged.
const shippingOf = (settings) => {
  const s = (settings && settings.shipping) || {};
  const fee = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return { CA: fee(s.CA, 15), US: fee(s.US, 25), intl: fee(s.intl, 40), pickup: s.pickup !== false, pickupNote: s.pickupNote || "" };
};
const clean = (v, max = 120) => String(v == null ? "" : v).replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function readDelivery(raw, ship) {
  const d = raw || {};
  const method = d.method === "pickup" ? "pickup" : "ship";
  const out = { method, name: clean(d.name, 80), email: clean(d.email, 120).toLowerCase(), phone: clean(d.phone, 30), note: clean(d.note, 300) };
  if (out.name.length < 2) throw new HttpError(400, "Please enter your full name.", "bad_name");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) throw new HttpError(400, "Please enter a valid email address.", "bad_email");
  if (method === "pickup") {
    if (!ship.pickup) throw new HttpError(400, "Pickup isn't available right now. Please choose delivery.", "no_pickup");
    if (!out.phone) throw new HttpError(400, "Please add a phone number so Sruthi can arrange the pickup.", "bad_phone");
    return out;
  }
  const a = d.address || {};
  const country = clean(a.country, 2).toUpperCase();
  out.address = { line1: clean(a.line1, 300), line2: clean(a.line2, 300), city: clean(a.city, 120), region: clean(a.region, 300), postal: clean(a.postal, 60).toUpperCase(), country };
  if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, "Please choose your country.", "bad_country");
  if (!out.address.line1 || !out.address.city) throw new HttpError(400, "Please enter your street address and city.", "bad_address");
  if (country === "CA" && !/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/.test(out.address.postal)) throw new HttpError(400, "Please enter a valid Canadian postal code, like M5V 2T6.", "bad_postal");
  if (country === "US" && !/^\d{5}(-\d{4})?$/.test(out.address.postal)) throw new HttpError(400, "Please enter a valid ZIP code.", "bad_postal");
  if ((country === "CA" || country === "US") && !/^[A-Z]{2}$/.test(out.address.region)) throw new HttpError(400, country === "CA" ? "Please choose your province." : "Please choose your state.", "bad_region");
  return out;
}
const feeFor = (delivery, ship) => (delivery.method === "pickup" ? 0 : delivery.address.country === "CA" ? ship.CA : delivery.address.country === "US" ? ship.US : ship.intl);
const addressText = (d) => (d.method === "pickup" ? "Pickup" : [d.address.line1, d.address.line2, d.address.city, d.address.region, d.address.postal, d.address.country].filter(Boolean).join(", "));

// Checks the cart against the repo (stock, real prices) and works out the delivery fee.
async function prepareCart(env, body) {
  // Older pages send one item as { itemId, quantity }.
  const rawItems = Array.isArray(body.items) ? body.items : body.itemId ? [{ id: body.itemId, qty: body.quantity || 1 }] : [];
  const wanted = new Map();
  for (const it of rawItems) {
    const qty = Math.floor(Number(it && it.qty));
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new HttpError(400, "Choose a quantity between 1 and 20.", "bad_qty");
    itemFile(it.id);
    wanted.set(it.id, (wanted.get(it.id) || 0) + qty);
  }
  if (!wanted.size) throw new HttpError(400, "Your cart is empty.", "empty");
  if (wanted.size > 20) throw new HttpError(400, "Please order at most 20 different pieces at a time.", "too_many");

  const settingsFile = await readRepoJson(env, "content/settings.json");
  const settings = (settingsFile && settingsFile.data) || {};
  const ship = shippingOf(settings);
  const delivery = body.delivery ? readDelivery(body.delivery, ship) : null;
  if (!delivery && Array.isArray(body.items)) throw new HttpError(400, "Please add your delivery details.", "no_delivery");
  const currency = settings.currency || "CAD";

  const lines = [];
  for (const [id, qty] of wanted) {
    const { data: item } = await loadItem(env, id);
    if (item.auction) throw new HttpError(409, `“${item.title}” is being auctioned, so it can't be bought from the cart. Place a bid instead.`, "auction");
    const left = stockOf(item);
    if (left < 1) throw new HttpError(409, `Sorry, “${item.title}” has just sold out. Please remove it from your cart.`, "sold_out");
    if (qty > left) throw new HttpError(409, `Only ${left} of “${item.title}” left. Please lower the quantity.`, "not_enough");
    const price = Number(item.price);
    if (!(price > 0)) throw new HttpError(400, `“${item.title}” has no price yet.`, "no_price");
    lines.push({ id, title: String(item.title).slice(0, 120), qty, price: Number(money(price)), image: item.image || "" });
  }
  const subtotal = Number(money(lines.reduce((t, l) => t + l.price * l.qty, 0)));
  const shipping = delivery ? Number(money(feeFor(delivery, ship))) : 0;
  const total = money(subtotal + shipping);
  return { lines, delivery, subtotal, shipping, total, currency, settings };
}

async function createOrder(env, request) {
  const body = await request.json().catch(() => ({}));
  const { lines, delivery, subtotal, shipping, total, currency } = await prepareCart(env, body);

  const unit = {
    reference_id: "cart",
    custom_id: lines.length === 1 ? `${lines[0].id}|${lines[0].qty}` : "cart",
    description: (lines.length === 1 ? lines[0].title : `${lines.length} pieces from Sruthi Arts`).slice(0, 127),
    amount: { currency_code: currency, value: total, breakdown: { item_total: { currency_code: currency, value: money(subtotal) }, shipping: { currency_code: currency, value: money(shipping) } } },
    items: lines.map((l) => ({ name: l.title, sku: l.id.slice(0, 127), quantity: String(l.qty), unit_amount: { currency_code: currency, value: money(l.price) }, category: "PHYSICAL_GOODS" })),
  };
  if (delivery && delivery.method === "ship") {
    const a = delivery.address;
    unit.shipping = { type: "SHIPPING", name: { full_name: delivery.name.slice(0, 300) }, address: { address_line_1: a.line1, ...(a.line2 ? { address_line_2: a.line2 } : {}), admin_area_2: a.city, ...(a.region ? { admin_area_1: a.region } : {}), ...(a.postal ? { postal_code: a.postal } : {}), country_code: a.country } };
  }
  const res = await paypal(env, "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [unit],
    application_context: {
      brand_name: "Sruthi Arts",
      shipping_preference: !delivery ? "GET_FROM_FILE" : delivery.method === "ship" ? "SET_PROVIDED_ADDRESS" : "NO_SHIPPING",
      user_action: "PAY_NOW",
    },
  });
  if (!res.ok) {
    const issue = res.data && res.data.details && res.data.details[0] && res.data.details[0].issue;
    console.log("paypal create failed", res.status, JSON.stringify(res.data).slice(0, 800));
    if (/ADDRESS|POSTAL|COUNTRY|STATE|CITY/i.test(issue || "")) throw new HttpError(400, "PayPal couldn't accept this address. Please check the postal code, province/state and country.", "paypal_address");
    throw new HttpError(502, "PayPal couldn't start the checkout. Please try again.", "paypal_create");
  }
  // Keep the cart and delivery details privately until the payment is captured (3 hours).
  if (env.ORDERS) await env.ORDERS.put(`pending:${res.data.id}`, JSON.stringify({ lines, delivery, subtotal, shipping, currency }), { expirationTtl: 3 * 3600 });
  return json({ id: res.data.id, subtotal, shipping, total: Number(total), currency });
}

// ---------- PayPal.me orders (no PayPal Business account needed) ----------
// The customer places the order with their address, the pieces are reserved, and they pay the total on
// Sruthi's PayPal.me link. Sruthi marks it Paid in the studio once the money arrives (or Cancelled, which restocks).
const paypalMeUser = (v) => String(v || "").trim().replace(/^https?:\/\/(www\.)?paypal\.me\//i, "").replace(/^paypal\.me\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");

async function rateLimited(env, request) {
  if (!env.ORDERS) return false;
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const key = `rl:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const n = Number((await env.ORDERS.get(key)) || 0);
  if (n >= 6) return true;
  await env.ORDERS.put(key, String(n + 1), { expirationTtl: 3700 });
  return false;
}

async function placeRequest(env, request, ctx) {
  if (!env.ORDERS) throw new HttpError(503, "Orders can't be saved right now. Please message Sruthi on Instagram.", "no_storage");
  if (await rateLimited(env, request)) throw new HttpError(429, "Too many orders from this connection. Please try again later or message Sruthi.", "rate");
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.items)) throw new HttpError(400, "Your cart is empty.", "empty");
  const { lines, delivery, subtotal, shipping, total, currency, settings } = await prepareCart(env, body);
  const user = paypalMeUser(settings.paypal);
  if (!user) throw new HttpError(503, "Online payment isn't set up yet. Please message Sruthi on Instagram.", "no_paypal");
  const now = Date.now();
  const number = orderNumber();
  // Reserve the pieces so nobody else buys them while this customer pays.
  const stock = [];
  for (const l of lines) {
    const r = await decrementStock(env, l.id, l.qty, number, "Order").catch((e) => ({ ok: false, error: e.message }));
    if (r.title) l.title = r.title;
    stock.push({ id: l.id, left: r.ok ? r.left : null, error: r.ok ? "" : r.error });
  }
  const order = {
    number, orderId: number, payment: "paypalme", items: lines, subtotal, shipping, amount: total, currency, delivery,
    addressText: addressText(delivery), buyer: { name: delivery.name, email: delivery.email }, stock,
    stockTaken: stock.every((x) => x.left !== null), status: "awaiting", tracking: "", createdAt: new Date(now).toISOString(),
  };
  const key = `order:${String(9999999999999 - now).padStart(13, "0")}:${number.replace(/[^A-Z0-9]/g, "")}`;
  await env.ORDERS.put(key, JSON.stringify(order));
  await env.ORDERS.put(`ordnum:${number}`, key);
  ctx.waitUntil(notifyWhatsApp(env, order).catch((e) => console.log("whatsapp failed", e.message)));
  return json({ ok: true, number, total: Number(total), currency, payUrl: `https://www.paypal.me/${encodeURIComponent(user)}/${total}${currency}`, items: lines.map((l) => ({ id: l.id, title: l.title, qty: l.qty })), method: delivery.method, stock });
}

// Short, readable order number, e.g. SA-K3F9QZ2B (time-based plus two random characters so it never repeats).
const orderNumber = () => `SA-${Date.now().toString(36).toUpperCase().slice(-6)}${Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("")}`;

async function captureOrder(env, orderId, ctx) {
  if (!/^[A-Z0-9]{5,40}$/.test(orderId)) throw new HttpError(400, "Unknown order.", "bad_order");
  const res = await paypal(env, `/v2/checkout/orders/${orderId}/capture`);
  const issue = res.data && res.data.details && res.data.details[0] && res.data.details[0].issue;
  if (issue === "INSTRUMENT_DECLINED") return json({ error: "Your payment method was declined. Please try another.", code: "declined", restart: true }, 402);
  if (!res.ok || res.data.status !== "COMPLETED") throw new HttpError(502, "The payment didn't go through. You have not been charged.", issue || "capture_failed");

  const pu = res.data.purchase_units[0];
  const capture = pu.payments.captures[0];
  const pending = env.ORDERS ? JSON.parse((await env.ORDERS.get(`pending:${orderId}`)) || "null") : null;
  let lines = pending && pending.lines;
  if (!lines) {
    // No saved cart (older single-item page): read it from PayPal's record.
    const [itemId, qtyStr] = String(capture.custom_id || pu.custom_id || "").split("|");
    lines = itemId && itemId !== "cart" ? [{ id: itemId, title: itemId, qty: Math.max(1, Number(qtyStr) || 1), price: 0, image: "" }] : [];
  }
  const stock = [];
  for (const l of lines) {
    const r = await decrementStock(env, l.id, l.qty, orderId).catch((e) => ({ ok: false, error: e.message }));
    if (r.title) l.title = r.title;
    stock.push({ id: l.id, left: r.ok ? r.left : null, error: r.ok ? "" : r.error });
  }

  const payer = res.data.payer || {};
  const ppShip = pu.shipping || {};
  const delivery = (pending && pending.delivery) || {
    method: "ship", name: (ppShip.name && ppShip.name.full_name) || "", email: payer.email_address || "", phone: "", note: "",
    address: { line1: (ppShip.address || {}).address_line_1 || "", line2: (ppShip.address || {}).address_line_2 || "", city: (ppShip.address || {}).admin_area_2 || "", region: (ppShip.address || {}).admin_area_1 || "", postal: (ppShip.address || {}).postal_code || "", country: (ppShip.address || {}).country_code || "" },
  };
  const now = Date.now();
  const order = {
    number: orderNumber(),
    orderId,
    captureId: capture.id,
    items: lines,
    subtotal: pending ? pending.subtotal : Number(capture.amount.value),
    shipping: pending ? pending.shipping : 0,
    amount: capture.amount.value,
    currency: capture.amount.currency_code,
    delivery,
    addressText: addressText(delivery),
    buyer: { name: [payer.name && payer.name.given_name, payer.name && payer.name.surname].filter(Boolean).join(" "), email: payer.email_address || "" },
    // Who paid, as PayPal reports it (can differ from the delivery name).
    payment: "paypal",
    payer: { name: [payer.name && payer.name.given_name, payer.name && payer.name.surname].filter(Boolean).join(" "), email: payer.email_address || "", payerId: payer.payer_id || "", captureId: capture.id },
    paidAt: new Date(now).toISOString(),
    stock,
    status: "new",
    tracking: "",
    createdAt: new Date(now).toISOString(),
  };
  const key = `order:${String(9999999999999 - now).padStart(13, "0")}:${orderId}`;
  if (env.ORDERS) {
    await env.ORDERS.put(key, JSON.stringify(order));
    ctx.waitUntil(env.ORDERS.delete(`pending:${orderId}`));
  }
  ctx.waitUntil(notifyWhatsApp(env, order).catch((e) => console.log("whatsapp failed", e.message)));
  return json({ ok: true, orderId, number: order.number, items: lines.map((l) => ({ id: l.id, title: l.title, qty: l.qty })), total: order.amount, currency: order.currency, method: delivery.method, buyerName: delivery.name || order.buyer.name, stock });
}

// ---------- WhatsApp ----------
async function notifyWhatsApp(env, o) {
  const line = (s) => String(s || "—").replace(/\s+/g, " ").trim();
  const what = o.items.map((l) => `${l.title} x${l.qty}`).join(", ");
  const d = o.delivery;
  const where = d.method === "pickup" ? "Customer will pick up (message them to arrange)" : o.addressText;
  const stockNote = o.stock.some((s) => s.left === null)
    ? "Stock NOT updated for some items — check the studio."
    : o.stock.filter((s) => s.left === 0).length ? `Now sold out: ${o.stock.filter((s) => s.left === 0).map((s) => (o.items.find((l) => l.id === s.id) || {}).title || s.id).join(", ")}` : "Stock updated.";
  if (env.CALLMEBOT_PHONE && env.CALLMEBOT_APIKEY) {
    const text = [
      `New order ${o.number}: ${what}`,
      o.status === "awaiting"
        ? `To pay by PayPal.me: ${o.amount} ${o.currency}${o.shipping ? ` (incl. ${o.shipping} delivery)` : ""} — check PayPal, then mark Paid in the studio`
        : `Paid: ${o.amount} ${o.currency}${o.shipping ? ` (incl. ${o.shipping} delivery)` : ""}`,
      `Customer: ${line(d.name)} · ${line(d.email)}${d.phone ? ` · ${d.phone}` : ""}`,
      d.method === "pickup" ? `Pickup: ${where}` : `Ship to: ${line(d.name)}, ${line(where)}`,
      d.note ? `Note: ${line(d.note)}` : "",
      stockNote,
    ].filter(Boolean).join("\n");
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(env.CALLMEBOT_PHONE)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(env.CALLMEBOT_APIKEY)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CallMeBot ${res.status}`);
    return;
  }
  if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_TO) {
    // Template body must have 4 variables, e.g. "New order: {{1}} for {{2}}. Buyer: {{3}}. Ship to: {{4}}."
    const params = [`${o.number} ${what}`, `${o.amount} ${o.currency}`, `${line(d.name)} ${line(d.email)} ${d.phone || ""}`, `${line(where)}. ${stockNote}`];
    const res = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION || "v21.0"}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: env.WHATSAPP_TO,
        type: "template",
        template: { name: env.WHATSAPP_TEMPLATE || "new_order", language: { code: env.WHATSAPP_LANG || "en" }, components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text.slice(0, 1000) })) }] },
      }),
    });
    if (!res.ok) throw new Error(`WhatsApp Cloud API ${res.status}: ${await res.text()}`);
  }
}

// ---------- Admin (orders) ----------
async function requireAdmin(env, request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please log in again.", "no_token");
  const res = await gh(env, `/repos/${env.GITHUB_REPO}`, {}, token);
  const body = res.ok ? await res.json() : {};
  if (!body.permissions || !body.permissions.push) throw new HttpError(403, "This GitHub account can't manage the shop.", "forbidden");
}
const STATUSES = ["awaiting", "new", "packed", "shipped", "cancelled"];
async function listOrders(env) {
  if (!env.ORDERS) return json({ orders: [], note: "Orders storage (KV) is not connected yet." });
  const keys = [];
  let cursor;
  do { const page = await env.ORDERS.list({ prefix: "order:", limit: 1000, cursor }); keys.push(...page.keys); cursor = page.list_complete ? null : page.cursor; } while (cursor && keys.length < 5000);
  const orders = await Promise.all(keys.map(async (k) => ({ key: k.name, ...JSON.parse((await env.ORDERS.get(k.name)) || "{}") })));
  return json({ orders });
}
async function updateOrder(env, request, key) {
  if (!env.ORDERS || !/^order:[0-9]{13}:[A-Z0-9]+$/.test(key)) throw new HttpError(404, "Order not found.", "not_found");
  const body = await request.json().catch(() => ({}));
  const current = await env.ORDERS.get(key);
  if (!current) throw new HttpError(404, "Order not found.", "not_found");
  const patch = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new HttpError(400, `Status must be one of ${STATUSES.join(", ")}.`, "bad_status");
    patch.status = body.status;
  }
  if (body.tracking !== undefined) patch.tracking = clean(body.tracking, 200);
  if (body.adminNote !== undefined) patch.adminNote = clean(body.adminNote, 500);
  const prev = JSON.parse(current);
  // PayPal.me payments are checked by hand, so the studio records who paid and the PayPal transaction ID.
  if (body.payer && typeof body.payer === "object") {
    patch.payer = { ...(prev.payer || {}), name: clean(body.payer.name, 80), email: clean(body.payer.email, 120).toLowerCase(), captureId: clean(body.payer.captureId, 40).toUpperCase() };
  }
  if (patch.status === "new" && prev.status === "awaiting") patch.paidAt = new Date().toISOString();
  let order = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  // Cancelling an order puts its reserved pieces back; restoring it reserves them again.
  if (patch.status === "cancelled" && order.stockTaken) {
    for (const l of order.items || []) await restock(env, l.id, Number(l.qty) || 1, order.number).catch((e) => console.log("restock failed", e.message));
    order.stockTaken = false;
  } else if (patch.status && patch.status !== "cancelled" && JSON.parse(current).status === "cancelled" && !order.stockTaken) {
    for (const l of order.items || []) await decrementStock(env, l.id, Number(l.qty) || 1, order.number, "Restored").catch((e) => console.log("re-reserve failed", e.message));
    order.stockTaken = true;
  }
  await env.ORDERS.put(key, JSON.stringify(order));
  return json({ key, ...order });
}

// ---------- GitHub OAuth for the admin (Decap/Sveltia popup protocol) ----------
function oauthStart(env, request) {
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const scope = url.searchParams.get("scope") || "public_repo";
  const auth = new URL("https://github.com/login/oauth/authorize");
  auth.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID);
  auth.searchParams.set("scope", scope);
  auth.searchParams.set("state", state);
  auth.searchParams.set("redirect_uri", `${url.origin}/callback`);
  return new Response(null, { status: 302, headers: { location: auth.toString(), "set-cookie": `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
}
async function oauthCallback(env, request) {
  const url = new URL(request.url);
  const cookie = (request.headers.get("cookie") || "").match(/oauth_state=([^;]+)/);
  let payload;
  if (!cookie || cookie[1] !== url.searchParams.get("state")) {
    payload = `authorization:github:error:${JSON.stringify({ message: "Login expired. Please try again." })}`;
  } else {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: env.GITHUB_OAUTH_CLIENT_ID, client_secret: env.GITHUB_OAUTH_CLIENT_SECRET, code: url.searchParams.get("code") }),
    });
    const data = await res.json().catch(() => ({}));
    payload = data.access_token
      ? `authorization:github:success:${JSON.stringify({ token: data.access_token, provider: "github" })}`
      : `authorization:github:error:${JSON.stringify({ message: data.error_description || "GitHub login failed." })}`;
  }
  const origins = JSON.stringify((env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean));
  const html = `<!doctype html><meta charset="utf-8"><title>Signing in…</title><p style="font:16px system-ui;padding:24px">Signing in…</p><script>
const allowed = ${origins}; const msg = ${JSON.stringify(payload)};
function receive(e) { if (!allowed.includes(e.origin)) return; window.opener.postMessage(msg, e.origin); window.removeEventListener("message", receive); setTimeout(() => window.close(), 200); }
window.addEventListener("message", receive);
allowed.forEach((o) => window.opener && window.opener.postMessage("authorizing:github", o));
</script>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "oauth_state=; Path=/; Max-Age=0" } });
}

// ---------- Shared helpers for auctions and payments ----------
const HOUR = 3600 * 1000;
const PAY_WINDOW_MS = 48 * HOUR; // unpaid orders (PayPal.me and auction wins) lapse after this
const SNIPE_MS = 2 * 60 * 1000; // a bid in the last 2 minutes pushes the end to now + 2 minutes
const BIDDER_TTL_MS = 30 * 24 * HOUR;
const CODE_TTL_S = 600;
const iso = (ms) => new Date(ms).toISOString();
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const ipOf = (request) => request.headers.get("cf-connecting-ip") || "local";
const orderKey = (now, number) => `order:${String(9999999999999 - now).padStart(13, "0")}:${number.replace(/[^A-Z0-9]/g, "")}`;
const shopUrl = (env) => (env.SHOP_URL || String(env.ALLOWED_ORIGINS || "").split(",")[0] || "").trim().replace(/\/+$/, "");
// "Priya" → "Pr***": enough to recognise your own bid, not enough to identify anyone.
const mask = (name) => `${String(name || "?").trim().slice(0, 2)}***`;
const fmtMoney = (n, currency) => { try { return new Intl.NumberFormat("en-CA", { style: "currency", currency: currency || "CAD", maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n); } catch { return `$${n}`; } };

const b64url = (buf) => { let bin = ""; for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64url = (s) => { const t = String(s).replace(/-/g, "+").replace(/_/g, "/"); return dec.decode(Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0))); };
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}
const sha256 = async (text) => b64url(await crypto.subtle.digest("SHA-256", enc.encode(text)));
const safeEqual = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(18)));

// Counts requests per key in KV; false once the limit is reached. KV is eventually consistent, so limits are approximate.
async function underLimit(env, key, limit, ttlSeconds) {
  const n = Number((await env.ORDERS.get(key)) || 0);
  if (n >= limit) return false;
  await env.ORDERS.put(key, String(n + 1), { expirationTtl: Math.max(60, ttlSeconds) });
  return true;
}

// ---------- Email (Resend) ----------
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const textToHtml = (t) => `<div style="font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#3b1d2c;max-width:560px">${escHtml(t).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>").replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#a8325e">$1</a>')}</p>`).join("")}</div>`;
async function sendEmail(env, to, subject, text) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.RESEND_FROM || "Sruthi Arts <auctions@sruthiarts.com>", to: [to], subject, text, html: textToHtml(text) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// A short WhatsApp note to Sruthi (auctions, released orders). CallMeBot takes free text; the Cloud API template
// has four variables, so the lines are folded into those.
async function notifyText(env, lines) {
  lines = lines.filter(Boolean).map((l) => String(l).replace(/\s+/g, " ").trim());
  if (env.CALLMEBOT_PHONE && env.CALLMEBOT_APIKEY) {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(env.CALLMEBOT_PHONE)}&text=${encodeURIComponent(lines.join("\n"))}&apikey=${encodeURIComponent(env.CALLMEBOT_APIKEY)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CallMeBot ${res.status}`);
    return;
  }
  if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_TO) {
    const params = [lines[0] || "-", lines[1] || "-", lines[2] || "-", lines.slice(3).join(" · ") || "-"];
    const res = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION || "v21.0"}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: env.WHATSAPP_TO, type: "template", template: { name: env.WHATSAPP_TEMPLATE || "new_order", language: { code: env.WHATSAPP_LANG || "en" }, components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text.slice(0, 1000) })) }] } }),
    });
    if (!res.ok) throw new Error(`WhatsApp Cloud API ${res.status}`);
  }
}
// Shop settings (currency, delivery fees, PayPal), kept a minute in memory for bid notifications.
let settingsMemo = null;
async function getSettings(env) {
  if (settingsMemo && Date.now() - settingsMemo.at < 60000) return settingsMemo.data;
  const data = ((await readRepoJson(env, "content/settings.json")) || {}).data || {};
  settingsMemo = { at: Date.now(), data };
  return data;
}
const quietly = (p, what) => p.catch((e) => console.log(`${what} failed`, e.message));

// ---------- Bidders: email code → signed token ----------
function biddingReady(env) {
  if (!env.ORDERS || !env.RESEND_API_KEY || !env.BIDDER_SECRET || !env.AUCTION) throw new HttpError(503, "Bidding isn't set up yet. Please message Sruthi on Instagram.", "no_bidding");
}
const readEmail = (v) => {
  const email = clean(v, 120).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Please enter a valid email address.", "bad_email");
  return email;
};

async function bidderStart(env, request) {
  biddingReady(env);
  const body = await request.json().catch(() => ({}));
  const name = clean(body.name, 60);
  if (name.length < 2) throw new HttpError(400, "Please enter your name.", "bad_name");
  const email = readEmail(body.email);
  const eh = await sha256(email);
  if (!(await underLimit(env, `rl:bstart:ip:${ipOf(request)}:${iso(Date.now()).slice(0, 13)}`, 10, 3700))) throw new HttpError(429, "Too many codes requested from this connection. Please try again in an hour.", "rate");
  if (!(await underLimit(env, `rl:bstart:em:${eh}:${Math.floor(Date.now() / 600000)}`, 3, 660))) throw new HttpError(429, "We've just sent codes to this email. Check your inbox (and spam), or try again in 10 minutes.", "rate");
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  await env.ORDERS.put(`bcode:${eh}`, JSON.stringify({ h: await hmac(env.BIDDER_SECRET, `${email}:${code}`), name, exp: Date.now() + CODE_TTL_S * 1000, tries: 0 }), { expirationTtl: CODE_TTL_S });
  try {
    await sendEmail(env, email, `Your Sruthi Arts bidding code: ${code}`, `Hi ${name},\n\nYour code is ${code}\n\nEnter it on the auction page to start bidding. It expires in 10 minutes.\n\nIf you didn't ask for this, you can ignore this email.\n\nSruthi Arts`);
  } catch (e) {
    console.log("code email failed", e.message);
    throw new HttpError(502, "We couldn't send the email right now. Please try again in a minute.", "email_failed");
  }
  return json({ ok: true });
}

async function bidderVerify(env, request) {
  biddingReady(env);
  const body = await request.json().catch(() => ({}));
  const email = readEmail(body.email);
  const eh = await sha256(email);
  if (!(await underLimit(env, `rl:bverify:ip:${ipOf(request)}:${iso(Date.now()).slice(0, 13)}`, 30, 3700))) throw new HttpError(429, "Too many tries from this connection. Please try again in an hour.", "rate");
  if (!(await underLimit(env, `rl:bverify:em:${eh}:${Math.floor(Date.now() / 600000)}`, 10, 660))) throw new HttpError(429, "Too many tries for this email. Please wait 10 minutes and ask for a new code.", "rate");
  const key = `bcode:${eh}`;
  const rec = JSON.parse((await env.ORDERS.get(key)) || "null");
  if (!rec || rec.exp < Date.now()) throw new HttpError(400, "That code has expired. Ask for a new one.", "code_expired");
  if (rec.tries >= 5) { await env.ORDERS.delete(key); throw new HttpError(400, "Too many wrong tries. Ask for a new code.", "code_locked"); }
  const code = String(body.code || "").replace(/\D/g, "");
  if (!safeEqual(await hmac(env.BIDDER_SECRET, `${email}:${code}`), rec.h)) {
    rec.tries++;
    await env.ORDERS.put(key, JSON.stringify(rec), { expirationTtl: Math.max(60, Math.ceil((rec.exp - Date.now()) / 1000)) });
    throw new HttpError(400, "That code isn't right. Check the email and try again.", "bad_code");
  }
  await env.ORDERS.delete(key);
  const exp = Date.now() + BIDDER_TTL_MS;
  const payload = b64url(enc.encode(JSON.stringify({ n: rec.name, e: email, x: exp })));
  return json({ token: `${payload}.${await hmac(env.BIDDER_SECRET, payload)}`, name: rec.name, email, expires: iso(exp) });
}

async function bidderFrom(env, request) {
  const [payload, sig] = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").split(".");
  const expired = new HttpError(401, "Please confirm your email to bid.", "bidder_needed");
  if (!payload || !sig || !safeEqual(await hmac(env.BIDDER_SECRET, payload), sig)) throw expired;
  let data;
  try { data = JSON.parse(unb64url(payload)); } catch { throw expired; }
  if (!data || !(data.x > Date.now()) || !data.e) throw expired;
  return { name: String(data.n || "").slice(0, 60), email: String(data.e).slice(0, 120) };
}

// ---------- Auction listings (content/items/<id>.json → "auction") ----------
function auctionCfg(id, item) {
  const a = item && item.auction;
  if (!a || typeof a !== "object") return null;
  const start = Number(a.start), increment = Number(a.increment), endsAt = Date.parse(a.endsAt);
  if (!(start > 0) || !(increment > 0) || !Number.isFinite(endsAt)) return null;
  return { id, title: String(item.title || id).slice(0, 120), image: item.image || "", start: round2(start), increment: round2(increment), endsAt, reserve: Number(a.reserve) > 0 ? round2(a.reserve) : 0 };
}
async function auctionConfigs(env, fresh = false) {
  const items = await getItems(env, fresh);
  return Object.entries(items).map(([id, item]) => auctionCfg(id, item)).filter(Boolean);
}
async function auctionConfig(env, id, fresh = false) {
  itemFile(id);
  const cfg = auctionCfg(id, (await getItems(env, fresh))[id]);
  if (!cfg) throw new HttpError(404, "This auction isn't listed.", "not_found");
  return cfg;
}
function auctionStub(env, id) {
  if (!env.AUCTION) throw new HttpError(503, "Auctions aren't set up yet.", "no_auctions");
  return env.AUCTION.get(env.AUCTION.idFromName(id));
}

// ---------- Durable Object: one per auction ----------
// Holds the bids in its own SQLite database and takes them one at a time, so two bids at the same moment can't
// both win. An alarm fires at endsAt to close the auction.
export class Auction extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS bids (id INTEGER PRIMARY KEY AUTOINCREMENT, amount REAL NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, at INTEGER NOT NULL)");
  }
  get(k, fallback = null) { const r = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0]; return r ? JSON.parse(r.v) : fallback; }
  put(k, v) { this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, JSON.stringify(v)); }
  top() { return this.sql.exec("SELECT id, amount, name, email, at FROM bids ORDER BY amount DESC, id ASC LIMIT 1").toArray()[0] || null; }

  // Applies the listing from the item file, so edits in the Studio (increment, reserve, end time) take effect.
  // Changing the end time of an auction that ended without a winner starts it again with no bids.
  async sync(cfg) {
    const cur = this.get("cfg");
    if (!cur) {
      this.put("cfg", cfg); this.put("endsAt", cfg.endsAt); this.put("status", "live"); this.put("offers", []);
      await this.ctx.storage.setAlarm(cfg.endsAt);
      return;
    }
    const next = { ...cur, id: cfg.id, title: cfg.title, image: cfg.image, start: cfg.start, increment: cfg.increment, reserve: cfg.reserve };
    if (cfg.endsAt !== cur.endsAt) {
      next.endsAt = cfg.endsAt;
      const status = this.get("status");
      if (status === "live") { this.put("endsAt", cfg.endsAt); await this.ctx.storage.setAlarm(cfg.endsAt); }
      else if (status === "ended" && cfg.endsAt > Date.now()) {
        this.sql.exec("DELETE FROM bids");
        this.put("endsAt", cfg.endsAt); this.put("status", "live"); this.put("offers", []);
        await this.ctx.storage.setAlarm(cfg.endsAt);
      }
    }
    this.put("cfg", next);
  }

  publicState() {
    const cfg = this.get("cfg"), status = this.get("status"), top = this.top();
    const count = this.sql.exec("SELECT count(*) AS c FROM bids").one().c;
    const recent = this.sql.exec("SELECT amount, name, at FROM bids ORDER BY id DESC LIMIT 20").toArray();
    return {
      id: cfg.id, status: status === "awarding" ? "won" : status, endsAt: iso(this.get("endsAt")), now: iso(Date.now()),
      start: cfg.start, increment: cfg.increment, high: top ? top.amount : null, count, leader: top ? mask(top.name) : null,
      minNext: top ? round2(top.amount + cfg.increment) : cfg.start,
      reserve: cfg.reserve ? (top && top.amount >= cfg.reserve ? "met" : "not_met") : "none",
      bids: recent.map((b) => ({ name: mask(b.name), amount: b.amount, at: iso(b.at) })),
    };
  }
  async state(cfg) { await this.sync(cfg); return this.publicState(); }

  async bid(cfg, bidder, amount) {
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.sync(cfg);
      const now = Date.now(), endsAt = this.get("endsAt");
      if (this.get("status") !== "live" || now >= endsAt) return { ok: false, code: "ended", error: "This auction has ended.", state: this.publicState() };
      const top = this.top();
      const min = top ? round2(top.amount + cfg.increment) : cfg.start;
      if (!(amount >= min)) return { ok: false, code: "too_low", min, error: `Your bid must be at least ${min}.`, state: this.publicState() };
      this.sql.exec("INSERT INTO bids (amount, name, email, at) VALUES (?, ?, ?, ?)", amount, bidder.name, bidder.email, now);
      let extended = false;
      if (endsAt - now < SNIPE_MS) { this.put("endsAt", now + SNIPE_MS); await this.ctx.storage.setAlarm(now + SNIPE_MS); extended = true; }
      const previous = top && top.email !== bidder.email ? { name: top.name, email: top.email, amount: top.amount } : null;
      return { ok: true, extended, previous, state: this.publicState() };
    });
  }

  async adminState(cfg) {
    await this.sync(cfg);
    const all = this.sql.exec("SELECT id, amount, name, email, at FROM bids ORDER BY amount DESC, id ASC").toArray();
    return { ...this.publicState(), statusRaw: this.get("status"), title: cfg.title, reserveAmount: cfg.reserve, allBids: all.map((b) => ({ ...b, at: iso(b.at) })), offers: this.get("offers", []) };
  }

  // Studio "Close now": end it at once, as if the time had run out.
  async close(cfg) {
    await this.sync(cfg);
    if (this.get("status") === "live") { this.put("endsAt", Date.now()); await this.finish(); }
    return this.adminState(cfg);
  }

  // Studio "Offer to next bidder": the next highest bidder who hasn't been offered it yet gets 48 hours to pay.
  async offerNext(cfg) {
    await this.sync(cfg);
    if (this.get("status") !== "won") return { ok: false, code: "not_won", error: "Only an auction that has a winner can be offered to the next bidder." };
    const offers = this.get("offers", []);
    const used = new Set(offers.map((o) => o.email));
    const next = this.sql.exec("SELECT id, amount, name, email, at FROM bids ORDER BY amount DESC, id ASC").toArray().find((b) => !used.has(b.email));
    if (!next) return { ok: false, code: "none", error: "There's no other bidder to offer it to." };
    offers.push({ bidId: next.id, name: next.name, email: next.email, amount: next.amount, rank: offers.length + 1, number: orderNumber(), awarded: false, at: iso(Date.now()) });
    this.put("offers", offers); this.put("status", "awarding");
    await this.finish();
    return { ok: true, offer: this.get("offers").at(-1), state: await this.adminState(cfg) };
  }

  async alarm() {
    const status = this.get("status");
    if (!this.get("cfg")) return;
    if (status === "live") {
      const endsAt = this.get("endsAt");
      if (Date.now() < endsAt) { await this.ctx.storage.setAlarm(endsAt); return; } // extended since this alarm was set
      await this.finish();
    } else if (status === "awarding") await this.finish(); // a previous try failed part-way; the alarm retries
  }

  // Close the auction: a winner if the reserve is met, else "ended". Awarding creates the order, marks the piece
  // sold and emails the winner. Each step is recorded, so a retry after a failure picks up where it stopped.
  async finish() {
    const cfg = this.get("cfg");
    if (this.get("status") === "live") {
      const top = this.top();
      if (top && (!cfg.reserve || top.amount >= cfg.reserve)) {
        this.put("offers", [{ bidId: top.id, name: top.name, email: top.email, amount: top.amount, rank: 1, number: orderNumber(), awarded: false, at: iso(Date.now()) }]);
        this.put("status", "awarding");
      } else {
        this.put("status", "ended");
        const count = this.sql.exec("SELECT count(*) AS c FROM bids").one().c;
        const currency = (await getSettings(this.env).catch(() => ({}))).currency || "CAD";
        await quietly(notifyText(this.env, [`Auction ended: ${cfg.title}`, top ? `Reserve not met. Highest bid ${fmtMoney(top.amount, currency)} (${count} bids).` : "No bids.", "Nothing was sold. Relist it or set a new end time in the studio."]), "whatsapp");
        return;
      }
    }
    if (this.get("status") === "awarding") {
      const offers = this.get("offers");
      const offer = offers.at(-1);
      if (!offer.awarded) {
        await awardAuction(this.env, cfg, offer);
        offer.awarded = true;
        this.put("offers", offers);
      }
      this.put("status", "won");
    }
  }
}

// Creates the winner's order (awaiting payment), marks the piece sold, emails the pay link and tells Sruthi.
// Safe to run again: the order is only created once per offer.
async function awardAuction(env, cfg, offer) {
  if (!env.ORDERS) throw new Error("award: ORDERS KV not bound");
  const settings = ((await readRepoJson(env, "content/settings.json")) || {}).data || {};
  const currency = settings.currency || "CAD";
  const number = offer.number;
  let order;
  const existing = await env.ORDERS.get(`ordnum:${number}`);
  if (existing) order = JSON.parse((await env.ORDERS.get(existing)) || "null");
  if (!order) {
    const now = Date.now();
    order = {
      number, orderId: number, payment: "auction", auctionId: cfg.id, rank: offer.rank,
      items: [{ id: cfg.id, title: cfg.title, qty: 1, price: offer.amount, image: cfg.image }],
      subtotal: offer.amount, shipping: 0, amount: money(offer.amount), currency,
      delivery: { method: "ship", name: offer.name, email: offer.email, phone: "", note: "", address: null, legacy: "Address not given yet" },
      addressText: "Address not given yet", buyer: { name: offer.name, email: offer.email },
      stock: [], stockTaken: false, status: "awaiting", tracking: "", createdAt: iso(now), payBy: iso(now + PAY_WINDOW_MS), payToken: randomToken(),
    };
    const key = orderKey(now, number);
    await env.ORDERS.put(key, JSON.stringify(order));
    await env.ORDERS.put(`ordnum:${number}`, key);
  }
  // The piece leaves the shop the moment it's won (a later offer to the next bidder keeps it that way).
  const stock = await changeStock(env, cfg.id, -9999, (t) => `Auction: ${t} won by bid (${number}) — 0 left`).catch((e) => ({ ok: false, error: e.message }));
  if (!stock.ok) console.log("auction stock update failed", stock.error);

  const ship = shippingOf(settings);
  const payUrl = `${shopUrl(env)}/#pay/${number}/${order.payToken}`;
  const totals = [["Canada", ship.CA], ["USA", ship.US], ["rest of the world", ship.intl]].map(([k, fee]) => `${k} ${fmtMoney(offer.amount + fee, currency)}`);
  const deadline = new Date(order.payBy).toUTCString().replace(/:\d\d GMT$/, " GMT");
  const intro = offer.rank === 1
    ? `Congratulations! You won the auction for “${cfg.title}” with your bid of ${fmtMoney(offer.amount, currency)}.`
    : `Good news: “${cfg.title}” is now offered to you at your bid of ${fmtMoney(offer.amount, currency)}, because the winning bidder didn't complete payment.`;
  await quietly(sendEmail(env, offer.email, offer.rank === 1 ? `You won “${cfg.title}” — please pay within 48 hours` : `“${cfg.title}” is yours if you'd like it`,
    `Hi ${offer.name},\n\n${intro}\n\nPlease pay within 48 hours (by ${deadline}). Choose delivery or pickup and pay here:\n${payUrl}\n\nWith delivery: ${totals.join(" · ")}.${ship.pickup ? ` Pickup is free: ${fmtMoney(offer.amount, currency)}.` : ""}\n\nThis link is just for you, so please don't share it.\n\nYour order number is ${number}.\n\nThank you for supporting my art!\nSruthi`), "winner email");
  await quietly(notifyText(env, [`Auction ${offer.rank === 1 ? "won" : `offered to bidder #${offer.rank}`}: ${cfg.title}`, `${fmtMoney(offer.amount, currency)} by ${offer.name} (${offer.email})`, `Order ${number}, awaiting payment until ${deadline}`, stock.ok ? "Piece marked sold." : "Piece NOT marked sold — check the studio."]), "whatsapp");
  return { number };
}

// Which way auction winners pay: PayPal Checkout when the shop uses it and the Worker has the credentials.
const payModeFor = (env, settings) => (settings.checkoutMode === "paypal" && env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET ? "paypal" : "paypalme");

// ---------- Auction endpoints ----------
async function listAuctions(env) {
  const cfgs = await auctionConfigs(env);
  if (!cfgs.length) return json({ auctions: [], now: iso(Date.now()) });
  const auctions = await Promise.all(cfgs.map((cfg) => auctionStub(env, cfg.id).state(cfg)));
  return json({ auctions, now: iso(Date.now()) });
}
async function oneAuction(env, id) {
  const cfg = await auctionConfig(env, id);
  return json(await auctionStub(env, id).state(cfg));
}
async function placeBid(env, request, id, ctx) {
  biddingReady(env);
  const bidder = await bidderFrom(env, request);
  const body = await request.json().catch(() => ({}));
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000 || round2(amount) !== amount) throw new HttpError(400, "Please enter your bid as a number, like 120 or 120.50.", "bad_amount");
  const cfg = await auctionConfig(env, id);
  const r = await auctionStub(env, id).bid(cfg, bidder, amount);
  if (!r.ok) return json({ error: r.error, code: r.code, min: r.min, state: r.state }, r.code === "ended" ? 409 : 400);
  const currency = (await getSettings(env).catch(() => ({}))).currency || "CAD";
  const endsTxt = new Date(r.state.endsAt).toUTCString().replace(/:\d\d GMT$/, " GMT");
  if (r.previous) {
    ctx.waitUntil(quietly(sendEmail(env, r.previous.email, `You've been outbid on “${cfg.title}”`,
      `Hi ${r.previous.name},\n\nSomeone bid ${fmtMoney(amount, currency)} on “${cfg.title}”, above your ${fmtMoney(r.previous.amount, currency)}.\n\nThe auction ends ${endsTxt}. To bid again:\n${shopUrl(env)}/#auctions\n\nSruthi Arts`), "outbid email"));
  }
  ctx.waitUntil(quietly(notifyText(env, [`New high bid: ${cfg.title}`, `${fmtMoney(amount, currency)} by ${bidder.name} (${bidder.email})`, `${r.state.count} bid${r.state.count > 1 ? "s" : ""}${r.extended ? " · extended by 2 min" : ""}`, `Ends ${endsTxt}`]), "whatsapp"));
  return json({ ok: true, extended: r.extended, state: r.state });
}
async function adminAuctions(env) {
  const cfgs = await auctionConfigs(env, true);
  return json({ auctions: await Promise.all(cfgs.map((cfg) => auctionStub(env, cfg.id).adminState(cfg))) });
}
async function adminCloseAuction(env, id) {
  const cfg = await auctionConfig(env, id, true);
  return json(await auctionStub(env, id).close(cfg));
}
async function adminOfferNext(env, id) {
  const cfg = await auctionConfig(env, id, true);
  const stub = auctionStub(env, id);
  const before = await stub.adminState(cfg);
  const last = (before.offers || []).at(-1);
  if (last && env.ORDERS) {
    const found = await findOrder(env, last.number);
    if (found && !["awaiting", "cancelled"].includes(found.order.status)) throw new HttpError(409, `${last.name} has already paid (${last.number}).`, "paid");
    if (found && found.order.status === "awaiting") {
      found.order.status = "cancelled"; found.order.cancelReason = "offered to next bidder"; found.order.updatedAt = iso(Date.now());
      await env.ORDERS.put(found.key, JSON.stringify(found.order));
    }
  }
  const r = await stub.offerNext(cfg);
  if (!r.ok) throw new HttpError(409, r.error, r.code);
  return json(r);
}

// ---------- Paying for an auction win ----------
async function findOrder(env, number) {
  const key = await env.ORDERS.get(`ordnum:${number}`);
  const order = key ? JSON.parse((await env.ORDERS.get(key)) || "null") : null;
  return order ? { key, order } : null;
}
async function payOrder(env, number, token) {
  if (!env.ORDERS) throw new HttpError(503, "Orders can't be loaded right now.", "no_storage");
  const found = await findOrder(env, number);
  if (!found || !found.order.payToken || !safeEqual(token || "", found.order.payToken)) throw new HttpError(404, "This payment link isn't valid. Please check the email, or message Sruthi.", "not_found");
  return found;
}
function payable(order) {
  if (order.status !== "awaiting") throw new HttpError(409, order.status === "cancelled" ? "This order was cancelled because payment didn't arrive within 48 hours." : "This order is already paid. Thank you!", order.status === "cancelled" ? "cancelled" : "paid");
  if (order.payBy && Date.parse(order.payBy) < Date.now()) throw new HttpError(409, "The 48 hours to pay have passed. Please message Sruthi.", "expired");
}
async function paySummary(env, number, token) {
  const { order } = await payOrder(env, number, token);
  const settings = ((await readRepoJson(env, "content/settings.json")) || {}).data || {};
  const mode = payModeFor(env, settings);
  return json({
    number, status: order.status, cancelReason: order.cancelReason || "", items: order.items.map((l) => ({ id: l.id, title: l.title, qty: l.qty, price: l.price, image: l.image })),
    subtotal: order.subtotal, shipping: order.shipping, amount: Number(order.amount), currency: order.currency, payBy: order.payBy,
    name: order.buyer && order.buyer.name, email: order.buyer && order.buyer.email, delivery: order.delivery && order.delivery.address ? order.delivery : null,
    ship: shippingOf(settings), mode, paypalClientId: mode === "paypal" ? env.PAYPAL_CLIENT_ID : undefined, payUrl: order.payUrl || "",
  });
}
// Saves where it goes and works out the total with the delivery fee (the server decides, as for the cart).
async function setPayDelivery(env, found, raw) {
  const { order, key } = found;
  payable(order);
  const settings = ((await readRepoJson(env, "content/settings.json")) || {}).data || {};
  const ship = shippingOf(settings);
  const delivery = readDelivery({ ...raw, email: order.buyer.email }, ship);
  const shipping = Number(money(feeFor(delivery, ship)));
  const subtotal = Number(money(order.subtotal));
  Object.assign(order, { delivery, addressText: addressText(delivery), shipping, amount: money(subtotal + shipping), updatedAt: iso(Date.now()) });
  const user = paypalMeUser(settings.paypal);
  order.payUrl = user ? `https://www.paypal.me/${encodeURIComponent(user)}/${order.amount}${order.currency}` : "";
  await env.ORDERS.put(key, JSON.stringify(order));
  return { order, settings };
}
async function payDelivery(env, request, number) {
  const body = await request.json().catch(() => ({}));
  const found = await payOrder(env, number, body.t);
  const { order } = await setPayDelivery(env, found, body.delivery);
  if (!order.payUrl) throw new HttpError(503, "Online payment isn't set up yet. Please message Sruthi on Instagram.", "no_paypal");
  return json({ ok: true, amount: Number(order.amount), shipping: order.shipping, currency: order.currency, payUrl: order.payUrl });
}
async function payCreatePaypal(env, request, number) {
  const body = await request.json().catch(() => ({}));
  const found = await payOrder(env, number, body.t);
  const { order, settings } = await setPayDelivery(env, found, body.delivery);
  if (payModeFor(env, settings) !== "paypal") throw new HttpError(400, "Card checkout isn't switched on. Use the PayPal link instead.", "no_checkout");
  const l = order.items[0];
  const unit = {
    reference_id: "auction", custom_id: `auction|${number}`, description: `Auction: ${l.title}`.slice(0, 127),
    amount: { currency_code: order.currency, value: order.amount, breakdown: { item_total: { currency_code: order.currency, value: money(order.subtotal) }, shipping: { currency_code: order.currency, value: money(order.shipping) } } },
    items: [{ name: l.title.slice(0, 127), sku: l.id.slice(0, 127), quantity: "1", unit_amount: { currency_code: order.currency, value: money(l.price) }, category: "PHYSICAL_GOODS" }],
  };
  const d = order.delivery;
  if (d.method === "ship") unit.shipping = { type: "SHIPPING", name: { full_name: d.name.slice(0, 300) }, address: { address_line_1: d.address.line1, ...(d.address.line2 ? { address_line_2: d.address.line2 } : {}), admin_area_2: d.address.city, ...(d.address.region ? { admin_area_1: d.address.region } : {}), ...(d.address.postal ? { postal_code: d.address.postal } : {}), country_code: d.address.country } };
  const res = await paypal(env, "/v2/checkout/orders", { intent: "CAPTURE", purchase_units: [unit], application_context: { brand_name: "Sruthi Arts", shipping_preference: d.method === "ship" ? "SET_PROVIDED_ADDRESS" : "NO_SHIPPING", user_action: "PAY_NOW" } });
  if (!res.ok) throw new HttpError(502, "PayPal couldn't start the checkout. Please try again.", "paypal_create");
  order.payOrderId = res.data.id;
  await env.ORDERS.put(found.key, JSON.stringify(order));
  return json({ id: res.data.id, amount: Number(order.amount), currency: order.currency });
}
async function payCapture(env, request, number, ctx) {
  const body = await request.json().catch(() => ({}));
  const found = await payOrder(env, number, body.t);
  const { order, key } = found;
  payable(order);
  if (!body.orderID || body.orderID !== order.payOrderId) throw new HttpError(400, "This payment doesn't match the order. Please try again.", "bad_order");
  const res = await paypal(env, `/v2/checkout/orders/${order.payOrderId}/capture`);
  const issue = res.data && res.data.details && res.data.details[0] && res.data.details[0].issue;
  if (issue === "INSTRUMENT_DECLINED") return json({ error: "Your payment method was declined. Please try another.", code: "declined", restart: true }, 402);
  if (!res.ok || res.data.status !== "COMPLETED") throw new HttpError(502, "The payment didn't go through. You have not been charged.", issue || "capture_failed");
  const capture = res.data.purchase_units[0].payments.captures[0];
  const payer = res.data.payer || {};
  Object.assign(order, {
    status: "new", captureId: capture.id, amount: capture.amount.value, currency: capture.amount.currency_code, paidAt: iso(Date.now()), updatedAt: iso(Date.now()),
    payer: { name: [payer.name && payer.name.given_name, payer.name && payer.name.surname].filter(Boolean).join(" "), email: payer.email_address || "", payerId: payer.payer_id || "", captureId: capture.id },
  });
  await env.ORDERS.put(key, JSON.stringify(order));
  ctx.waitUntil(quietly(notifyText(env, [`Auction paid: ${order.items[0].title}`, `${fmtMoney(Number(order.amount), order.currency)} by ${order.payer.name || order.buyer.name} (${order.payer.email})`, order.delivery.method === "pickup" ? "Pickup — message them to arrange" : `Ship to: ${order.addressText}`, `Order ${number}`]), "whatsapp"));
  return json({ ok: true, number, total: order.amount, currency: order.currency, method: order.delivery.method });
}

// ---------- Hourly cron: unpaid orders lapse after 48 hours ----------
const REMIND_AFTER_MS = 36 * HOUR; // one WhatsApp reminder per unpaid PayPal.me order, 12 hours before it lapses
// PayPal.me orders are cancelled and their pieces go back on sale (restock). Auction wins are cancelled too; the
// piece stays sold so Sruthi can offer it to the next bidder from the studio.
async function expireUnpaid(env) {
  if (!env.ORDERS) return { released: [], lapsed: [], reminded: [] };
  const now = Date.now();
  const released = [], lapsed = [], reminded = [];
  let cursor;
  do {
    const page = await env.ORDERS.list({ prefix: "order:", limit: 1000, cursor });
    for (const k of page.keys) {
      const o = JSON.parse((await env.ORDERS.get(k.name)) || "null");
      if (!o || o.status !== "awaiting") continue;
      const deadline = o.payBy ? Date.parse(o.payBy) : Date.parse(o.createdAt) + PAY_WINDOW_MS;
      if (!(deadline <= now)) {
        // 36 hours in: remind Sruthi once to check PayPal. remindedAt is saved only after the message goes out,
        // so a failed send is tried again next hour, and never twice once it's sent.
        if (o.payment !== "auction" && !o.remindedAt && now - Date.parse(o.createdAt) >= REMIND_AFTER_MS) {
          const hours = Math.max(1, Math.round((deadline - now) / HOUR));
          try {
            await notifyText(env, [`Not paid yet: ${o.number}`, `${(o.items || []).map((l) => `${l.title} ×${l.qty}`).join(", ")} · ${fmtMoney(Number(o.amount), o.currency)} · ${(o.delivery && o.delivery.name) || (o.buyer && o.buyer.name) || ""}`, `Check PayPal and mark it paid in the studio, or it's cancelled in ${hours} hour${hours === 1 ? "" : "s"}.`]);
            o.remindedAt = iso(now);
            await env.ORDERS.put(k.name, JSON.stringify(o));
            reminded.push(o.number);
          } catch (e) { console.log("reminder failed", o.number, e.message); }
        }
        continue;
      }
      if (o.payment === "auction") lapsed.push(o);
      else {
        for (const l of o.stockTaken ? o.items || [] : []) await restock(env, l.id, Number(l.qty) || 1, o.number).catch((e) => console.log("restock failed", e.message));
        o.stockTaken = false;
        released.push(o);
      }
      Object.assign(o, { status: "cancelled", cancelReason: "unpaid after 48 hours", updatedAt: iso(now) });
      await env.ORDERS.put(k.name, JSON.stringify(o));
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  if (released.length || lapsed.length) {
    const what = (o) => `${o.number} (${(o.items || []).map((l) => `${l.title} ×${l.qty}`).join(", ")})`;
    await quietly(notifyText(env, [
      `Unpaid orders cancelled after 48 hours: ${released.length + lapsed.length}`,
      released.length ? `Back on sale: ${released.map(what).join("; ")}` : "",
      lapsed.length ? `Auction wins not paid: ${lapsed.map(what).join("; ")} — offer them to the next bidder in the studio` : "",
    ]), "whatsapp");
  }
  return { released: released.map((o) => o.number), lapsed: lapsed.map((o) => o.number), reminded };
}

// ---------- PayPal setup check (admin) ----------
async function paypalStatus(env) {
  const clientIdSet = Boolean(env.PAYPAL_CLIENT_ID), secretSet = Boolean(env.PAYPAL_CLIENT_SECRET);
  let credentialsWork = null;
  // Asking PayPal for an access token proves the pair works without touching any money, in sandbox or live.
  if (clientIdSet && secretSet) { try { await paypalToken(env); credentialsWork = true; } catch { credentialsWork = false; } }
  return json({ clientIdSet, secretSet, env: env.PAYPAL_ENV === "live" ? "live" : "sandbox", clientId: clientIdSet ? String(env.PAYPAL_CLIENT_ID) : "", credentialsWork });
}

// ---------- Router ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const headers = cors(env, request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      let res;
      const m = url.pathname.match(/^\/api\/orders\/([A-Z0-9]+)\/capture$/);
      const a = decodeURIComponent(url.pathname).match(/^\/api\/admin\/orders\/(order:[0-9]+:[A-Z0-9]+)$/);
      const au = url.pathname.match(/^\/api\/auctions\/([a-z0-9-]{1,80})(\/bid)?$/);
      const adm = url.pathname.match(/^\/api\/admin\/auctions\/([a-z0-9-]{1,80})\/(close|offer-next)$/);
      const pay = url.pathname.match(/^\/api\/pay\/(SA-[A-Z0-9]{4,16})(?:\/(delivery|paypal|capture))?$/);
      if (url.pathname === "/" && request.method === "GET") {
        res = json({ ok: true, checkout: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.GITHUB_TOKEN), paypalme: Boolean(env.GITHUB_TOKEN && env.ORDERS), paypalEnv: env.PAYPAL_ENV || "sandbox", orders: Boolean(env.ORDERS), whatsapp: Boolean((env.CALLMEBOT_PHONE && env.CALLMEBOT_APIKEY) || (env.WHATSAPP_TOKEN && env.WHATSAPP_TO)), login: Boolean(env.GITHUB_OAUTH_CLIENT_ID), auctions: Boolean(env.AUCTION && env.ORDERS && env.BIDDER_SECRET && env.RESEND_API_KEY) });
      } else if (url.pathname === "/auth" && request.method === "GET") {
        return oauthStart(env, request);
      } else if (url.pathname === "/callback" && request.method === "GET") {
        return oauthCallback(env, request);
      } else if (url.pathname === "/api/requests" && request.method === "POST") {
        if (!allowedOrigin(env, request)) throw new HttpError(403, "Not allowed.", "origin");
        res = await placeRequest(env, request, ctx);
      } else if (url.pathname === "/api/orders" && request.method === "POST") {
        if (!allowedOrigin(env, request)) throw new HttpError(403, "Not allowed.", "origin");
        res = await createOrder(env, request);
      } else if (m && request.method === "POST") {
        if (!allowedOrigin(env, request)) throw new HttpError(403, "Not allowed.", "origin");
        res = await captureOrder(env, m[1], ctx);
      } else if (url.pathname === "/api/stock" && request.method === "GET") {
        res = await stockResponse(env, request, ctx);
      } else if (url.pathname === "/api/auctions" && request.method === "GET") {
        res = await listAuctions(env);
      } else if (au && !au[2] && request.method === "GET") {
        res = await oneAuction(env, au[1]);
      } else if (au && au[2] && request.method === "POST") {
        if (!allowedOrigin(env, request)) throw new HttpError(403, "Not allowed.", "origin");
        res = await placeBid(env, request, au[1], ctx);
      } else if (url.pathname === "/api/bidders/start" && request.method === "POST") {
        if (!allowedOrigin(env, request)) throw new HttpError(403, "Not allowed.", "origin");
        res = await bidderStart(env, request);
      } else if (url.pathname === "/api/bidders/verify" && request.method === "POST") {
        if (!allowedOrigin(env, request)) throw new HttpError(403, "Not allowed.", "origin");
        res = await bidderVerify(env, request);
      } else if (pay && !pay[2] && request.method === "GET") {
        res = await paySummary(env, pay[1], url.searchParams.get("t"));
      } else if (pay && pay[2] && request.method === "POST") {
        if (!allowedOrigin(env, request)) throw new HttpError(403, "Not allowed.", "origin");
        res = pay[2] === "delivery" ? await payDelivery(env, request, pay[1]) : pay[2] === "paypal" ? await payCreatePaypal(env, request, pay[1]) : await payCapture(env, request, pay[1], ctx);
      } else if (url.pathname === "/api/admin/auctions" && request.method === "GET") {
        await requireAdmin(env, request);
        res = await adminAuctions(env);
      } else if (adm && request.method === "POST") {
        await requireAdmin(env, request);
        res = adm[2] === "close" ? await adminCloseAuction(env, adm[1]) : await adminOfferNext(env, adm[1]);
      } else if (url.pathname === "/api/admin/paypal" && request.method === "GET") {
        await requireAdmin(env, request);
        res = await paypalStatus(env);
      } else if (url.pathname === "/api/admin/orders" && request.method === "GET") {
        await requireAdmin(env, request);
        res = await listOrders(env);
      } else if (a && request.method === "PATCH") {
        await requireAdmin(env, request);
        res = await updateOrder(env, request, a[1]);
      } else {
        res = json({ error: "Not found" }, 404);
      }
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.log("error", e.stack || e.message);
      return json({ error: e instanceof HttpError ? e.message : "Something went wrong. You have not been charged.", code: e.code || "error" }, status, headers);
    }
  },
  // Hourly (wrangler.toml → [triggers] crons): unpaid orders lapse after 48 hours.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(expireUnpaid(env).then((r) => console.log("expired", JSON.stringify(r))));
  },
};
