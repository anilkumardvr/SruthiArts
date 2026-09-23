# Connecting www.sruthiarts.com

The site stays on GitHub Pages (free). You buy the domain at Cloudflare and point it at GitHub. Visitors will see **https://www.sruthiarts.com**, and `sruthiarts.com` without "www" redirects there.

## 1. Buy the domain (Cloudflare Registrar)

1. Log in at **dash.cloudflare.com** (the same account you'll use for the checkout Worker).
2. **Domain Registration → Register Domains**, search `sruthiarts.com`, and buy it. Cloudflare charges the registry price with no markup, and WHOIS privacy is included.
3. Cloudflare sets up DNS for the domain automatically.

## 2. Prove to GitHub that you own it (stops anyone else from claiming it)

1. GitHub → your profile picture → **Settings → Pages → Add a domain**, enter `sruthiarts.com`.
2. GitHub shows a **TXT** record (name like `_github-pages-challenge-anilkumardvr`). Add it in Cloudflare → `sruthiarts.com` → **DNS → Records → Add record**, then click **Verify** on GitHub.

## 3. DNS records in Cloudflare

In **DNS → Records**, add these with **Proxy status: DNS only** (grey cloud). GitHub has to see the records directly to issue the HTTPS certificate.

| Type | Name | Content |
| --- | --- | --- |
| CNAME | `www` | `anilkumardvr.github.io` |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |

Delete any other A, AAAA or CNAME records for `@` or `www` that Cloudflare added.

## 4. Tell GitHub Pages to use it

1. Repo **SruthiArts → Settings → Pages → Custom domain**: enter `www.sruthiarts.com` and **Save**.
2. Wait for the DNS check to pass (a few minutes, occasionally up to an hour), then tick **Enforce HTTPS**.
3. Open https://www.sruthiarts.com and https://sruthiarts.com. Both should show the shop, and the second should redirect to the first.

The old address `anilkumardvr.github.io/SruthiArts` redirects to the new domain automatically.

## 5. Update the checkout pieces

Once the domain works:

- **Cloudflare Worker → Settings → Variables**: set `ALLOWED_ORIGINS` to
  `https://www.sruthiarts.com,https://sruthiarts.com,https://anilkumardvr.github.io`
- **GitHub OAuth App** (if you set up "Continue with GitHub"): change the Homepage URL to `https://www.sruthiarts.com/`. The callback URL stays on the Worker.
- **Classic editor**: in `site/admin/classic/config.yml`, change `site_url` and `display_url` to `https://www.sruthiarts.com/`.
- The studio is then at **https://www.sruthiarts.com/admin/**. Log in again there, because logins are remembered per website address.

## Optional: an email address @sruthiarts.com

Cloudflare **Email Routing** (free) can forward `hello@sruthiarts.com` to Sruthi's existing inbox. Enable it under the domain → **Email → Email Routing**, then add the address in **Studio → Settings → Email**.
