// Central config. Values come from .env (loaded by `node --env-file-if-exists=.env`).
const env = process.env;

const appUrl = (env.APP_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, "");

export const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || "127.0.0.1",
  appUrl,
  secureCookies: appUrl.startsWith("https://"),
  siteName: env.SITE_NAME || "Christian Astrology",
  contactEmail: env.CONTACT_EMAIL || "hello@christianastrology.org",
  dbPath: env.DATABASE_PATH || "./data/app.db",
  adminEmails: (env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || "",
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
  },

  printify: {
    token: env.PRINTIFY_API_TOKEN || "",
    shopId: env.PRINTIFY_SHOP_ID || "",
    // The Printify shop is shared with cheatingpsychology: set PRINTIFY_PRODUCT_TAG=christianastrology so only
    // this site's products show here. Left blank, every product in the shop is sold.
    productTag: (env.PRINTIFY_PRODUCT_TAG || "").trim().toLowerCase(),
    webhookSecret: env.PRINTIFY_WEBHOOK_SECRET || "",
    // When true, paid orders are pushed straight to production (Printify charges your account).
    autoSend: (env.PRINTIFY_AUTO_SEND || "false").toLowerCase() === "true",
  },

  // Search-engine ownership tokens and AdSense. Public values (they appear in page HTML).
  // Set any to "" in .env to switch it off.
  seo: {
    google: env.GOOGLE_SITE_VERIFICATION ?? "h-XxXsaNbfY2dWmueZFK5sQSuwXIFelBeB5ByCSWCCg",
    bing: env.BING_SITE_VERIFICATION ?? "79AA455B3A6A870379DCB6A9DEFF026C",
    yandex: env.YANDEX_VERIFICATION ?? "a1d444bd168e3c86",
  },
  adsensePublisher: env.ADSENSE_PUBLISHER_ID ?? "pub-3415300754694996",

  smtp: {
    host: env.SMTP_HOST || "",
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || "",
    pass: env.SMTP_PASS || "",
    from: env.SMTP_FROM || `"${env.SITE_NAME || "Christian Astrology"}" <${env.CONTACT_EMAIL || "hello@christianastrology.org"}>`,
  },

  store: {
    currency: "usd",
    shippingCents: Number(env.STORE_SHIPPING_CENTS || 699),
    freeShippingOverCents: Number(env.STORE_FREE_SHIPPING_OVER_CENTS || 0),
    countries: (env.STORE_SHIP_COUNTRIES || "US,CA")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  },

  // Resend HTTPS API. Preferred on hosts where outbound SMTP is firewalled (see mail.js).
  resend: {
    apiKey: env.RESEND_API_KEY || (env.SMTP_HOST === "smtp.resend.com" && env.SMTP_PASS?.startsWith("re_") ? env.SMTP_PASS : ""),
  },
};

export const stripeEnabled = () => Boolean(config.stripe.secretKey);
export const printifyEnabled = () => Boolean(config.printify.token && config.printify.shopId);
export const mailEnabled = () => Boolean(config.smtp.host);
