# Christian Astrology: christianastrology.org

A self-hosted Node.js site: community message board, Stripe memberships, a Printify-fulfilled store, the Mazzaroth/readings library, and a natal chart calculator, in **English, Español, and Português**.

No hosting-platform middleware. It's one Node process plus one SQLite file, behind Nginx. Deployment steps: **[DEPLOY.md](DEPLOY.md)**.

## Run locally

```bash
npm install
cp .env.example .env     # works with every key blank (store shows a preview catalog)
npm run dev              # http://127.0.0.1:3000
npm run smoke            # end-to-end tests on a throwaway database
npm run test:payments    # memberships + store flows against a fake Stripe/Printify (signed webhooks)
npm run check            # verifies Stripe / Printify / SMTP keys in .env
```

Requires Node ≥ 22.13 (uses the built-in `node:sqlite`). Dependencies: `express`, `stripe`, `nodemailer`.

## What's in it

| Area | Details |
|---|---|
| **Accounts** | Email + password (scrypt), email confirmation, 30-day sessions, password reset by email, board reply notifications (opt-out), profile/password change, rate-limited login/signup, honeypot against bots |
| **Memberships** (Stripe) | Pilgrim $10 · Devoted $20 · Saint $30 monthly with first-month intro prices. Checkout, webhooks, billing portal with prorated plan switching. Admin can "comp" a plan for free |
| **Member rewards** | Board ranks (Companion / Steward / Elder / Minister), store discounts 10/20/30% applied at checkout, gated readings, quizzes, PDF guides, full natal chart, priority prayer marker, the Sunday Letter (email + on-site archive) |
| **Message board** | Categories, threads, replies. Devoted+ can post. Authors edit/delete their own posts. Admins pin/lock/move/delete and ban users |
| **Store** (Printify) | Live catalog from your Printify API shop, variant images, cart, Stripe Checkout, automatic Printify order creation, publish confirmation, order status + tracking via webhooks, shipping emails |
| **Admin** (`/admin`) | Member stats and estimated MRR, member search/ban/comp/reset link, store orders (retry, send to production, refresh), integration buttons, Sunday Letter composer, newsletter CSV |
| **Languages** | `/es/…` and `/pt/…` URLs, language menu, `hreflang` tags, localized dates/currency, Stripe Checkout and emails in the visitor's language |

## Project layout

```
server.js             routes
src/config.js         all settings (from .env)
src/db.js             SQLite schema + additive migrations
src/auth.js           sessions, passwords, rate limiting
src/plans.js          membership tiers, ranks, discounts, gating (single source of truth)
src/stripe.js         subscriptions, store checkout, portal, webhook
src/printify.js       catalog, orders, publishing, webhooks
src/letters.js        the Sunday Letter
src/mail.js           Resend HTTPS / SMTP with a durable retry outbox
src/i18n.js           locale detection + t()
src/i18n/{es,pt}.json UI translations (key = English text)
src/views/*.js        HTML templates
data/*.json           signs, articles, quizzes, 1,560 readings (English source)
data/i18n/{es,pt}/    translated signs/articles/quizzes (+ sentences.json for readings)
private/guides/       member PDF downloads (served only to entitled members)
deploy/               systemd unit + Nginx config
scripts/              smoke tests, key checker, backup, translation tools
```

## Translations

- **UI text:** wrap strings in `t("English text")` and add the same key to `src/i18n/es.json` and `src/i18n/pt.json`. `npm run i18n` lists anything missing.
- **Signs, articles, quizzes:** `data/i18n/<lang>/*.json`, keyed by slug, fields override the English.
- **Readings library (1,560 readings, about 4,800 unique sentences):** `node scripts/i18n-readings.js export` writes every unique sentence to `data/i18n/readings-source.json`. Put translations in `data/i18n/<lang>/sentences.json` as `{ "English sentence": "translation" }`. Coverage can be partial, and untranslated sentences fall back to English. `npm run i18n` reports progress.

## SEO & ads

Google/Bing/Yandex verification tags and Google AdSense are set in `.env` (see the end of `.env.example`). `/ads.txt` and a 3-language `/sitemap.xml` are generated automatically. Ads show only to non-members and never on account, checkout, pricing, or admin pages.
