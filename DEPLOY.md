# Deploying christianastrology.org to a VPS

Handoff for whoever (or whichever agent) sets up the server. Plain stack, no middleware platforms:

**Namecheap DNS → VPS → Nginx (TLS via Let's Encrypt) → Node.js app (systemd) → SQLite file**

Payments go to Stripe and fulfilment to Printify over their APIs. Nothing else sits in between.

> **Deploying with an agent?** Use the step-by-step runbook **[deploy/APOLLO.md](deploy/APOLLO.md)** and the one-command script `deploy/deploy.sh` (install / update with automatic rollback / rollback / status). This file explains each piece in more depth.

---

## 0. What you need before starting

| Item | Where to get it |
|---|---|
| VPS IPv4 address (and IPv6 if any) | VPS provider panel |
| Ubuntu 22.04/24.04 or Debian 12 with sudo | — |
| Stripe secret key `sk_live_…` (or `sk_test_…` first) | Stripe → Developers → API keys |
| Printify personal access token | Printify → My profile → Connections |
| Resend API key (for email) | Resend → API Keys |
| The email address(es) that should be admins | the owner |

## 1. DNS at Namecheap

Namecheap → Domain List → christianastrology.org → **Advanced DNS**. Delete any parking / URL-redirect records, then add:

| Type | Host | Value | TTL |
|---|---|---|---|
| A | `@` | `<VPS IPv4>` | Automatic |
| A | `www` | `<VPS IPv4>` | Automatic |
| AAAA | `@` / `www` | `<VPS IPv6>` (only if the VPS has one) | Automatic |

Make sure **Nameservers = Namecheap BasicDNS**. Check with `dig +short christianastrology.org`; it can take a few minutes.

If the old site is hosted at Hostinger, these A records are what move traffic off it. Nothing on the old host needs to stay.

## 2. Server packages

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install nginx certbot python3-certbot-nginx git ufw
# Node.js 24 LTS (needs >= 22.13 for the built-in node:sqlite)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt -y install nodejs
node -v

sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw --force enable
sudo adduser --system --group --home /var/www/christianastrology christ
```

## 3. App files

Copy the project to `/var/www/christianastrology`, **excluding** `node_modules/`, `.env`, `.claude/` and **`data/app.db*`**. The local database holds demo/test accounts; production must start with a fresh one, which is created automatically on first start.

```bash
# from the machine that has the code:
rsync -av --exclude node_modules --exclude .env --exclude '.claude' --exclude 'data/app.db*' --exclude 'data/backups' \
  ./ user@VPS:/tmp/christ/
# on the VPS:
sudo rsync -a /tmp/christ/ /var/www/christianastrology/
cd /var/www/christianastrology
sudo cp .env.example .env && sudo nano .env      # fill in everything (see §4)
sudo npm ci --omit=dev
sudo chown -R christ:christ /var/www/christianastrology
sudo chmod 600 .env
```

## 4. `.env` values

All variables are documented in `.env.example`. In production:

- `APP_URL=https://christianastrology.org` (exact, no trailing slash)
- `PORT=3000`, `HOST=127.0.0.1` (only Nginx is public)
- `ADMIN_EMAILS=` the owner's email. They then **sign up on the site with that email and click the confirmation link** emailed to them. Admin access switches on only once the email is confirmed, so nobody else can claim it by signing up first. If email isn't working yet, confirm it from the server instead: `sudo -u christ npm run confirm-email -- owner@example.com`.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (see §6)
- `PRINTIFY_API_TOKEN`, `PRINTIFY_SHOP_ID`, `PRINTIFY_WEBHOOK_SECRET` (see §7)
- `SMTP_*` (see §8)

Then verify every key in one go:

```bash
sudo -u christ npm run check
```

## 5. systemd + Nginx + TLS

```bash
sudo cp deploy/christianastrology.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now christianastrology
curl -s http://127.0.0.1:3000/healthz            # → {"ok":true,...}

sudo cp deploy/nginx.conf /etc/nginx/sites-available/christianastrology
sudo ln -sf /etc/nginx/sites-available/christianastrology /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d christianastrology.org -d www.christianastrology.org --redirect -m <owner email> --agree-tos -n
```

Logs: `journalctl -u christianastrology -f`

## 6. Stripe

1. **Webhook: automatic.** With `STRIPE_SECRET_KEY` set and `APP_URL=https://christianastrology.org`, the site creates its own webhook endpoint through the Stripe API when it starts and keeps the signing secret in its database. The log shows `Stripe webhook ready`. Leave `STRIPE_WEBHOOK_SECRET` blank (set it only if you'd rather manage the endpoint yourself in the dashboard). It only ever touches the endpoint for this site's own URL.
2. **Products/prices** are created automatically: three monthly prices (Pilgrim $10, Devoted $20, Saint $30) plus first-month intro coupons. To create them up front, run `sudo -u christ npm run check -- --setup` or use the button at `/admin`.
3. **Customer portal:** the app creates its own portal configuration (cancel, update card, switch plans) the first time a member clicks "Manage billing". No dashboard setup is needed.
4. Billing → Subscriptions and emails: turn on **Smart Retries** and **"Send emails about failed payments"**. Members whose card fails keep access while Stripe retries ("past due"), then lose it if every retry fails.
5. Optional: enable **Stripe Tax** in the dashboard if sales tax collection is required.
6. Refunds: refund store orders from the Stripe dashboard. The site marks the order refunded and emails the admin. If it was already sent to Printify, cancel it there too. Chargebacks (disputes) also email the admin.
7. Nothing to test by hand. On startup the site checks its own Stripe connection, makes sure the three membership prices exist and sets up the webhook; the log shows `Stripe connected` and `Stripe webhook ready`. The full payment flows are covered by `npm run test:payments`.

## 7. Printify

1. The shop must be an **API / custom integration** shop. `npm run check` lists shops with their sales channel. If there is no API shop, create one in Printify (Add new store → API) and set `PRINTIFY_SHOP_ID`.
2. Set `PRINTIFY_WEBHOOK_SECRET` to a long random string (`openssl rand -hex 32`), restart, then register the webhooks **once the domain is live on https**:
   ```bash
   sudo -u christ npm run check -- --setup
   ```
   Or use **Admin → Register webhooks**. This subscribes to product publishing, product changes, order status, and shipments.
3. **How the store stays in sync:**
   - Create a product in Printify and click **Publish**. Printify notifies the site, and the site confirms the publish and shows the product (cached 10 min; "Refresh store catalog" in admin forces it).
   - Customer pays through Stripe Checkout. The site creates the Printify order with the shipping address.
   - With `PRINTIFY_AUTO_SEND=false` (default), the order waits "On hold" for approval: Admin → Store orders → *Send to production*, or approve in Printify. Set it to `true` to send automatically.
   - When Printify ships, the order shows tracking and the customer is emailed in their language.
4. Products stuck at "Publishing…" in Printify (e.g. published before webhooks existed): Admin → *Confirm products stuck in "Publishing"*.
5. Store pricing: the Printify retail price is what customers pay. Members get 10/20/30% off automatically, so set retail prices with enough margin.

## 8. Email (Resend)

Used for password resets, welcome emails, shipping notices, and the Sunday Letter. The app automatically uses Resend's HTTPS API with RESEND_API_KEY or a Resend key in SMTP_PASS. Other SMTP providers remain supported. Failed messages are kept in SQLite and retried automatically.

1. Resend → **Domains → Add domain** → `christianastrology.org`. Resend shows a few DNS records (an MX and TXT on the `send` subdomain for SPF, and a `resend._domainkey` TXT for DKIM). Add each one in **Namecheap → Advanced DNS** exactly as shown. Namecheap's "Host" field takes just the part before the domain, e.g. `send` or `resend._domainkey`. Click **Verify** in Resend.
2. Optional, but helps inbox placement: add a DMARC TXT record, Host `_dmarc`, Value `v=DMARC1; p=none;`.
3. Resend → **API Keys → Create** (Sending access, this domain). Put it in `.env`:
   ```
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=465
   SMTP_USER=resend
   SMTP_PASS=re_xxxxxxxxx
   SMTP_FROM="Christian Astrology <hello@christianastrology.org>"
   ```
4. Restart the service, then `npm run check` should show "SMTP login works". Then test with "Forgot your password?" on the live site.

Large Sunday Letter sends go out one at a time (about 4 per second), within Resend's default rate limit. Without email settings, messages remain in the outbox until credentials are configured; restart after changing .env.

## 9. Search engines & AdSense

The verification tags (Google, Bing, Yandex) and the AdSense code are already in the page `<head>`, and `/ads.txt` is served. All IDs are in `.env` and can be changed there. After the site is live on https:

- **Google Search Console:** add the property `https://christianastrology.org` (URL-prefix), choose "HTML tag" and click Verify. Then submit `https://christianastrology.org/sitemap.xml`. The sitemap lists every page in all three languages.
- **Bing Webmaster Tools / Yandex Webmaster:** add the site, choose the meta-tag method, and click Verify. Submit the same sitemap.
- **AdSense:** Sites → add `christianastrology.org` → it finds the code and ads.txt → request review.
  - Turn on **Auto ads** (no code changes needed).
  - Required for visitors in the EU/UK/Switzerland: AdSense → **Privacy & messaging → European regulations** → create and publish the consent message. Google then shows its own consent banner.
  - Ads appear only for signed-out and free visitors. Members never see ads, and no one sees them on account, checkout, pricing, or admin pages.

## 10. Backups

```bash
sudo crontab -u christ -e
# daily at 03:15 — keeps 14 days in data/backups/
15 3 * * * cd /var/www/christianastrology && /usr/bin/npm run -s backup
```

Everything that matters is in `data/app.db` (accounts, memberships mirror, board, orders) and `.env`. Copy `data/backups/` off the server periodically.

## 11. Updating the site later

```bash
rsync … (same excludes as §3)
cd /var/www/christianastrology && sudo npm ci --omit=dev && sudo chown -R christ:christ . && sudo systemctl restart christianastrology
```

Database changes are additive and apply automatically on start. CSS/JS URLs are versioned, so visitors never get stale styles.

## 12. Go-live checklist

- [ ] `https://christianastrology.org/healthz` returns `{"ok":true,"stripe":true,"printify":true}`
- [ ] `npm run check` is all ✓
- [ ] Owner signed up with the `ADMIN_EMAILS` address, confirmed the email, and sees ⚙ Admin
- [ ] Reply on a board thread from a second account → the first account gets a "New reply" email
- [ ] Test membership purchase → account shows the plan, board posting unlocked, discount shows in the store
- [ ] Test store order → appears in Admin → Store orders and in Printify
- [ ] Password reset email arrives
- [ ] `/es` and `/pt` render in Spanish and Portuguese
