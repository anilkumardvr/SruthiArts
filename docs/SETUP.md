# Turning on PayPal checkout, automatic stock and WhatsApp alerts

The site works without any of this: buyers use the PayPal.me link or Instagram, and Sruthi updates stock by hand in the studio. Follow these steps once to switch on real checkout. Everything below uses free plans; PayPal takes its usual fee per sale.

How it fits together:

```
Buyer taps "Pay" ──► PayPal checkout (card or PayPal)
        │
        ▼
Cloudflare Worker (worker/worker.js)
  1. checks stock and the real price in content/items/<item>.json
  2. creates and captures the PayPal order
  3. lowers "quantity" in the repo (0 = Sold)  ──► GitHub Actions redeploys the site (~1 min)
  4. saves the order privately (Cloudflare KV)  ──► Studio → Orders tab
  5. sends Sruthi a WhatsApp message with the item, amount and delivery address
```

Buyer details never go into the repo, because it's public.

## 1. PayPal app (about 5 minutes)

1. Sruthi needs a **PayPal Business** account (a personal account can be upgraded for free).
2. Go to **developer.paypal.com → Apps & Credentials**, log in with that account, and choose **Create App** (type: Merchant).
3. Start on the **Sandbox** tab for testing. Copy the **Client ID** and **Secret**.
4. Later, for real payments, repeat on the **Live** tab and swap in the live Client ID and Secret.

## 2. GitHub token for the Worker

The Worker updates stock by editing `content/items/*.json`.

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Repository access: **Only select repositories → SruthiArts**. Permissions: **Contents: Read and write**.
3. Copy the token. It goes into the Worker only, never into the site.

## 3. Cloudflare Worker (about 10 minutes)

1. Create a free account at **dash.cloudflare.com**.
2. **Storage & Databases → KV → Create namespace**, name it `ORDERS`.
3. **Workers & Pages → Create → Create Worker**, name it `sruthiarts-checkout`, **Deploy**, then **Edit code**. Replace everything with the contents of `worker/worker.js` and **Deploy**.
4. Worker → **Settings → Bindings → Add → KV namespace**: variable name `ORDERS`, namespace `ORDERS`.
5. Worker → **Settings → Variables and Secrets**. Add:

| Name | Type | Value |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | Text | `https://www.sruthiarts.com,https://sruthiarts.com,https://anilkumardvr.github.io` |
| `GITHUB_REPO` | Text | `anilkumardvr/SruthiArts` |
| `GITHUB_BRANCH` | Text | `main` |
| `PAYPAL_ENV` | Text | `sandbox` (change to `live` later) |
| `PAYPAL_CLIENT_ID` | Text | Client ID from step 1 |
| `PAYPAL_CLIENT_SECRET` | Secret | Secret from step 1 |
| `GITHUB_TOKEN` | Secret | Token from step 2 |

6. Open the Worker's address (for example `https://sruthiarts-checkout.<your-subdomain>.workers.dev/`). You should see `"checkout": true, "orders": true`.

Prefer the command line? `cd worker && npx wrangler kv namespace create ORDERS`, paste the id into `wrangler.toml`, `npx wrangler secret put PAYPAL_CLIENT_SECRET` (and the other secrets), then `npx wrangler deploy`. Adding repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` makes `.github/workflows/worker.yml` redeploy the Worker whenever `worker/` changes.

## 4. WhatsApp alerts (pick one)

**Option A — CallMeBot (free, 2 minutes).** A free third-party service, not run by Meta.
1. On Sruthi's WhatsApp, follow the current instructions at **callmebot.com → WhatsApp API** (you add their number and send them an activation message). They reply with an **API key**.
2. Add Worker secrets `CALLMEBOT_PHONE` (her number with country code, e.g. `+14165550123`) and `CALLMEBOT_APIKEY`.

**Option B — WhatsApp Cloud API (official, from Meta).** More setup and Meta charges per message.
1. At **developers.facebook.com**, create an app with the WhatsApp product and a sending phone number (it must be a different number from Sruthi's).
2. Create and get approval for a **Utility** message template named `new_order` with this body:
   `New order: {{1}} for {{2}}. Buyer: {{3}}. Ship to: {{4}}.`
3. Add Worker secrets `WHATSAPP_TOKEN` (a permanent system-user token), `WHATSAPP_TO` (Sruthi's number, digits only with country code), and text variable `WHATSAPP_PHONE_NUMBER_ID`. Optional: `WHATSAPP_TEMPLATE`, `WHATSAPP_LANG` (default `en`), `WHATSAPP_API_VERSION`.

The Worker health page shows `"whatsapp": true` when either option is set up.

## 5. Connect the shop

In the studio (**/admin → Settings → Checkout**):
1. **Checkout server URL**: the Worker address from step 3.
2. **PayPal client ID**: the same Client ID as the Worker (sandbox first).
3. **Save settings**, then **Test connection**. All four checks should turn green (GitHub login is optional; see step 7).

About a minute later every available item shows PayPal buttons. Then update **Page → How to buy** so the steps describe paying with PayPal.

## 6. Test, then go live

1. With `PAYPAL_ENV = sandbox`, buy something using a **sandbox buyer** account from developer.paypal.com → Sandbox accounts.
2. Check that the quantity went down on the site, the order appears in **Studio → Orders**, and the WhatsApp message arrived.
3. Switch to live: set `PAYPAL_ENV = live`, replace `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` with the **Live** credentials, and put the live Client ID in **Studio → Settings**.

## 7. Optional: "Continue with GitHub" login for the studio

Instead of pasting a token:
1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
   Homepage: `https://www.sruthiarts.com/`. Callback URL: `https://<your worker address>/callback`.
2. Add Worker text variable `GITHUB_OAUTH_CLIENT_ID` and secret `GITHUB_OAUTH_CLIENT_SECRET`.
3. The studio login page now shows **Continue with GitHub**. The account must be a collaborator on the repo.
4. The classic editor can use the same login: add `base_url: https://<your worker address>` under `backend:` in `site/admin/classic/config.yml`.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| No PayPal buttons | Studio → Settings: both the server URL and client ID are filled; wait a minute after saving. |
| "Checkout couldn't load" | The Worker address is wrong, or `ALLOWED_ORIGINS` doesn't match the shop address exactly. |
| Paid, but stock didn't change | The `GITHUB_TOKEN` secret expired or lacks Contents write. The order still appears in Orders with a warning. |
| No WhatsApp message | The Worker health page shows `"whatsapp": false`, or the CallMeBot key/number is wrong. Worker → Logs shows the error. |
