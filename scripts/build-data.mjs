// Builds site/data/shop.json from the files the admin edits:
//   content/items/*.json   one file per shop item (the file name becomes the item's link, e.g. #golden-forest)
//   content/settings.json  contact and payment settings
//   content/pages.json     page text (hero, about, how to buy, contact, footer)
// Runs in CI before every deploy. Locally: node scripts/build-data.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

// The admin saves photo paths as "/images/paintings/x.webp". The site lives under /SruthiArts/ on GitHub Pages,
// so a leading "/" would point outside it. Make every path relative to the site root.
const relPath = (p) => (typeof p === "string" ? p.trim().replace(/^\/+/, "").replace(/^site\//, "") : p);

const items = readdirSync(join(ROOT, "content/items"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => {
    const item = { id: f.replace(/\.json$/, ""), ...read(`content/items/${f}`) };
    // Photos: "image" is the cover; "images" lists every photo in order (the studio saves the cover first).
    // The classic editor may keep extra photos only in "images", so the cover is always put first and duplicates dropped.
    const photos = [item.image, ...(Array.isArray(item.images) ? item.images : [])]
      .map((x) => relPath(x && typeof x === "object" ? x.image || x.src : x))
      .filter((x) => typeof x === "string" && x);
    item.images = [...new Set(photos)];
    item.image = item.images[0] || "";
    // Stock: "quantity" is how many are left (default 1 for one-of-a-kind pieces). 0, or status "sold", means sold out.
    const qty = Number.isFinite(Number(item.quantity)) ? Math.max(0, Math.floor(Number(item.quantity))) : 1;
    item.quantity = item.status === "sold" ? 0 : qty;
    item.status = item.quantity > 0 ? "available" : "sold";
    if (!item.paypalLink) delete item.paypalLink;
    return item;
  })
  .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || a.title.localeCompare(b.title));

function paypalUser(v) {
  return String(v || "").trim().replace(/^https?:\/\/(www\.)?paypal\.me\//i, "").replace(/^paypal\.me\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
}
function validCheckoutApi(v) {
  try { const u = new URL(v); return u.protocol === "https:" && !/(^|\.)paypal\.(me|com)$/i.test(u.hostname); } catch { return false; }
}
function validClientId(v) { return /^[A-Za-z0-9_-]{40,}$/.test(String(v)); }

const pages = read("content/pages.json");
if (pages.about) pages.about.photo = relPath(pages.about.photo);

// Settings: tidy values typed in the studio so a slip can't break the Buy button.
const artist = read("content/settings.json");
artist.paypal = paypalUser(artist.paypal);
if (artist.checkoutApi && !validCheckoutApi(artist.checkoutApi)) {
  console.warn(`warning: checkoutApi "${artist.checkoutApi}" is not a checkout server address (it should be the Worker URL) — checkout stays off`);
  delete artist.checkoutApi;
}
if (artist.paypalClientId && !validClientId(artist.paypalClientId)) {
  console.warn(`warning: paypalClientId "${artist.paypalClientId}" doesn't look like a PayPal client ID — checkout stays off`);
  delete artist.paypalClientId;
}

const shop = { artist, pages, paintings: items };
mkdirSync(join(ROOT, "site/data"), { recursive: true });
writeFileSync(join(ROOT, "site/data/shop.json"), JSON.stringify(shop, null, 2) + "\n");
console.log(`Built site/data/shop.json with ${items.length} item(s).`);
