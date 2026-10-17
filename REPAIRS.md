# Repaired deployment package — 2026-10-16

Automatic Stripe price/webhook setup, direct-to-checkout memberships and automatic Printify production remain enabled as originally configured. No new customer approval steps were added.

## Functional repairs

- Paid orders automatically retry after Printify submission failures, with persistent retry times and a worker that runs each minute.
- Before retrying, the app looks for the existing Printify external reference. A lost API response no longer causes a second order in the tested recovery path.
- Temporary send-to-production failures also retry automatically. Concurrent retry calls do not create duplicate submissions within the normal lease window.
- Store payment/expiration events match the saved checkout session, so another storefront's local order number does not update this storefront's order.
- Failed emails persist in a SQLite outbox and retry automatically. Existing Resend SMTP credentials are automatically reused over HTTPS when the password is a Resend API key, avoiding blocked SMTP ports. Other SMTP providers remain supported.
- Stripe startup configuration retries after temporary errors rather than requiring a process restart.
- Fresh installation succeeds before `.env` exists, applies the packaged Printify configuration, and upgrades unsupported early Node 22 releases.
- Update rollback now also covers code-copy, dependency-install and restart failures. Database backup failures stop updates before code changes.
- The integration check reports failure through its exit status, recognizes Resend HTTPS, and does not count preview products as sellable stock.
- The natal chart accepts optional birthplace latitude/longitude and displays the ascendant, midheaven, 12 whole-sign houses and planet house placements for Saint members. Missing coordinates retain the existing planet-only result. Date/coordinate input is validated.
- New interface text is translated into Spanish and Portuguese. The English-only reading library and PDF guides are identified on localized library, guide and pricing pages; their substantive content has not been translated.
- Deployment instructions accurately describe the existing automatic Printify configuration merge and the email/recovery behavior.

## Verification

- 28 smoke checks passed, including natal house output and invalid/missing input cases.
- 33 offline payment checks passed, including automatic failure recovery, lost-response reconciliation, production retry, store event routing and persistent email delivery.
- Crawl: 740 sampled page visits across visitor/member states and English/Spanish/Portuguese; no problems reported.
- Deployment regressions passed: missing `.env`, dependency failure, Printify configuration merging, repeat updates, automatic Resend HTTPS credential reuse, and integration-check failure exit status.
- Spanish and Portuguese interface translation checks: 585/585 keys each. The reading library remains English.
- Shell and edited JavaScript syntax checks passed.

Tests used disposable databases and simulated services, with no real payments, production orders, emails or live deployments. Browser plugin was not available. Rendered browser QA could not run because the Chromium download returned an invalid archive; DOM/HTTP checks passed, but desktop/mobile rendering remains unverified. The VPS installer was checked with isolated function tests and shell syntax, not executed against a real VPS.

## Deploy

Use the existing commands in DEPLOY-NOW.md. Existing live Stripe and email credentials are retained; packaged Printify settings are merged automatically. Run `npm test` locally to repeat the functional suites. Run `npm run check` on the configured server to inspect its integrations.
