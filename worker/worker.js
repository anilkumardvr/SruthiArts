// Sruthi Arts checkout server — a single-file Cloudflare Worker (no dependencies).
//
// What it does
//   POST /api/orders                 Check stock and the real price in the repo, then create a PayPal order.
//   POST /api/orders/:id/capture     Take the payment, lower the item's quantity in the repo (Sold at 0),
//                                    save the order, and send Sruthi a WhatsApp alert.
//   GET  /api/admin/orders           Orders list for the admin (GitHub login required).
//   PATCH /api/admin/orders/:key     Mark an order shipped / new.
//   GET  /auth, /callback            "Continue with GitHub" login for the admin (Decap/Sveltia-compatible).
//   GET  /                           Health check: shows which features are configured.
//
// Settings (Cloudflare → Worker → Settings → Variables and Secrets). Secrets are marked (secret).
//   ALLOWED_ORIGINS            https://anilkumardvr.github.io            (comma-separated)
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

async function createOrder(env, request) {
  const { itemId, quantity = 1 } = await request.json().catch(() => ({}));
  const qty = Math.floor(Number(quantity));
  if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new HttpError(400, "Choose a quantity between 1 and 20.", "bad_qty");
  const [{ data: item }, settings] = await Promise.all([loadItem(env, itemId), readRepoJson(env, "content/settings.json")]);
  const left = stockOf(item);
  if (left < 1) throw new HttpError(409, "Sorry — this piece has just sold out.", "sold_out");
  if (qty > left) throw new HttpError(409, `Only ${left} left. Please lower the quantity.`, "not_enough");
  const price = Number(item.price);
  if (!(price > 0)) throw new HttpError(400, "This item has no price yet.", "no_price");
  const currency = (settings && settings.data.currency) || "CAD";
  const total = money(price * qty);

  const res = await paypal(env, "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: itemId,
      custom_id: `${itemId}|${qty}`,
      description: String(item.title).slice(0, 120),
      amount: { currency_code: currency, value: total, breakdown: { item_total: { currency_code: currency, value: total } } },
      items: [{ name: String(item.title).slice(0, 120), quantity: String(qty), unit_amount: { currency_code: currency, value: money(price) }, category: "PHYSICAL_GOODS" }],
    }],
    application_context: { brand_name: ((settings && settings.data.name) || "Sruthi") + " Arts", shipping_preference: "GET_FROM_FILE", user_action: "PAY_NOW" },
  });
  if (!res.ok) throw new HttpError(502, "PayPal couldn't start the checkout. Please try again.", "paypal_create");
  return json({ id: res.data.id });
}

function describeAddress(shipping) {
  const a = (shipping && shipping.address) || {};
  return [a.address_line_1, a.address_line_2, a.admin_area_2, a.admin_area_1, a.postal_code, a.country_code].filter(Boolean).join(", ");
}

async function captureOrder(env, orderId, ctx) {
  if (!/^[A-Z0-9]{5,40}$/.test(orderId)) throw new HttpError(400, "Unknown order.", "bad_order");
  const res = await paypal(env, `/v2/checkout/orders/${orderId}/capture`);
  const issue = res.data && res.data.details && res.data.details[0] && res.data.details[0].issue;
  if (issue === "INSTRUMENT_DECLINED") return json({ error: "Your payment method was declined. Please try another.", code: "declined", restart: true }, 402);
  if (!res.ok || res.data.status !== "COMPLETED") throw new HttpError(502, "The payment didn't go through. You have not been charged.", issue || "capture_failed");

  const pu = res.data.purchase_units[0];
  const capture = pu.payments.captures[0];
  const [itemId, qtyStr] = String(capture.custom_id || pu.custom_id || pu.reference_id || "").split("|");
  const qty = Math.max(1, Number(qtyStr) || 1);
  const stock = await decrementStock(env, itemId, qty, orderId).catch((e) => ({ ok: false, error: e.message }));

  const payer = res.data.payer || {};
  const shipping = pu.shipping || {};
  const order = {
    orderId,
    captureId: capture.id,
    itemId,
    title: stock.title || itemId,
    quantity: qty,
    amount: capture.amount.value,
    currency: capture.amount.currency_code,
    buyer: { name: [payer.name && payer.name.given_name, payer.name && payer.name.surname].filter(Boolean).join(" "), email: payer.email_address || "" },
    shipTo: { name: (shipping.name && shipping.name.full_name) || "", address: describeAddress(shipping) },
    stockLeft: stock.ok ? stock.left : null,
    stockError: stock.ok ? "" : stock.error,
    status: "new",
    createdAt: new Date().toISOString(),
  };
  const key = `order:${String(9999999999999 - Date.now()).padStart(13, "0")}:${orderId}`;
  if (env.ORDERS) ctx.waitUntil(env.ORDERS.put(key, JSON.stringify(order)));
  ctx.waitUntil(notifyWhatsApp(env, order).catch((e) => console.log("whatsapp failed", e.message)));
  return json({ ok: true, orderId, title: order.title, quantity: qty, stockLeft: order.stockLeft, buyerName: order.buyer.name });
}

// ---------- WhatsApp ----------
async function notifyWhatsApp(env, o) {
  const line = (s) => String(s || "—").replace(/\s+/g, " ").trim();
  const stockNote = o.stockLeft === null ? `Stock NOT updated (${o.stockError}) — update it in the admin.` : o.stockLeft === 0 ? "Now marked Sold." : `${o.stockLeft} left.`;
  if (env.CALLMEBOT_PHONE && env.CALLMEBOT_APIKEY) {
    const text = [
      `New order: ${o.title} x${o.quantity}`,
      `Paid: ${o.amount} ${o.currency}`,
      `Buyer: ${line(o.buyer.name)} (${line(o.buyer.email)})`,
      `Ship to: ${line(o.shipTo.name)}, ${line(o.shipTo.address)}`,
      stockNote,
      `PayPal order ${o.orderId}`,
    ].join("\n");
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(env.CALLMEBOT_PHONE)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(env.CALLMEBOT_APIKEY)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CallMeBot ${res.status}`);
    return;
  }
  if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_TO) {
    // Template body must have 4 variables, e.g. "New order: {{1}} for {{2}}. Buyer: {{3}}. Ship to: {{4}}."
    const params = [`${o.title} x${o.quantity}`, `${o.amount} ${o.currency}`, `${line(o.buyer.name)} ${line(o.buyer.email)}`, `${line(o.shipTo.name)}, ${line(o.shipTo.address)}. ${stockNote}`];
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
async function listOrders(env) {
  if (!env.ORDERS) return json({ orders: [], note: "Orders storage (KV) is not connected yet." });
  const { keys } = await env.ORDERS.list({ prefix: "order:", limit: 200 });
  const orders = await Promise.all(keys.map(async (k) => ({ key: k.name, ...JSON.parse((await env.ORDERS.get(k.name)) || "{}") })));
  return json({ orders });
}
async function updateOrder(env, request, key) {
  if (!env.ORDERS || !/^order:[0-9]{13}:[A-Z0-9]+$/.test(key)) throw new HttpError(404, "Order not found.", "not_found");
  const { status } = await request.json().catch(() => ({}));
  if (!["new", "shipped"].includes(status)) throw new HttpError(400, "Status must be new or shipped.", "bad_status");
  const current = await env.ORDERS.get(key);
  if (!current) throw new HttpError(404, "Order not found.", "not_found");
  const order = { ...JSON.parse(current), status, updatedAt: new Date().toISOString() };
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
