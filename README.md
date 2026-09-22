# Sruthi Arts

Original fairy-tale inspired paintings by Sruthi. The site is static HTML, CSS and JavaScript hosted free on GitHub Pages.

## How it works

```
site/
  index.html              one-page gallery: hero, paintings, about, contact
  data/paintings.json     every painting, plus contact details
  images/paintings/       painting photos
  assets/                 styles.css, app.js (gallery), fairy.js (pointer trail)
  404.html
scripts/validate.mjs      checks run before every deploy
.github/workflows/pages.yml
```

Pushing to `main` runs the checks, and if they pass, deploys `site/` to GitHub Pages. Pull requests run the checks only.

## Add or update a painting

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

## Contact details

Fill `artist.email` and/or `artist.instagram` in `paintings.json`. The "Enquire" button opens an email with the painting's name in the subject.

## Preview locally

```bash
cd site && python3 -m http.server 8000   # then open http://localhost:8000
node scripts/validate.mjs               # same checks CI runs
```

## One-time GitHub Pages setup

Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site is then served at `https://anilkumardvr.github.io/SruthiArts/`.

## History

Until September 2026 this was an ASP.NET Core 8 Razor Pages app with SQLite. It was replaced with a static site because the data was read-only, .NET 8 support ends November 2026, and static hosting on GitHub Pages is free. The old code is in the git history before the `modernize/static-site` branch.
