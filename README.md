# Sruthi Arts

Fairy-tale inspired art by Sruthi: ludo boards, clocks, original paintings and prints. The storefront is a Vite + React + TypeScript app styled with Tailwind CSS and shadcn/ui, built to static files and hosted free on GitHub Pages, with a built-in admin for editing everything without code.

## How it works

```
content/                  everything the admin edits
  items/<link-name>.json  one file per shop item (the file name becomes its link, e.g. #golden-forest)
  pages.json              page text: headline, intro, about, how to buy, contact, footer
  settings.json           Instagram, email, PayPal, currency
storefront/               the shop: Vite + React + TypeScript + Tailwind + shadcn/ui
  src/App.tsx             one-page shop: hero, shop, about, how to buy, contact
  src/components/         gallery, product viewer, cart and checkout; ui/ holds the shadcn/ui components
  src/lib/shop.ts         shop rules: stock, prices, delivery fees, checkout settings
  src/index.css           blush pink theme (shadcn/ui colour tokens)
site/                     copied into the built site as-is (Vite's public folder)
  admin/                  Studio: Instagram-style admin (index.html, admin.js, admin.css)
  admin/classic/          backup editor (Sveltia CMS)
  images/paintings/       uploaded photos
  data/shop.json          built from content/ during deploy (not committed)
scripts/build-data.mjs    builds site/data/shop.json from content/
worker/                   Cloudflare Worker: PayPal checkout, stock updates, orders, WhatsApp alerts
docs/SETUP.md             one-time setup for checkout, alerts and GitHub login
docs/DOMAIN.md            connecting www.sruthiarts.com
scripts/validate.mjs      checks run before every deploy
.github/workflows/pages.yml
```

Pushing to `main` runs one job that builds `shop.json`, runs the checks, builds the storefront into `storefront/dist/` (with `site/admin`, `site/images` and `data/shop.json` copied in) and, if everything passes, deploys it to GitHub Pages. Pull requests run the checks and the build only.

## Studio (admin)

Open **https://www.sruthiarts.com/admin/** (also linked as "Admin" in the site footer). It works like posting on Instagram and is built for phones first.

| In the studio | What it does |
| --- | --- |
| **+ / New post** | Pick a photo, write a caption, choose a category, set the price and how many are available, then **Share**. Photos are resized and converted to WebP on the phone before uploading. |
| **Posts** grid | Tap a post to change stock with the + / − buttons, mark it sold, relist it, edit it or delete it. |
| **Orders** | Every PayPal sale, with the buyer and delivery address. **Mark shipped** when it's sent. |
| **Page** | Every heading and paragraph on the site, plus an optional photo for About. |
| **Settings** | Instagram, email, currency, and the checkout connection. |

Each save is a commit to `main`. The top bar shows **Publishing…** and then **Live** once GitHub Actions has redeployed the site.

**Logging in:** paste a GitHub fine-grained token (repo **SruthiArts**, **Contents: Read and write**), or use **Continue with GitHub** after setting up the optional login in [docs/SETUP.md](docs/SETUP.md). The token is stored in that browser only; use **Settings → Sign out** on shared devices.

## Stock, checkout and alerts

Each item has a **quantity**. The shop shows "N available" or "Sold out". With checkout switched on, a PayPal purchase lowers the quantity automatically and marks the item Sold at 0, the order appears in the studio, and Sruthi gets a WhatsApp alert. Until then, buyers use the PayPal.me link or Instagram, and stock is updated by hand in the studio.

Setup steps: [docs/SETUP.md](docs/SETUP.md).

### What shows up right away, and what waits for a deploy

Every Studio save is a commit, and GitHub Actions rebuilds and redeploys the site in about a minute. With the checkout server set up (**Settings → Checkout server URL**), the shop also asks the server for live stock (`GET /api/stock`) when the page loads, when a visitor comes back to the tab, and when the cart opens (the cart shows straight away and updates if anything changed). So some changes show up much sooner:

| Studio change | Shows on the site |
| --- | --- |
| Stock (the + / − buttons), marking sold, relisting | Within about 10 seconds |
| Price | Within about 10 seconds |
| Text, captions, sizes, categories, page text, settings | After the deploy (about a minute) |
| New posts, deleted posts, photos | After the deploy (about a minute) |

The server keeps its answer for 10 seconds, so a change can take that long to appear. A new post only appears once the deploy has published its photos and text. If the server can't be reached, the shop quietly uses the stock from the last deploy.

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
  "quantity": 1,
  "status": "available",
  "date": "2026-10-01T10:00"
}
```

`category` is one of `ludo-boards`, `clocks`, `originals` or `prints`. `quantity` is how many are left (default 1). `width` and `height` are in centimetres.

## Preview locally

```bash
node scripts/build-data.mjs && node scripts/validate.mjs   # same checks CI runs
cd storefront && npm install
npm run dev                                                # then open the address it prints
npm run build && npm run preview                           # the production build, as deployed
```

Add `?test` to the address to see the cart while checkout is in test mode.

## One-time GitHub Pages setup

Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site is served at `https://www.sruthiarts.com` (the old `anilkumardvr.github.io/SruthiArts` address redirects there) ([docs/DOMAIN.md](docs/DOMAIN.md)).

## History

Until September 2026 this was an ASP.NET Core 8 Razor Pages app with SQLite. It was replaced with a static site because the data was read-only, .NET 8 support ends November 2026, and static hosting on GitHub Pages is free. The old code is in the git history.
