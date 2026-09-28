// Shop data types and the rules the storefront applies to it. data/shop.json is built from content/ by
// scripts/build-data.mjs; edit content through /admin, not the JSON.

export type Painting = {
  id: string;
  title: string;
  category: string;
  description: string;
  medium?: string; // optional: stickers and keychains often have no canvas size
  width?: number;
  height?: number;
  price: number;
  status: "available" | "sold";
  quantity?: number;
  image: string;
  images?: string[];
  alt?: string;
  date?: string;
  paypalLink?: string;
};

export type Shipping = { CA?: number | string; US?: number | string; intl?: number | string; pickup?: boolean; pickupNote?: string };

export type Artist = {
  name?: string;
  instagram?: string;
  email?: string;
  paypal?: string;
  currency?: string;
  shipping?: Shipping;
  checkoutTest?: boolean;
  checkoutMode?: "paypal" | "paypalme";
  checkoutApi?: string;
  paypalClientId?: string;
  categories?: Category[];
};

export type Pages = {
  hero?: { eyebrow?: string; title?: string; titleAccent?: string; intro?: string };
  about?: { heading?: string; text?: string; photo?: string; photoAlt?: string };
  buy?: { heading?: string; steps?: { title?: string; text?: string }[] };
  contact?: { heading?: string; text?: string };
  footer?: { text?: string };
};

export type Shop = { artist: Artist; pages: Pages | null; paintings: Painting[] };

// Shop categories, in menu order. The list comes from content/settings.json (Studio → Settings → Shop categories);
// these four are only the fallback. The "id" is what each item's "category" stores.
export type Category = { id: string; label: string };
export const DEFAULT_CATEGORIES: Category[] = [
  { id: "ludo-boards", label: "Ludo boards" },
  { id: "clocks", label: "Clocks" },
  { id: "originals", label: "Originals" },
  { id: "prints", label: "Prints" },
];
export function categoriesOf(a: Artist): Category[] {
  const list = (Array.isArray(a.categories) ? a.categories : []).filter((c) => c && typeof c.id === "string" && typeof c.label === "string" && c.label.trim());
  return list.length ? list : DEFAULT_CATEGORIES;
}

// Defaults shown when content/pages.json leaves a field empty (same text the old HTML carried).
export const DEFAULT_PAGES = {
  hero: {
    eyebrow: "Ludo boards · Clocks · Originals · Prints · Keychains · Stickers",
    title: "Small doors into",
    titleAccent: "quieter worlds",
    intro: "Fairy-tale inspired pieces painted by Sruthi in the hours after work, from one-of-a-kind originals to ludo boards, clocks and prints.",
  },
  about: {
    heading: "About the artist",
    text: "Hi, I’m Sruthi. I paint aesthetic, fairy-tale inspired pieces in my free time. My full-time work is software engineering, but painting is my calm space.\n\nI share and sell selected works here. If one of them speaks to you, I’d love for it to find a home with you.",
  },
  buy: {
    heading: "How to buy",
    steps: [
      { title: "Choose a piece", text: "Open anything marked Available to see its size, medium, price and how many are left." },
      { title: "Pay with PayPal", text: "Tap “Buy with PayPal” on the piece. The price is already filled in." },
      { title: "Send your payment details", text: "After paying, message @sruthi_artss on Instagram with the piece’s name, your PayPal transaction ID or a screenshot of the receipt, and your delivery address." },
      { title: "Get your confirmation", text: "Sruthi checks the payment, confirms your order and lets you know when it ships." },
    ],
  },
  contact: { heading: "Questions or commissions", text: "For questions about a piece, custom commissions or delivery, message Sruthi directly." },
  footer: { text: "All artwork is Sruthi’s own; images may not be reproduced without permission." },
};

export const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v : fallback);

// "Acrylic on canvas · 40 × 50 cm", "Vinyl · 7 cm", or "" — only what's filled in.
export function spec(p: Painting) {
  const w = Number(p.width) > 0 ? Number(p.width) : 0, h = Number(p.height) > 0 ? Number(p.height) : 0;
  const size = w && h ? `${w} × ${h} cm` : w || h ? `${w || h} cm` : "";
  return [String(p.medium || "").trim(), size].filter(Boolean).join(" · ");
}
export const stockOf = (p: Painting) => (p.status === "sold" ? 0 : Number.isFinite(Number(p.quantity)) ? Math.max(0, Number(p.quantity)) : 1);
export const isSold = (p: Painting) => stockOf(p) === 0;
export const stockLabel = (p: Painting) => { const n = stockOf(p); return n === 0 ? "Sold out" : `${n} available`; };
export const photosOf = (p?: Painting | null) => (p && p.images && p.images.length ? p.images : [p && p.image].filter((x): x is string => Boolean(x)));

export function makeMoney(currency = "CAD") {
  const fmt = new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: 0 });
  return (n: number) => fmt.format(n);
}

export const igHandle = (a: Artist) => (a.instagram || "").replace(/^@/, "").trim();
export const igUrl = (a: Artist) => `https://www.instagram.com/${igHandle(a)}/`;
export const mailto = (a: Artist, subject: string) => `mailto:${a.email}?subject=${encodeURIComponent(subject)}`;

const cleanPaypalUser = (v?: string) => (v || "").replace(/^https?:\/\/(www\.)?paypal\.me\//i, "").replace(/^paypal\.me\//i, "").trim().replace(/^@/, "").replace(/[/?#].*$/, "");

// Fallback when checkout isn't set up: PayPal.me link with the price filled in, or a per-item PayPal link.
export function paypalUrl(a: Artist, p: Painting) {
  if (p.paypalLink) return p.paypalLink;
  const user = cleanPaypalUser(a.paypal);
  return user ? `https://www.paypal.me/${user}/${p.price}${a.currency || "CAD"}` : "";
}

// Two ways to take payment: "paypalme" (customer pays the total on Sruthi's PayPal.me link, she confirms it in
// the studio) or "paypal" (automatic PayPal/card checkout; needs a PayPal Business app).
export const payMode = (a: Artist) => (a.checkoutMode === "paypal" ? "paypal" : "paypalme");
// The checkout server (Cloudflare Worker) address, when one is set and looks right.
const validCheckoutApi = (a: Artist) => { const url = a.checkoutApi || ""; return /^https:\/\//.test(url) && !/paypal\.(me|com)/i.test(url); };
export function checkoutReady(a: Artist) {
  if (!validCheckoutApi(a)) return false;
  return payMode(a) === "paypal" ? /^[A-Za-z0-9_-]{40,}$/.test(a.paypalClientId || "") : Boolean(cleanPaypalUser(a.paypal));
}
export const api = (a: Artist, path: string) => (a.checkoutApi || "").replace(/\/+$/, "") + path;

// Live stock from the checkout server (GET /api/stock), so Studio changes to stock, sold/available and price show
// within seconds instead of after the next deploy. Returns null on any problem; the shop.json values then stay.
export type LiveStock = Record<string, { quantity: number; status: "available" | "sold"; price: number }>;
export async function fetchStock(a: Artist, timeoutMs = 2500): Promise<LiveStock | null> {
  if (!validCheckoutApi(a)) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    // "no-cache" skips the browser copy, so the only delay is the server's 10-second edge cache.
    const res = await fetch(api(a, "/api/stock"), { signal: ctl.signal, cache: "no-cache" });
    if (!res.ok) return null;
    const body = await res.json();
    return body && typeof body.items === "object" && body.items ? (body.items as LiveStock) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
// Items only in the live data (posted since the last deploy) are skipped until the next deploy brings their photos and text.
export function mergeStock(ps: Painting[], live: LiveStock): Painting[] {
  let changed = false;
  const next = ps.map((p) => {
    const s = live[p.id];
    if (!s || typeof s !== "object") return p;
    const quantity = Number.isFinite(Number(s.quantity)) ? Math.max(0, Math.floor(Number(s.quantity))) : p.quantity;
    const status = quantity === 0 || s.status === "sold" ? "sold" : "available";
    const price = Number.isFinite(Number(s.price)) && Number(s.price) >= 0 ? Number(s.price) : p.price;
    if (quantity === p.quantity && status === p.status && price === p.price) return p;
    changed = true;
    return { ...p, quantity: status === "sold" ? 0 : quantity, status, price } as Painting;
  });
  return changed ? next : ps;
}

// In test mode (Studio → Settings) the cart only appears for people who open the site with ?test.
const testParam = /[?&]test\b/.test(location.search);
export const cartTest = (() => {
  try {
    if (testParam) sessionStorage.setItem("sruthiarts.test", "1");
    return sessionStorage.getItem("sruthiarts.test") === "1";
  } catch {
    return testParam;
  }
})();
export const cartOn = (a: Artist) => checkoutReady(a) && (!a.checkoutTest || cartTest);

// Delivery fees (Studio → Settings → Delivery). The checkout server uses the same rule.
export function shipCfg(a: Artist) {
  const s = a.shipping || {};
  const fee = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== "" ? Number(v) : d);
  return { CA: fee(s.CA, 15), US: fee(s.US, 25), intl: fee(s.intl, 40), pickup: s.pickup !== false, pickupNote: s.pickupNote || "" };
}

export type Buyer = {
  method: "ship" | "pickup";
  name: string; email: string; phone: string;
  country: string; line1: string; line2: string; city: string; region: string; postal: string;
  note: string;
};
export const emptyBuyer = (): Buyer => ({ method: "ship", name: "", email: "", phone: "", country: "CA", line1: "", line2: "", city: "", region: "", postal: "", note: "" });

export const feeFor = (a: Artist, b: Buyer) => { const c = shipCfg(a); return b.method === "pickup" ? 0 : b.country === "CA" ? c.CA : b.country === "US" ? c.US : c.intl; };

const COUNTRY_CODES = "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IS IT JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV MA MC MD ME MF MG MH MK ML MN MO MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RW SA SB SC SE SG SH SI SK SL SM SN SO SR ST SV SX SZ TC TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YT ZA ZM ZW".split(" ");
export const countryName = (() => {
  let dn: Intl.DisplayNames | null = null;
  try { dn = new Intl.DisplayNames(["en"], { type: "region" }); } catch { /* old browser: show the code */ }
  return (c: string) => (dn && dn.of(c)) || c;
})();
export const COUNTRIES = ["CA", "US", ...COUNTRY_CODES.filter((c) => c !== "CA" && c !== "US").sort((a, b) => countryName(a).localeCompare(countryName(b)))];
export const PROVINCES: Record<string, string> = { AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon" };
export const STATES: Record<string, string> = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico" };

export function validateBuyer(b: Buyer): [keyof Buyer, string] | null {
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

export const deliveryPayload = (b: Buyer) => ({
  method: b.method, name: b.name.trim(), email: b.email.trim(), phone: b.phone.trim(), note: b.note.trim(),
  ...(b.method === "ship"
    ? { address: { line1: b.line1.trim(), line2: b.line2.trim(), city: b.city.trim(), region: b.region.trim(), postal: b.postal.trim().toUpperCase(), country: b.country } }
    : {}),
});

export const addressLines = (a: Artist, b: Buyer) =>
  b.method === "pickup"
    ? ["Pickup", shipCfg(a).pickupNote].filter(Boolean)
    : [b.name, b.line1, b.line2, [b.city, b.region, b.postal.toUpperCase()].filter(Boolean).join(" "), countryName(b.country)].filter(Boolean);

export class ApiError extends Error {
  data: Record<string, unknown>;
  constructor(message: string, data: Record<string, unknown>) { super(message); this.data = data; }
}
export async function postJson<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(typeof data.error === "string" ? data.error : "Something went wrong. You have not been charged.", data);
  return data as T;
}

// Response from /api/requests (PayPal.me mode) and /api/orders/:id/capture (PayPal SDK mode).
export type OrderResult = {
  number?: string;
  total?: number | string;
  currency?: string;
  method?: "ship" | "pickup";
  payUrl?: string;
  items?: { title: string; qty: number }[];
  stock?: { id: string; left: number }[];
};

export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
