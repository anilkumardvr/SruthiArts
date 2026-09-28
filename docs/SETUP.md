# Turning on PayPal checkout, automatic stock and WhatsApp alerts

The site works without any of this: buyers use the PayPal.me link or Instagram, and Sruthi updates stock by hand in the studio. Follow these steps once to switch on real checkout. Everything below uses free plans; PayPal takes its usual fee per sale.

How it fits together:

```
Buyer adds pieces to the cart ──► enters delivery address (or picks Pickup) ──► pays with PayPal or card
        │
        ▼
Cloudflare Worker (worker/worker.js)
  1. checks stock and real prices in content/items/*.json, adds the delivery fee from settings
  2. creates and captures the PayPal order
  3. lowers "quantity" in the repo for each piece (0 = Sold)  ──► site redeploys (~1 min)
  4. saves the order with the address privately (Cloudflare KV)  ──► Studio → Orders
  5. sends Sruthi a WhatsApp message with the items, amount and address
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
3. Leave **Test mode** on for now: the cart then only appears at `https://www.sruthiarts.com/?test`, so customers can't see it while you test with sandbox money.
4. Set the **Delivery & pickup** fees (Canada, USA, rest of the world) and whether pickup is offered.
5. **Save settings**, then **Test connection**. All four checks should turn green (GitHub login is optional; see step 7).

About a minute later, every available piece at `/?test` shows **Add to cart** and **Buy now**. Then update **Page → How to buy** so the steps describe paying with PayPal.

## 6. Test, then go live

1. With `PAYPAL_ENV = sandbox`, buy something using a **sandbox buyer** account from developer.paypal.com → Sandbox accounts.
2. Check that the quantity went down on the site, the order appears in **Studio → Orders**, and the WhatsApp message arrived.
3. Switch to live: set `PAYPAL_ENV = live`, replace `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` with the **Live** credentials, put the live Client ID in **Studio → Settings**, and turn **Test mode** off. Update **Page → How to buy** to describe the cart.

**Studio → Orders** lists every order with the delivery address, phone and email. Filter by status or product, switch to **By product** to see who gets each piece, copy addresses, add tracking numbers, and **Download CSV** for shipping labels.

## 7. Optional: "Continue with GitHub" login for the studio

Instead of pasting a token:
1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
   Homepage: `https://www.sruthiarts.com/`. Callback URL: `https://<your worker address>/callback`.
2. Add Worker text variable `GITHUB_OAUTH_CLIENT_ID` and secret `GITHUB_OAUTH_CLIENT_SECRET`.
3. The studio login page now shows **Continue with GitHub**. The account must be a collaborator on the repo.
4. The classic editor can use the same login: add `base_url: https://<your worker address>` under `backend:` in `site/admin/classic/config.yml`.

## 8. Optional: move the Worker to api.sruthiarts.com

The Worker works at its `*.workers.dev` address, but a custom domain looks tidier and turns on Cloudflare's edge cache for live stock (`/api/stock`). On `workers.dev` the Worker still caches stock for 10 seconds in memory, so this is optional. `sruthiarts.com` must already be in the same Cloudflare account ([DOMAIN.md](DOMAIN.md)).

1. Add the domain, either way:
   - **Dashboard:** Worker → **Settings → Domains & Routes → Add → Custom domain**, enter `api.sruthiarts.com`. Cloudflare creates the DNS record and certificate.
   - **Command line:** in `worker/wrangler.toml`, uncomment the `routes` block with `api.sruthiarts.com`, then `npx wrangler deploy` (or push, and `.github/workflows/worker.yml` deploys it).
2. Open `https://api.sruthiarts.com/`. It should show the same health check as the old address.
3. **Studio → Settings → Checkout → Checkout server URL**: change it to `https://api.sruthiarts.com`, **Save settings**, then **Test connection**. The shop uses the new address after the next deploy (about a minute).
4. If you set up "Continue with GitHub" (step 7), change the OAuth App's callback URL to `https://api.sruthiarts.com/callback`, and any `base_url` in `site/admin/classic/config.yml`.
5. Leave the `workers.dev` address switched on for a day, so pages that are already open keep working. Then you can turn it off under **Settings → Domains & Routes**.

`ALLOWED_ORIGINS` doesn't change: it lists the shop's address, not the Worker's.

## 9. Auctions (timed bidding)

Auctions run on the same Worker: one small **Durable Object** per auction keeps the bids and takes them one at a time, an alarm closes it at the end time, and an hourly **Cron Trigger** cancels orders nobody paid for within 48 hours. Bidders confirm their email with a 6-digit code sent by **Resend**. Everything works on the `workers.dev` address; no custom domain is needed.

### 9a. Resend (email codes, outbid and winner emails)

1. Create a free account at **resend.com** (3,000 emails a month).
2. **Domains → Add domain** → `sruthiarts.com`. Resend lists a few DNS records (an MX and TXT record for `send`, and a DKIM TXT record).
3. In Cloudflare → `sruthiarts.com` → **DNS → Records**, add each record exactly as shown, with **Proxy status: DNS only**. (Or use Resend's **Sign in to Cloudflare** button, which adds them for you.) Back in Resend, click **Verify**. It usually passes within minutes.
4. **API Keys → Create API key**, permission **Sending access**, domain `sruthiarts.com`. Copy it; it's shown once.
5. Worker → **Settings → Variables and Secrets** → add **Secret** `RESEND_API_KEY` with that key.

Emails come from `Sruthi Arts <auctions@sruthiarts.com>`. To use another address on the same verified domain, add a text variable `RESEND_FROM`, e.g. `Sruthi Arts <hello@sruthiarts.com>`. Replies go nowhere unless that address exists (Cloudflare **Email Routing** can forward it to Sruthi's inbox).

### 9b. BIDDER_SECRET

Bidder logins are signed with a secret only the Worker knows. Generate a long random string (for example `openssl rand -base64 48`, or any password manager's 40+ character password) and add it as **Secret** `BIDDER_SECRET`. Changing it later signs every bidder out; they just confirm their email again.

### 9c. Durable Object, migration and cron

`worker/wrangler.toml` already declares everything:

- `[[durable_objects.bindings]]`: `AUCTION` → class `Auction`
- `[[migrations]]` tag `v1` with `new_sqlite_classes = ["Auction"]` (SQLite-backed, available on the free plan)
- `[triggers] crons = ["0 * * * *"]` (hourly)

The migration runs once, on the next deploy. **Never edit or delete a migration that has been deployed**; add a new one with a new tag instead.

**Before deploying:** `wrangler.toml` still has `id = "REPLACE_WITH_KV_NAMESPACE_ID"` under `[[kv_namespaces]]`. Replace it with the id of your `ORDERS` namespace (Cloudflare → **Storage & Databases → KV**, or `npx wrangler kv namespace list`). A deploy with the placeholder fails, and a deploy with the wrong id would point orders at an empty namespace.

Then redeploy the Worker, either way:
- **With wrangler (recommended):** `cd worker && npx wrangler deploy`. This applies the binding, the migration and the cron from `wrangler.toml` in one go. Pushing to `main` does the same through `.github/workflows/worker.yml` when the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets are set.
- **From the dashboard:** Worker → **Edit code**, paste the new `worker/worker.js`, **Deploy**. Then **Settings → Bindings → Add → Durable Object**: variable `AUCTION`, class `Auction`, and **Settings → Triggers → Cron Triggers → Add** `0 * * * *`. If the dashboard doesn't offer the `Auction` class, deploy once with wrangler instead.

Check: the Worker's address shows `"auctions": true` on the health page once `RESEND_API_KEY` and `BIDDER_SECRET` are set, and **Triggers → Cron Triggers** lists `0 * * * *`.

### 9d. Running an auction

Studio → **+ New post** → switch on **Auction**, then set the starting bid, bid step, end time (your local time) and an optional reserve. The piece appears in **Auctions** above the shop, not in the cart. **Studio → Auctions** shows every bidder's name, email, amount and time, and has **Close now** and **Offer to next bidder**. The winner gets an email with a link to pay within 48 hours. If they don't pay, the hourly cron cancels their order and tells you on WhatsApp; then use **Offer to next bidder**.

## 10. Switching to automatic PayPal checkout (PayPal Business + REST app)

PayPal.me needs only a personal account, but you check each payment by hand. Automatic checkout (card or PayPal on the site, payer details recorded by themselves) needs:

1. A **PayPal Business** account. Upgrade the personal one for free at paypal.com → **Settings → Account type**; the same email and balance carry over.
2. A **REST app**: developer.paypal.com → **Apps & Credentials → Create App** (Merchant). Start on the **Sandbox** tab.
3. Worker variables: `PAYPAL_CLIENT_ID` (text) and `PAYPAL_CLIENT_SECRET` (**Secret**), `PAYPAL_ENV = sandbox`.
4. Studio → **Settings → Checkout** → **Automatic PayPal checkout**, paste the same client ID, **Save settings**, then **Check PayPal setup**. It shows whether both credentials are set on the server, whether PayPal accepts them, and whether you're in **sandbox** or **live**. The secret is never shown.
5. Test with a sandbox buyer, then repeat steps 2–4 on the **Live** tab with `PAYPAL_ENV = live`.

Auction winners pay the same way: PayPal Checkout when it's switched on, otherwise the PayPal.me link with the exact total for their country.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| No PayPal buttons | Studio → Settings: both the server URL and client ID are filled; wait a minute after saving. |
| "Checkout couldn't load" | The Worker address is wrong, or `ALLOWED_ORIGINS` doesn't match the shop address exactly. |
| Paid, but stock didn't change | The `GITHUB_TOKEN` secret expired or lacks Contents write. The order still appears in Orders with a warning. |
| Bidders get no code email | Resend → **Logs**. Usually the domain isn't verified yet or `RESEND_API_KEY` is missing. The health page shows `"auctions": false` until both secrets are set. |
| "Auctions aren't set up yet" | The Worker has no `AUCTION` Durable Object binding yet: redeploy with wrangler, or add the binding in the dashboard (step 9c). |
| No WhatsApp message | The Worker health page shows `"whatsapp": false`, or the CallMeBot key/number is wrong. Worker → Logs shows the error. |
