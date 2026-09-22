// Pre-deploy checks for the static site. Zero dependencies — runs on plain Node 20+.
// Run after scripts/build-data.mjs. Fails the build when shop data is malformed or a local file reference is broken.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

const SITE = new URL("../site/", import.meta.url).pathname;
const errors = [];
const warnings = [];
const CATEGORIES = ["ludo-boards", "clocks", "originals", "prints"];

// 1. Built shop data
let data;
try {
  data = JSON.parse(readFileSync(join(SITE, "data/shop.json"), "utf8"));
} catch (e) {
  errors.push(`data/shop.json is missing or not valid JSON — run node scripts/build-data.mjs first (${e.message})`);
}

if (data) {
  const required = { title: "string", category: "string", description: "string", medium: "string", width: "number", height: "number", price: "number", status: "string", image: "string", alt: "string" };
  (data.paintings || []).forEach((p) => {
    const where = `content/items/${p.id}.json`;
    for (const [k, t] of Object.entries(required)) {
      if (typeof p[k] !== t || (t === "string" && !p[k].trim())) errors.push(`${where}: "${k}" must be a non-empty ${t}`);
    }
    if (!/^[a-z0-9-]+$/.test(p.id)) errors.push(`${where}: file name must be lowercase letters, digits and dashes (it becomes the item's link)`);
    if (!CATEGORIES.includes(p.category)) errors.push(`${where}: category must be one of ${CATEGORIES.join(", ")}`);
    if (p.status && !["available", "sold"].includes(p.status)) errors.push(`${where}: status must be "available" or "sold"`);
    if (p.image && !existsSync(join(SITE, p.image))) errors.push(`${where}: image not found at site/${p.image}`);
    if (p.paypalLink && !/^https:\/\//.test(p.paypalLink)) errors.push(`${where}: paypalLink must start with https://`);
  });
  if (!(data.paintings || []).length) warnings.push("content/items is empty — the shop will show no items");

  const a = data.artist || {};
  if (a.instagram && !/^@?[A-Za-z0-9._]{1,30}$/.test(a.instagram)) errors.push(`content/settings.json: instagram "${a.instagram}" should be just the username, e.g. sruthi_artss`);
  if (a.paypal && /\s/.test(a.paypal)) errors.push(`content/settings.json: paypal "${a.paypal}" should be just the PayPal.me username`);
  if (!a.paypal) warnings.push("content/settings.json: paypal is empty — the Buy with PayPal button stays hidden");
  if (!a.email && !a.instagram) warnings.push("content/settings.json: email and instagram are both empty — visitors have no way to get in touch");
  if (a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) errors.push(`content/settings.json: email "${a.email}" is not a valid address`);

  const pg = data.pages || {};
  for (const key of ["hero.title", "about.heading", "buy.heading", "contact.heading"]) {
    const v = key.split(".").reduce((o, k) => (o == null ? o : o[k]), pg);
    if (typeof v !== "string" || !v.trim()) errors.push(`content/pages.json: "${key}" must not be empty`);
  }
  if (pg.about && pg.about.photo && !existsSync(join(SITE, pg.about.photo))) errors.push(`content/pages.json: about photo not found at site/${pg.about.photo}`);

  // Unused images are harmless but usually a mistake
  const used = new Set([...(data.paintings || []).map((p) => p.image), pg.about && pg.about.photo].filter(Boolean));
  for (const f of readdirSync(join(SITE, "images/paintings"))) {
    if (!used.has(`images/paintings/${f}`)) warnings.push(`images/paintings/${f} is not used on the page`);
  }
}

// 2. Local src/href references in HTML files resolve
for (const file of readdirSync(SITE).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(join(SITE, file), "utf8");
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|#|\/|data:)/.test(ref)) continue;
    if (!existsSync(join(SITE, dirname(file), ref.split(/[?#]/)[0]))) errors.push(`${file}: broken reference "${ref}"`);
  }
  if (!/<title>[^<]+<\/title>/.test(html)) errors.push(`${file}: missing <title>`);
  if (!/<html lang="/.test(html)) errors.push(`${file}: missing lang attribute on <html>`);
}

warnings.forEach((w) => console.log(`::warning::${w}`));
errors.forEach((e) => console.log(`::error::${e}`));
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
