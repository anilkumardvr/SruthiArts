// Pre-deploy checks for the static site. Zero dependencies — runs on plain Node 20+.
// Fails the build when the paintings data is malformed or a local file reference is broken.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

const SITE = new URL("../site/", import.meta.url).pathname;
const errors = [];
const warnings = [];

// 1. paintings.json shape
let data;
try {
  data = JSON.parse(readFileSync(join(SITE, "data/paintings.json"), "utf8"));
} catch (e) {
  errors.push(`data/paintings.json is not valid JSON: ${e.message}`);
}

if (data) {
  const required = { id: "string", title: "string", description: "string", medium: "string", width: "number", height: "number", price: "number", status: "string", image: "string", alt: "string" };
  const ids = new Set();
  if (!Array.isArray(data.paintings) || data.paintings.length === 0) errors.push("paintings must be a non-empty array");
  (data.paintings || []).forEach((p, i) => {
    const where = `paintings[${i}] (${p.title || p.id || "untitled"})`;
    for (const [k, t] of Object.entries(required)) {
      if (typeof p[k] !== t || (t === "string" && !p[k].trim())) errors.push(`${where}: "${k}" must be a non-empty ${t}`);
    }
    if (p.id && !/^[a-z0-9-]+$/.test(p.id)) errors.push(`${where}: id must be lowercase letters, digits and dashes (used in the page link)`);
    if (ids.has(p.id)) errors.push(`${where}: duplicate id "${p.id}"`);
    ids.add(p.id);
    if (p.status && !["available", "sold"].includes(p.status)) errors.push(`${where}: status must be "available" or "sold"`);
    if (p.image && !existsSync(join(SITE, p.image))) errors.push(`${where}: image not found at site/${p.image}`);
  });
  const a = data.artist || {};
  if (!a.email && !a.instagram) warnings.push("artist.email and artist.instagram are both empty — visitors have no way to enquire");
  if (a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) errors.push(`artist.email "${a.email}" is not a valid address`);

  // Unused images are harmless but usually a mistake
  const used = new Set((data.paintings || []).map((p) => p.image));
  for (const f of readdirSync(join(SITE, "images/paintings"))) {
    if (!used.has(`images/paintings/${f}`)) warnings.push(`images/paintings/${f} is not used by any painting`);
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
