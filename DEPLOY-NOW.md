# Updating the live site with this package

This package updates the site's code and merges the Printify settings in `deploy/env.add` into `.env`, including automatic production. Stripe keys, email settings and admin emails are preserved. Existing members, orders and board posts are preserved; additive database columns are created on startup. The update backs up code, configuration and the database first, and rolls back if the new version fails to start.

```bash
# 1. Copy the zip to the server and unpack it somewhere temporary
scp christianastrology-deploy.zip user@YOUR-SERVER:/tmp/
ssh user@YOUR-SERVER
cd /tmp && rm -rf christ && unzip -q christianastrology-deploy.zip -d christ && cd christ

# 2. Update (backs up, installs, restarts, health-checks, rolls back on failure)
sudo bash deploy/deploy.sh update
```

What happens automatically on the first start:

- **Printify:** `deploy/env.add` writes the working Printify token, the shop (shared, tag `christianastrology`)
  and auto-production into the server's `.env`. Paid orders go straight to printing; tracking and
  "your order shipped" emails are checked every 20 minutes. No Printify webhooks needed.
- **Stripe:** the site checks its key, creates the three membership prices if missing, and creates its own
  webhook through the Stripe API. The log shows `Stripe connected` and `Stripe webhook ready`.
- **Old sample products** are gone: the store sells only the six real products.

Check it worked: `sudo bash deploy/deploy.sh status` (or `journalctl -u christianastrology -n 50`).

**Needed on the server's `.env` for members to get their emails** (welcome, guide links, order and
shipping emails, password links, the Sunday Letter): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`SMTP_FROM` (Resend: host `smtp.resend.com`, user `resend`, password = Resend API key).
Resend SMTP credentials are automatically reused through its HTTPS API, so blocked SMTP ports do not prevent delivery. You may also set `RESEND_API_KEY` explicitly. Failed email is queued in SQLite and retried each minute.
The status check lists anything missing.

Paid orders that fail to reach Printify are retried automatically with backoff. The site looks up the existing external order reference before retrying so a lost response does not print a second order. Automatic production also retries if Printify is temporarily unavailable.

Keep this zip private: `deploy/env.add` contains the Printify token.
