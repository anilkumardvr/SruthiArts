# Sruthi Arts

Original fairy-tale inspired paintings by Sruthi. The site is static HTML, CSS and JavaScript hosted free on GitHub Pages.

## How it works

```
site/
  index.html              one-page gallery: hero, paintings, about, how to buy, contact
  admin/                  Sveltia CMS editor (index.html + config.yml)
  data/paintings.json     every painting, plus contact details
  images/paintings/       painting photos
  assets/                 styles.css, app.js (gallery), fairy.js (pointer trail)
  404.html
scripts/validate.mjs      checks run before every deploy
.github/workflows/pages.yml
```

Pushing to `main` runs the checks, and if they pass, deploys `site/` to GitHub Pages. Pull requests run the checks only.

## Admin: add paintings without code

Open **https://anilkumardvr.github.io/SruthiArts/admin/** (there's also an "Admin" link in the site footer).

- **Log in:** choose **Sign In Using Access Token** and paste a GitHub token (see below). The browser remembers it.
- **Add a painting:** Gallery → Paintings and shop settings → **Add painting**. Fill in the title and link name, upload a photo, set the price and status, then click **Save**. Phone photos are resized and converted to WebP automatically.
- **Mark as sold:** change **Status** to Sold and save. The price is hidden and the Buy button disappears.
- **Shop settings:** Instagram username, PayPal.me username, email and currency.

Every save commits to `main`, and the site updates about a minute later.

### Getting a login token (one time)

1. The admin needs a GitHub account with write access to this repo (repo **Settings → Collaborators → Add people**).
2. Signed in as that account: **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
3. Repository access: **Only select repositories → SruthiArts**. Permissions: **Contents: Read and write**. Pick an expiry date and save the token somewhere safe.
4. Paste it on the admin login screen. When it expires, generate a new one the same way.

For a one-click "Sign in with GitHub" button instead of a token, deploy the free [sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth) worker on Cloudflare and add its URL as `base_url` under `backend` in `site/admin/config.yml`.

## Payments

With `artist.paypal` set to a PayPal.me username, each available painting shows **Buy with PayPal** with the price already filled in (for example `paypal.me/<username>/249CAD`). Buyers then message the Instagram account with their address. A painting can use its own PayPal link instead through the optional `paypalLink` field. Without a PayPal username, the button becomes **Buy on Instagram**.

PayPal doesn't know a painting is one of a kind, so mark it **Sold** in the admin as soon as a payment arrives.

## Add or update a painting by hand

1. Put the photo in `site/images/paintings/` (JPG or WebP, about 1600 px on the long side, portrait 4:5 looks best).
2. Add an entry to `site/data/paintings.json`:

```json
{
  "id": "rose-lantern",
  "title": "Rose Lantern",
  "description": "One or two sentences about the piece.",
  "medium": "Acrylic on canvas",
  "width": 40,
  "height": 50,
  "price": 260,
  "status": "available",
  "image": "images/paintings/rose-lantern.jpg",
  "alt": "What the painting shows, for screen readers"
}
```

`width` and `height` are in centimetres. Set `"status": "sold"` to keep a piece in the gallery while hiding its price. Each painting can be linked directly as `…/#rose-lantern`.

## Preview locally

```bash
cd site && python3 -m http.server 8000   # then open http://localhost:8000
node scripts/validate.mjs               # same checks CI runs
```

## One-time GitHub Pages setup

Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site is then served at `https://anilkumardvr.github.io/SruthiArts/`.

## History

Until September 2026 this was an ASP.NET Core 8 Razor Pages app with SQLite. It was replaced with a static site because the data was read-only, .NET 8 support ends November 2026, and static hosting on GitHub Pages is free. The old code is in the git history before the `modernize/static-site` branch.
