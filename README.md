# Sruthi Arts

Fairy-tale inspired art by Sruthi: ludo boards, clocks, original paintings and prints. The site is static HTML, CSS and JavaScript hosted free on GitHub Pages, with a built-in admin for editing everything without code.

## How it works

```
content/                  everything the admin edits
  items/<link-name>.json  one file per shop item (the file name becomes its link, e.g. #golden-forest)
  pages.json              page text: headline, intro, about, how to buy, contact, footer
  settings.json           Instagram, email, PayPal, currency
site/
  index.html              one-page shop: hero, shop, about, how to buy, contact
  admin/                  Sveltia CMS editor (index.html + config.yml)
  images/paintings/       uploaded photos
  assets/                 styles.css, app.js, fairy.js
  data/shop.json          built from content/ during deploy (not committed)
scripts/build-data.mjs    builds site/data/shop.json from content/
scripts/validate.mjs      checks run before every deploy
.github/workflows/pages.yml
```

Pushing to `main` builds `shop.json`, runs the checks and, if they pass, deploys `site/` to GitHub Pages. Pull requests run the checks only.

## Admin

Open **https://anilkumardvr.github.io/SruthiArts/admin/** (there's also an "Admin" link in the site footer).

| In the admin | What it changes on the site |
| --- | --- |
| **Shop items** → New item | Adds a post to the shop: photo, title, category, description, price, Available/Sold, medium and size. Newest first. |
| **Shop items** → open an item | Edit or delete it, swap the photo, or mark it Sold (hides the price and Buy button). |
| **Website → Page text** | Every heading and paragraph: headline, intro, About the artist (plus an optional photo), How to buy steps, contact text, footer. |
| **Website → Contact & payment** | Instagram username, email, PayPal.me username (turns on Buy with PayPal), currency. |

Photos from a phone are resized and converted to WebP automatically. Every **Save** commits to `main`, and the live site updates about a minute later.

### Logging in

1. The admin needs a GitHub account with write access to this repo (repo **Settings → Collaborators → Add people**).
2. Signed in as that account: **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
3. Repository access: **Only select repositories → SruthiArts**. Permissions: **Contents: Read and write**. Pick an expiry date.
4. On the admin page choose **Sign In Using Access Token** and paste it. The browser remembers it; when it expires, make a new one the same way.

For a one-click **Sign In with GitHub** button instead of a token, deploy the free [sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth) worker on Cloudflare and add its URL as `base_url` under `backend` in `site/admin/config.yml`.

## Payments

With a PayPal.me username in **Contact & payment**, each available item shows **Buy with PayPal** with the price already filled in (for example `paypal.me/<username>/249CAD`). An item can use its own PayPal link through the optional **Custom PayPal link** field. Without a PayPal username, the button becomes **Buy on Instagram**.

PayPal doesn't know an item is one of a kind, so mark it **Sold** in the admin as soon as a payment arrives. If the buying process changes, update the **How to buy** steps in Page text to match.

## Editing by hand

Add `content/items/rose-lantern.json` and put its photo in `site/images/paintings/`:

```json
{
  "title": "Rose Lantern",
  "category": "originals",
  "image": "images/paintings/rose-lantern.webp",
  "alt": "What the photo shows, for screen readers",
  "description": "One or two sentences about the piece.",
  "medium": "Acrylic on canvas",
  "width": 40,
  "height": 50,
  "price": 260,
  "status": "available",
  "date": "2026-10-01T10:00"
}
```

`category` is one of `ludo-boards`, `clocks`, `originals` or `prints`. `width` and `height` are in centimetres.

## Preview locally

```bash
node scripts/build-data.mjs && node scripts/validate.mjs   # same steps CI runs
cd site && python3 -m http.server 8000                     # then open http://localhost:8000
```

## One-time GitHub Pages setup

Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site is served at `https://anilkumardvr.github.io/SruthiArts/`.

## History

Until September 2026 this was an ASP.NET Core 8 Razor Pages app with SQLite. It was replaced with a static site because the data was read-only, .NET 8 support ends November 2026, and static hosting on GitHub Pages is free. The old code is in the git history.
