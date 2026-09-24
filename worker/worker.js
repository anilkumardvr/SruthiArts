// Sruthi Arts checkout server — a single-file Cloudflare Worker (no dependencies).
//
// What it does
//   POST /api/orders                 Cart checkout: check stock and real prices in the repo, add the delivery fee
//                                    (content/settings.json → shipping), then create a PayPal order.
//   POST /api/orders/:id/capture     Take the payment, lower each item's quantity in the repo (Sold at 0),
//                                    save the order with the delivery address, and send Sruthi a WhatsApp alert.
//   GET  /api/admin/orders           Orders list for the admin (GitHub login required).
//   PATCH /api/admin/orders/:key     Update an order: status (new/packed/shipped/cancelled), tracking, note.
//   GET  /auth, /callback            "Continue with GitHub" login for the admin (Decap/Sveltia-compatible).
//   GET  /                           Health check: shows which features are configured.
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
// Binding: KV namespace "ORDERS" (stores orders privately; the repo is public, so buyer details never go there).

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
async function decrementStock(env, id, qty, orderId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { sha, data } = await loadItem(env, id);
    const left = Math.max(0, stockOf(data) - qty);
    const next = { ...data, quantity: left, status: left > 0 ? "available" : "sold" };
    const res = await writeRepoJson(env, itemFile(id), next, sha, `Sale: ${data.title} ×${qty} (PayPal ${orderId}) — ${left} left`);
    if (res.ok) return { ok: true, left, title: data.title };
    if (res.status !== 409 && res.status !== 422) return { ok: false, error: `GitHub write failed (${res.status})` };
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  return { ok: false, error: "Could not update stock after several tries" };
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

async function createOrder(env, request) {
  const body = await request.json().catch(() => ({}));
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
      `Paid: ${o.amount} ${o.currency}${o.shipping ? ` (incl. ${o.shipping} delivery)` : ""}`,
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
const STATUSES = ["new", "packed", "shipped", "cancelled"];
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
  const order = { ...JSON.parse(current), ...patch, updatedAt: new Date().toISOString() };
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
      if (url.pathname === "/" && request.method === "GET") {
        res = json({ ok: true, checkout: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.GITHUB_TOKEN), paypalEnv: env.PAYPAL_ENV || "sandbox", orders: Boolean(env.ORDERS), whatsapp: Boolean((env.CALLMEBOT_PHONE && env.CALLMEBOT_APIKEY) || (env.WHATSAPP_TOKEN && env.WHATSAPP_TO)), login: Boolean(env.GITHUB_OAUTH_CLIENT_ID) });
      } else if (url.pathname === "/auth" && request.method === "GET") {
        return oauthStart(env, request);
      } else if (url.pathname === "/callback" && request.method === "GET") {
        return oauthCallback(env, request);
      } else if (url.pathname === "/api/orders" && request.method === "POST") {
        if (!allowedOrigin(env, request)) throw new HttpError(403, "Not allowed.", "origin");
        res = await createOrder(env, request);
      } else if (m && request.method === "POST") {
        if (!allowedOrigin(env, request)) throw new HttpError(403, "Not allowed.", "origin");
        res = await captureOrder(env, m[1], ctx);
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
};
