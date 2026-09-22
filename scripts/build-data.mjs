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
    item.image = relPath(item.image);
    return item;
  })
  .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || a.title.localeCompare(b.title));

const pages = read("content/pages.json");
if (pages.about) pages.about.photo = relPath(pages.about.photo);

const shop = { artist: read("content/settings.json"), pages, paintings: items };
mkdirSync(join(ROOT, "site/data"), { recursive: true });
writeFileSync(join(ROOT, "site/data/shop.json"), JSON.stringify(shop, null, 2) + "\n");
console.log(`Built site/data/shop.json with ${items.length} item(s).`);
