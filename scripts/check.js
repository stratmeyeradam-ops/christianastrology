// Verifies the live integrations using the keys in .env. Safe: read-only except where noted.
//   npm run check                 → test Stripe, Printify, SMTP, and config
//   npm run check -- --setup      → also create Stripe membership prices + register Printify webhooks
import { config, stripeEnabled, printifyEnabled, mailEnabled } from "../src/config.js";

const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); process.exitCode = 1; };
const setup = process.argv.includes("--setup");

console.log("\nSite");
config.appUrl.startsWith("https://") ? ok(`APP_URL ${config.appUrl}`) : warn(`APP_URL is ${config.appUrl} — must be https://yourdomain in production (cookies, Stripe redirects, webhooks).`);
config.adminEmails.length ? ok(`Admins: ${config.adminEmails.join(", ")}`) : bad("ADMIN_EMAILS is empty — nobody can reach /admin.");

console.log("\nStripe");
if (!stripeEnabled()) bad("STRIPE_SECRET_KEY not set.");
else {
  const { stripe, ensurePrices } = await import("../src/stripe.js");
  try {
    const acct = await stripe().accounts.retrieve();
    ok(`Key works — account ${acct.id} (${acct.settings?.dashboard?.display_name || acct.email || "unnamed"}), ${/^(sk|rk)_live_/.test(config.stripe.secretKey) ? "LIVE" : "TEST"} mode`);
    acct.charges_enabled ? ok("Charges enabled") : warn("Charges not enabled yet — finish Stripe account activation.");
  } catch (e) {
    bad(`Stripe key rejected: ${e.message}`);
  }
  config.stripe.webhookSecret.startsWith("whsec_")
    ? ok("Webhook secret set in .env")
    : ok("Webhook: the site creates its own through the Stripe API when it starts on its https:// domain (no dashboard step).");
  if (setup) {
    try {
      const p = await ensurePrices();
      ok(`Membership prices ready: ${Object.entries(p).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    } catch (e) {
      bad(`Creating prices failed: ${e.message}`);
    }
  }
}

console.log("\nPrintify");
if (!config.printify.token) bad("PRINTIFY_API_TOKEN not set (store shows the preview catalog).");
else {
  const printify = await import("../src/printify.js");
  try {
    const shops = await printify.listShops();
    const list = Array.isArray(shops) ? shops : shops.data || [];
    ok(`Token works — shops: ${list.map((s) => `${s.id} "${s.title}" (${s.sales_channel})`).join("; ") || "none"}`);
    if (!config.printify.shopId) bad("PRINTIFY_SHOP_ID not set — pick the id above (use an \"API\"/custom-integration shop).");
    else if (!list.some((s) => String(s.id) === String(config.printify.shopId))) bad(`PRINTIFY_SHOP_ID ${config.printify.shopId} isn't one of your shops.`);
    else {
      const products = await printify.getProducts({ force: true });
      const sellable = products.filter((p) => !p.demo);
      if (!sellable.length) bad(`Shop ${config.printify.shopId}: no real sellable products match this site's tag (preview catalog is not purchasable).`);
      else ok(`Shop ${config.printify.shopId}: ${sellable.length} sellable product(s)`);
      if (printify.catalogError()) bad(printify.catalogError());
    }
  } catch (e) {
    bad(`Printify token rejected: ${e.message}`);
  }
  config.printify.webhookSecret ? ok("Webhook secret set") : warn("Printify webhooks are not configured. Order tracking still polls automatically; use Confirm publishing in /admin for newly published products.");
  if (setup && printifyEnabled()) {
    if (!config.appUrl.startsWith("https://")) bad("Not registering Printify webhooks until APP_URL is your public https:// domain.");
    else
      try {
        const hooks = await printify.registerWebhooks();
        ok(`Registered ${hooks.length} webhooks → ${config.appUrl}/webhook/printify`);
      } catch (e) {
        bad(`Webhook registration failed: ${e.message}`);
      }
  }
}

console.log("\nEmail");
if (config.resend.apiKey) ok("Resend HTTPS API configured; delivery failures are queued and retried automatically.");
else if (!mailEnabled()) warn("Email is not configured — set RESEND_API_KEY or SMTP credentials; pending messages wait in the outbox.");
else {
  const nodemailer = (await import("nodemailer")).default;
  try {
    await nodemailer
      .createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined })
      .verify();
    ok(`SMTP login works (${config.smtp.host}:${config.smtp.port})`);
  } catch (e) {
    bad(`SMTP failed: ${e.message}`);
  }
}
console.log("");
process.exit(process.exitCode || 0);
