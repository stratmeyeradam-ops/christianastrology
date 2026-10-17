// Stripe: membership subscriptions, store checkout, billing portal, webhooks.
import Stripe from "stripe";
import { createHash, randomBytes } from "node:crypto";
import { config, stripeEnabled } from "./config.js";
import { db, now } from "./db.js";
import { PLANS, GUIDES, planById, storeDiscountOf, tierOf } from "./plans.js";
import * as printify from "./printify.js";
import { getLocale, STRIPE_LOCALES, t, withLocale, localePath } from "./i18n.js";
import { sendMail } from "./mail.js";

let client;
export function stripe() {
  if (!stripeEnabled()) throw new Error("Stripe is not configured (set STRIPE_SECRET_KEY).");
  // STRIPE_API_BASE is only for the offline payment-flow tests (scripts/payments-test.js).
  const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
  client ??= new Stripe(config.stripe.secretKey, base ? { host: base.hostname, port: Number(base.port), protocol: base.protocol.replace(":", "") } : {});
  return client;
}

const lookupKey = (planId) => `ca_${planId}_monthly`;
let priceCache = null;
let productCache = null;
let portalConfigId = null;

/** Ensure one Product + monthly Price per plan exists (by lookup_key). Idempotent. */
let pricesInFlight = null;
export function ensurePrices() {
  if (priceCache) return Promise.resolve(priceCache);
  // Two simultaneous first checkouts must not both create products.
  pricesInFlight ??= loadOrCreatePrices().finally(() => (pricesInFlight = null));
  return pricesInFlight;
}

async function loadOrCreatePrices() {
  const s = stripe();
  const keys = PLANS.map((p) => lookupKey(p.id));
  const existing = await s.prices.list({ lookup_keys: keys, active: true, limit: 10 });
  const map = {};
  const products = {};
  for (const pr of existing.data) {
    const plan = PLANS.find((p) => lookupKey(p.id) === pr.lookup_key);
    if (plan && pr.unit_amount === plan.price * 100) {
      map[plan.id] = pr.id;
      products[plan.id] = typeof pr.product === "string" ? pr.product : pr.product.id;
    }
  }
  for (const plan of PLANS) {
    if (map[plan.id]) continue;
    const product = await s.products.create({
      name: `${config.siteName} — ${plan.name} Membership`,
      description: plan.blurb,
      metadata: { plan: plan.id },
    });
    const price = await s.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: plan.price * 100,
      recurring: { interval: "month" },
      lookup_key: lookupKey(plan.id),
      transfer_lookup_key: true,
      metadata: { plan: plan.id },
    });
    map[plan.id] = price.id;
    products[plan.id] = product.id;
  }
  productCache = products;
  priceCache = map;
  return map;
}

/** First-month intro coupon (amount off, once). Created on demand. */
async function ensureIntroCoupon(plan) {
  if (!plan.introPrice) return null;
  const off = (plan.price - plan.introPrice) * 100;
  const id = `ca_${plan.id}_intro_${off}`; // amount in the id: changing prices makes a fresh coupon
  const s = stripe();
  try {
    await s.coupons.retrieve(id);
  } catch (e) {
    if (e.code !== "resource_missing") throw e;
    await s.coupons.create({
      id,
      name: `${plan.name}: first month $${plan.introPrice}`,
      amount_off: off,
      currency: "usd",
      duration: "once",
    });
  }
  return id;
}

/** Checkout shows "Christian Astrology" (the Stripe account is shared). Stripe only fetches an https logo. */
const brandingSettings = () => ({
  display_name: "Christian Astrology",
  ...(config.appUrl.startsWith("https://") ? { icon: { type: "url", url: `${config.appUrl}/apple-touch-icon.png` } } : {}),
});

const LIVE = new Set(["active", "trialing", "past_due"]);
export const hasLiveSubscription = (user) => Boolean(user.stripe_subscription_id && LIVE.has(user.plan_status));

export async function createSubscriptionCheckout(user, planId, { next = "" } = {}) {
  const plan = planById(planId);
  if (!plan) throw new Error("Unknown plan");
  if (user && hasLiveSubscription(user)) return createPortal(user, { switchTo: plan.id });
  if (user?.stripe_customer_id) {
    const subs = await stripe().subscriptions.list({ customer: user.stripe_customer_id, status: "all", limit: 10 });
    const live = subs.data.find((s) => LIVE.has(s.status));
    if (live) {
      await applySubscription(live, user.id);
      const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      return createPortal(fresh, { switchTo: plan.id });
    }
  }
  const prices = await ensurePrices();
  const coupon = user?.stripe_subscription_id ? null : await ensureIntroCoupon(plan);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: prices[plan.id], quantity: 1 }],
    ...(coupon ? { discounts: [{ coupon }] } : { allow_promotion_codes: true }),
    client_reference_id: user ? String(user.id) : undefined,
    ...(user?.stripe_customer_id ? { customer: user.stripe_customer_id } : user?.email ? { customer_email: user.email } : {}),
    subscription_data: { metadata: { userId: user ? String(user.id) : "", plan: plan.id } },
    metadata: { kind: "membership", userId: user ? String(user.id) : "", plan: plan.id },
    locale: STRIPE_LOCALES[getLocale()],
    success_url: `${config.appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}${next ? `&next=${encodeURIComponent(next)}` : ""}`,
    cancel_url: `${config.appUrl}/pricing?canceled=1${next ? `&next=${encodeURIComponent(next)}` : ""}`,
    branding_settings: brandingSettings(),
  });
  return session.url;
}

/** Portal config that lets members upgrade/downgrade between the three plans. Created once per process. */
async function ensurePortalConfig() {
  if (portalConfigId) return portalConfigId;
  const prices = await ensurePrices();
  const s = stripe();
  // Tag the config with the current price ids: if prices ever change, a fresh config is made
  // (an old one would only allow switching between the old prices).
  const tag = createHash("sha256").update(PLANS.map((p) => prices[p.id]).join(",")).digest("hex").slice(0, 16);
  const existing = await s.billingPortal.configurations.list({ active: true, limit: 100 });
  const mine = existing.data.find((c) => c.metadata?.app === "christian-astrology" && c.metadata?.prices === tag);
  if (mine) return (portalConfigId = mine.id);
  const cfg = await s.billingPortal.configurations.create({
    metadata: { app: "christian-astrology", prices: tag },
    business_profile: {
      headline: `${config.siteName} membership`,
      privacy_policy_url: `${config.appUrl}/privacy`,
      terms_of_service_url: `${config.appUrl}/terms`,
    },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: PLANS.map((p) => ({ product: productCache[p.id], prices: [prices[p.id]] })),
      },
    },
  });
  return (portalConfigId = cfg.id);
}

export async function createPortal(user, { switchTo } = {}) {
  if (!user.stripe_customer_id) throw new Error("No billing account yet — choose a membership first.");
  const configuration = await ensurePortalConfig();
  const params = { customer: user.stripe_customer_id, configuration, locale: STRIPE_LOCALES[getLocale()], return_url: `${config.appUrl}/account` };
  if (switchTo && user.stripe_subscription_id && switchTo !== user.plan) {
    const prices = await ensurePrices();
    const sub = await stripe().subscriptions.retrieve(user.stripe_subscription_id);
    params.flow_data = {
      type: "subscription_update_confirm",
      after_completion: { type: "redirect", redirect: { return_url: `${config.appUrl}/account?subscribed=1` } },
      subscription_update_confirm: {
        subscription: sub.id,
        items: [{ id: sub.items.data[0].id, price: prices[switchTo], quantity: 1 }],
      },
    };
  }
  const s = await stripe().billingPortal.sessions.create(params);
  return s.url;
}

// --- Subscription sync ---------------------------------------------------
function planFromSubscription(sub) {
  const item = sub.items?.data?.[0];
  const key = item?.price?.lookup_key;
  const byKey = PLANS.find((p) => lookupKey(p.id) === key);
  return byKey?.id || item?.price?.metadata?.plan || sub.metadata?.plan || null;
}
const periodEnd = (sub) => sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;

async function applySubscription(sub, userIdHint) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const plan = planFromSubscription(sub);
  let user =
    (userIdHint && db.prepare("SELECT * FROM users WHERE id = ?").get(Number(userIdHint))) ||
    (sub.metadata?.userId && db.prepare("SELECT * FROM users WHERE id = ?").get(Number(sub.metadata.userId))) ||
    db.prepare("SELECT * FROM users WHERE stripe_customer_id = ?").get(customerId);

  // The Stripe account is shared with other sites. A subscription that isn't one of our plans and isn't
  // already a member's current subscription belongs to someone else: leave it alone.
  if (!plan && user?.stripe_subscription_id !== sub.id) return;

  let provisioned = false;
  if (!user && customerId) {
    const cust = await stripe().customers.retrieve(customerId); // throws → webhook 400 → Stripe retries
    const email = cust.email ? cust.email.toLowerCase().trim() : null;
    if (email) {
      user = db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(email);
      // The checkout email is unverified. Don't let a stranger's subscription take over the billing
      // link of an account that already has its own Stripe customer.
      if (user?.stripe_customer_id && user.stripe_customer_id !== customerId) {
        alertAdmins(
          `[Check] Subscription ${sub.id} not linked`,
          `A guest checkout used ${email}, which already belongs to a member with a different Stripe customer. Link or refund it by hand: https://dashboard.stripe.com/customers/${customerId}`,
        );
        return;
      }
      if (!user) {
        // Guest checkout: make the account now. It has no password until they use the emailed link,
        // and the email only counts as verified once they do.
        const placeholder = `none$${randomBytes(32).toString("hex")}`;
        const name = (cust.name || email.split("@")[0]).slice(0, 60);
        const r = db
          .prepare("INSERT OR IGNORE INTO users (email, password_hash, display_name, email_verified, stripe_customer_id, created_at) VALUES (?, ?, ?, 0, ?, unixepoch())")
          .run(email, placeholder, name, customerId);
        provisioned = r.changes > 0; // a simultaneous webhook may have just created it
        user = db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(email);
        if (provisioned) console.log("[stripe] created account for guest subscriber", user.id);
      }
    }
  }

  if (!user) return console.warn("[stripe] no user for subscription", sub.id);

  const isCurrent = !user.stripe_subscription_id || user.stripe_subscription_id === sub.id;
  const isLive = LIVE.has(sub.status);
  if (!isCurrent && !isLive) return; // an old, dead subscription must not overwrite a newer one

  // A second live subscription replacing a still-live first one means the member is paying twice.
  if (!isCurrent && LIVE.has(user.plan_status) && user.stripe_subscription_id) {
    alertAdmins(
      `[Check] ${user.email} has two active subscriptions`,
      `Subscriptions ${user.stripe_subscription_id} and ${sub.id} are both live for ${user.email}.\nCancel the one they don't need: https://dashboard.stripe.com/customers/${customerId}`,
    );
  }
  if (!plan) alertAdmins(`[Check] Unknown price on subscription ${sub.id}`, `The subscription's price isn't one of the three membership prices, so ${user.email} gets no access. Use the site's prices (lookup keys ca_*_monthly).`);

  const tierBefore = tierOf(user);
  db.prepare(
    `UPDATE users SET plan = ?, plan_status = ?, current_period_end = ?, stripe_customer_id = ?,
     stripe_subscription_id = ?, cancel_at_period_end = ? WHERE id = ?`,
  ).run(plan, sub.status, periodEnd(sub), customerId, sub.id, sub.cancel_at_period_end || sub.cancel_at ? 1 : 0, user.id);

  // Joined or upgraded → tell them what they now have (once per change; repeat webhooks see no change).
  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  if (provisioned || tierOf(fresh) > tierBefore) {
    try {
      await sendMembershipEmail(fresh, { setPasswordLink: provisioned && !hasPassword(fresh) ? issueSetPasswordLink(fresh.id) : null });
    } catch (e) {
      console.error("[stripe] membership email failed:", e.message); // never fail the webhook over an email
    }
  }
}

/** Guest-checkout accounts get a random non-scrypt placeholder instead of a password. */
export const hasPassword = (user) => String(user?.password_hash || "").startsWith("scrypt$");

/** One-time link to choose a password (24 h, longer than a normal reset since it rides in the welcome email). */
function issueSetPasswordLink(userId) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(userId);
  db.prepare("INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, now() + 24 * 3600);
  return token;
}

/** "Your membership is active": what the plan unlocks, with direct links to each deliverable. */
function sendMembershipEmail(user, { setPasswordLink = null } = {}) {
  const lang = user.locale || "en";
  return withLocale(lang, () => {
    const plan = planById(user.plan);
    const tier = tierOf(user);
    const url = (path) => `${config.appUrl}${localePath(path, lang)}`;
    const guides = GUIDES.filter((g) => g.tier <= tier).map((g) => `  • ${t(g.title)}: ${url(`/guides/download/${g.file}`)}`);
    const lines = [
      t("Peace be with you, {name}.", { name: user.display_name }),
      "",
      t("Your {plan} membership is active. Here is everything it unlocks:", { plan: t(plan?.name || "") }),
      "",
      setPasswordLink ? `${t("First, choose a password for your account (link valid for 24 hours):")}\n${url(`/reset/${setPasswordLink}`)}\n` : null,
      `${t("Reading library")}: ${url("/library")}`,
      `${t("Natal chart")}: ${url("/chart")}`,
      `${t("Quizzes")}: ${url("/quizzes")}`,
      `${t("The Sunday Letter archive")}: ${url("/letters")}`,
      tier >= 2 ? `${t("Message board")}: ${url("/board")}` : null,
      `${t("Store discount")}: ${storeDiscountOf(user)}% — ${url("/store")}`,
      guides.length ? `\n${t("Your study guides (PDF):")}\n${guides.join("\n")}` : null,
      "",
      `${t("Manage or cancel your membership any time")}: ${url("/account")}`,
      "",
      `— ${config.siteName}`,
    ];
    return sendMail({
      to: user.email,
      subject: t("Your {site} membership is active", { site: config.siteName }),
      text: lines.filter((l) => l !== null).join("\n"),
    });
  });
}

function alertAdmins(subject, text) {
  for (const to of config.adminEmails) sendMail({ to, subject, text });
}

/** Pull the latest subscription state (used on the success page so access is instant). */
export async function syncCheckoutSession(sessionId) {
  const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  if (session.mode === "subscription" && session.subscription) {
    await applySubscription(session.subscription, session.client_reference_id);
  }
  return session;
}

// --- Store checkout ------------------------------------------------------
export async function createStoreCheckout(user, cartItems) {
  if (!Array.isArray(cartItems) || !cartItems.length) throw new Error("Your cart is empty.");
  if (cartItems.length > 25) throw new Error("Too many items in cart.");
  const lines = [];
  let subtotal = 0;
  for (const raw of cartItems) {
    const product = await printify.getProduct(raw.productId);
    if (!product) throw new Error("An item in your cart is no longer available.");
    if (product.demo) throw new Error("The store is in preview mode — checkout opens once Printify is connected.");
    const variant = product.variants.find((v) => v.id === Number(raw.variantId));
    if (!variant) throw new Error("An option in your cart is no longer available.");
    const qty = Math.max(1, Math.min(10, Number(raw.qty) || 1));
    lines.push({ product, variant, qty });
  }

  // Membership reward: the member's % comes off every unit price.
  const pct = storeDiscountOf(user);
  const unit = (cents) => Math.round((cents * (100 - pct)) / 100);
  let discount = 0;
  for (const l of lines) {
    l.unit = unit(l.variant.price);
    subtotal += l.unit * l.qty;
    discount += (l.variant.price - l.unit) * l.qty;
  }

  const items = lines.map((l) => ({ productId: l.product.id, variantId: l.variant.id, qty: l.qty, title: `${l.product.title} — ${l.variant.title}`, price: l.unit, listPrice: l.variant.price }));
  const orderId = Number(
    db.prepare("INSERT INTO store_orders (user_id, items_json, subtotal_cents, discount_cents, updated_at, lang) VALUES (?, ?, ?, ?, ?, ?)").run(
      user?.id ?? null,
      JSON.stringify(items),
      subtotal,
      discount,
      now(),
      getLocale(),
    ).lastInsertRowid,
  );

  const { shippingCents, freeShippingOverCents, countries, currency } = config.store;
  const free = freeShippingOverCents > 0 && subtotal >= freeShippingOverCents;
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: lines.map((l) => {
      const img = (l.product.images.find((i) => i.variant_ids.includes(l.variant.id)) || {}).src || l.product.image;
      return {
        quantity: l.qty,
        price_data: {
          currency,
          unit_amount: l.unit,
          product_data: {
            name: `${l.product.title} — ${l.variant.title}${pct ? ` (member ${pct}% off)` : ""}`,
            ...(img?.startsWith("https://") ? { images: [img] } : {}),
            metadata: { printify_product_id: l.product.id, printify_variant_id: String(l.variant.id) },
          },
        },
      };
    }),
    shipping_address_collection: { allowed_countries: countries },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: free ? 0 : shippingCents, currency },
          display_name: free ? "Free standard shipping" : "Standard shipping",
          delivery_estimate: { minimum: { unit: "business_day", value: 5 }, maximum: { unit: "business_day", value: 12 } },
        },
      },
    ],
    phone_number_collection: { enabled: true },
    ...(user ? { customer_email: user.email } : {}),
    metadata: { kind: "store", site: "christianastrology", orderId: String(orderId), lang: getLocale() },
    locale: STRIPE_LOCALES[getLocale()],
    success_url: `${config.appUrl}/store/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.appUrl}/cart`,
    // The Stripe account is shared with other sites, so brand the payment page as Christian Astrology.
    branding_settings: brandingSettings(),
    payment_intent_data: { statement_descriptor_suffix: "ASTROLOGY", metadata: { orderId: String(orderId), site: "christianastrology" } },
  });
  db.prepare("UPDATE store_orders SET stripe_session_id = ? WHERE id = ?").run(session.id, orderId);
  return session.url;
}

/** Paid store session → record + submit to Printify. Idempotent per order. */
export async function fulfillStoreSession(session) {
  const orderId = Number(session.metadata?.orderId);
  const order = db.prepare("SELECT * FROM store_orders WHERE id = ?").get(orderId);
  // Order numbers are local to each storefront in the shared Stripe account.
  if (!order || order.stripe_session_id !== session.id) return;
  if (session.payment_status !== "paid") return;
  if (order.status === "paid") return submitToPrintify(orderId);
  if (order.status !== "pending") return;

  const shipping = session.collected_information?.shipping_details || session.shipping_details || {
    name: session.customer_details?.name,
    address: session.customer_details?.address,
  };
  const email = session.customer_details?.email || "";
  const phone = session.customer_details?.phone || "";
  db.prepare(
    "UPDATE store_orders SET status = 'paid', email = ?, shipping_json = ?, stripe_session_id = ?, total_cents = ?, updated_at = ? WHERE id = ?",
  ).run(email, JSON.stringify({ ...shipping, phone }), session.id, session.amount_total ?? null, now(), orderId);
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (pi) db.prepare("UPDATE store_orders SET stripe_payment_intent = ? WHERE id = ?").run(pi, orderId);
  // Only the call that flipped pending → paid gets here (guard above), so this sends once.
  try {
    await sendOrderConfirmation(db.prepare("SELECT * FROM store_orders WHERE id = ?").get(orderId));
  } catch (e) {
    console.error("[store] confirmation email failed:", e.message);
  }
  await submitToPrintify(orderId);
}

function sendOrderConfirmation(order) {
  if (!order?.email) return;
  const lang = order.lang || "en";
  return withLocale(lang, () => {
    const ref = `CA-${String(order.id).padStart(5, "0")}`;
    const money = (c) => `$${(c / 100).toFixed(2)}`;
    const items = JSON.parse(order.items_json || "[]").map((i) => `  • ${i.qty} × ${i.title} — ${money(i.price * i.qty)}`);
    return sendMail({
      to: order.email,
      subject: t("Order {ref} confirmed", { ref }),
      text: [
        t("Thank you for your order!"),
        "",
        ...items,
        order.total_cents != null ? `\n${t("Total paid")}: ${money(order.total_cents)}` : "",
        "",
        t("Each piece is printed to order. We'll email tracking as soon as it ships (usually 5–12 business days)."),
        `${t("View your orders")}: ${config.appUrl}${localePath("/account", lang)}#orders`,
        "",
        `— ${config.siteName}`,
      ].join("\n"),
    });
  });
}

export async function submitToPrintify(orderId) {
  const order = db.prepare("SELECT * FROM store_orders WHERE id = ?").get(orderId);
  if (!order || order.printify_order_id || order.status !== "paid") return;
  // Webhooks, the recovery worker and the admin retry button may overlap.
  const claim = db.prepare(`UPDATE store_orders SET fulfillment_lease_until = ?,
    fulfillment_attempts = fulfillment_attempts + 1 WHERE id = ? AND status = 'paid'
    AND printify_order_id IS NULL AND fulfillment_lease_until <= ?`).run(now() + 300, orderId, now());
  if (!claim.changes) return;
  const shipping = JSON.parse(order.shipping_json || "{}");
  const items = JSON.parse(order.items_json);
  // Preview items can't be printed. Checkout blocks them, so this only fires if one slipped through.
  if (items.some((i) => String(i.productId).startsWith("demo-"))) {
    db.prepare("UPDATE store_orders SET status = 'paid', updated_at = unixepoch() WHERE id = ?").run(order.id);
    alertAdmins(`[Check] Order ${order.id} has preview items`, `Order ${order.id} was paid for preview-catalog items that Printify can't fulfil. Refund it in Stripe.`);
    db.prepare("UPDATE store_orders SET fulfillment_lease_until = 0, fulfillment_retry_at = ? WHERE id = ?").run(now() + 86400, order.id);
    return;
  }
  try {
    // A previous request may have reached Printify even if its response was lost.
    const prior = await printify.findOrderByExternalId(`ca-${order.id}`);
    const current = db.prepare("SELECT status FROM store_orders WHERE id = ?").get(orderId);
    if (current?.status !== "paid") return;
    const pid = prior?.id || await printify.createOrder({
      externalId: `ca-${order.id}`,
      label: `CA-${String(order.id).padStart(5, "0")}`,
      items: JSON.parse(order.items_json),
      shipping,
      email: order.email,
      phone: shipping.phone,
    });
    db.prepare(`UPDATE store_orders SET printify_order_id = ?, printify_error = NULL,
      status = CASE WHEN status = 'paid' THEN 'submitted' ELSE status END, updated_at = unixepoch() WHERE id = ?`).run(pid, order.id);
    if (config.printify.autoSend && db.prepare("SELECT status FROM store_orders WHERE id = ?").get(order.id)?.status === 'submitted') {
      // The order exists in Printify now; a failure here only means it waits for Printify's own approval.
      try {
        await printify.sendToProduction(pid);
        db.prepare("UPDATE store_orders SET status = 'in_production' WHERE id = ?").run(order.id);
      } catch (e) {
        console.warn("[printify] send to production failed:", e.message);
        alertAdmins(
          `[Check] Order CA-${String(order.id).padStart(5, "0")} is in Printify but not yet in production`,
          `Printify said: ${e.message}\n\nIf the shop's order approval is automatic it will start within 24 hours; otherwise click "Send to production" at ${config.appUrl}/admin/orders`,
        );
      }
    }
  } catch (e) {
    console.error("[printify] order submit failed:", e.message);
    const delay = Math.min(3600, 60 * 2 ** Math.min(order.fulfillment_attempts, 6));
    db.prepare("UPDATE store_orders SET printify_error = ?, fulfillment_retry_at = ? WHERE id = ?")
      .run(e.message.slice(0, 1000), now() + delay, order.id);
    // A paid order that didn't reach Printify needs a human — tell the admins.
    alertAdmins(
      `[Action needed] Order CA-${String(order.id).padStart(5, "0")} was paid but not sent to Printify`,
      `Printify said: ${e.message}\n\nThe site retries automatically. You can also click "Retry Printify" at ${config.appUrl}/admin/orders`,
    );
  } finally {
    db.prepare("UPDATE store_orders SET fulfillment_lease_until = 0 WHERE id = ?").run(orderId);
  }
}

let recoveryRunning = false;
export async function retryPaidOrders() {
  if (recoveryRunning || !config.printify.token || !config.printify.shopId) return 0;
  recoveryRunning = true;
  try {
    const orders = db.prepare(`SELECT id FROM store_orders WHERE status = 'paid'
      AND printify_order_id IS NULL AND fulfillment_retry_at <= ?
      AND fulfillment_lease_until <= ? ORDER BY id LIMIT 25`).all(now(), now());
    for (const order of orders) await submitToPrintify(order.id);
    if (config.printify.autoSend) {
      const waiting = db.prepare("SELECT * FROM store_orders WHERE status = 'submitted' AND printify_order_id IS NOT NULL ORDER BY id LIMIT 25").all();
      for (const order of waiting) {
        try {
          const remote = await printify.getOrder(order.printify_order_id);
          if (remote.status === 'canceled') continue;
          if (!['in-production', 'sending-to-production', 'fulfilled', 'partially-fulfilled'].includes(remote.status)) {
            // Recheck after awaiting the API: a refund may have arrived in the meantime.
            if (db.prepare("SELECT status FROM store_orders WHERE id = ?").get(order.id)?.status !== 'submitted') continue;
            await printify.sendToProduction(order.printify_order_id);
          }
          db.prepare("UPDATE store_orders SET status = 'in_production', printify_error = NULL WHERE id = ? AND status = 'submitted'").run(order.id);
        } catch (e) {
          db.prepare("UPDATE store_orders SET printify_error = ? WHERE id = ?").run(e.message.slice(0, 1000), order.id);
          console.warn('[printify] production retry:', e.message);
        }
      }
    }
    return orders.length;
  } finally { recoveryRunning = false; }
}

// --- Webhook -------------------------------------------------------------
const WEBHOOK_EVENTS = [
  "checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired",
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
  "charge.refunded", "charge.dispute.created",
];
const setting = (key) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value || "";
const saveSetting = (key, value) => db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);

/** STRIPE_WEBHOOK_SECRET from .env if set, else the one this site created for itself (see ensureWebhook). */
export const webhookSecret = () => config.stripe.webhookSecret || setting("stripe_webhook_secret");

/**
 * Sets up this site's Stripe webhook through the API, so nobody has to do it in the dashboard.
 * Runs at startup. Only ever looks at endpoints pointing at this site's own /webhook/stripe URL.
 * Stripe only reveals a signing secret when the endpoint is created, so ours is kept in app_settings.
 */
export async function ensureWebhook() {
  if (!stripeEnabled() || config.stripe.webhookSecret) return { skipped: "key missing or secret set in .env" };
  if (!config.appUrl.startsWith("https://")) return { skipped: "APP_URL isn't a public https:// address" };
  const url = `${config.appUrl}/webhook/stripe`;
  const s = stripe();
  const savedId = setting("stripe_webhook_id");
  const ours = [];
  for await (const ep of s.webhookEndpoints.list({ limit: 100 })) if (ep.url === url) ours.push(ep);
  const saved = ours.find((ep) => ep.id === savedId);
  if (saved && setting("stripe_webhook_secret")) {
    const missing = WEBHOOK_EVENTS.filter((e) => !saved.enabled_events.includes(e) && !saved.enabled_events.includes("*"));
    if (saved.status !== "enabled" || missing.length) await s.webhookEndpoints.update(saved.id, { disabled: false, enabled_events: WEBHOOK_EVENTS });
    return { ok: true, id: saved.id };
  }
  // An endpoint for our URL whose secret we don't have can't be verified: replace it with one we can.
  for (const ep of ours) await s.webhookEndpoints.del(ep.id);
  const ep = await s.webhookEndpoints.create({
    url,
    enabled_events: WEBHOOK_EVENTS,
    api_version: Stripe.API_VERSION, // events arrive in the same shape as this SDK's API calls
    description: "christianastrology.org (created by the site)",
    metadata: { site: "christianastrology" },
  });
  saveSetting("stripe_webhook_id", ep.id);
  saveSetting("stripe_webhook_secret", ep.secret);
  console.log(`[stripe] webhook created for ${url}`);
  return { ok: true, id: ep.id, created: true };
}

export async function handleWebhook(rawBody, signature) {
  const secret = webhookSecret();
  if (!secret) throw new Error("Stripe webhook isn't set up yet (it is created automatically at startup on the live site).");
  const event = stripe().webhooks.constructEvent(rawBody, signature, secret);
  if (db.prepare("SELECT 1 FROM stripe_events WHERE id = ?").get(event.id)) return { duplicate: true };
  await processEvent(event);
  // Recorded only after success: if processing throws, Stripe retries and we try again.
  db.prepare("INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)").run(event.id, event.type);
  return { ok: true, type: event.type, at: now() };
}

async function processEvent(event) {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      if (obj.mode === "subscription" && obj.subscription) {
        const sub = await stripe().subscriptions.retrieve(obj.subscription);
        await applySubscription(sub, obj.client_reference_id);
      } else if (obj.mode === "payment" && obj.metadata?.kind === "store") {
        await fulfillStoreSession(obj);
      }
      break;
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": // e.g. a bank debit that bounced: never print it
      if (obj.metadata?.kind === "store") {
        db.prepare("UPDATE store_orders SET status = 'abandoned', updated_at = ? WHERE id = ? AND stripe_session_id = ? AND status = 'pending'").run(now(), Number(obj.metadata.orderId), obj.id);
      }
      break;
    case "charge.refunded": {
      // Store refunds: stop fulfilment if it hasn't started, and tell the admins either way.
      const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id;
      const order = pi && db.prepare("SELECT * FROM store_orders WHERE stripe_payment_intent = ?").get(pi);
      if (!order) break;
      const full = obj.amount_refunded >= obj.amount;
      if (full) db.prepare("UPDATE store_orders SET status = 'refunded', updated_at = ? WHERE id = ?").run(now(), order.id);
      alertAdmins(
        `[Store] ${full ? "Refund" : "Partial refund"} on order CA-${String(order.id).padStart(5, "0")}`,
        order.printify_order_id
          ? `This order was already sent to Printify (${order.printify_order_id}). If it isn't printed yet, cancel it in Printify so you aren't charged: https://printify.com/app/orders`
          : `The order hadn't been sent to Printify, so nothing to cancel there.`,
      );
      break;
    }
    case "charge.dispute.created": {
      // Shared Stripe account: only alert for disputes on our store orders or our members' payments.
      const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id;
      let ours = Boolean(pi && db.prepare("SELECT 1 FROM store_orders WHERE stripe_payment_intent = ?").get(pi));
      if (!ours && obj.charge) {
        const charge = await stripe().charges.retrieve(typeof obj.charge === "string" ? obj.charge : obj.charge.id);
        const cus = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
        ours = Boolean(cus && db.prepare("SELECT 1 FROM users WHERE stripe_customer_id = ?").get(cus));
      }
      if (ours) alertAdmins("[Stripe] A payment was disputed (chargeback)", `Respond in Stripe before the deadline: https://dashboard.stripe.com/disputes/${obj.id}`);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      // Events can arrive out of order; always apply Stripe's *current* state, not the event snapshot.
      const sub = await stripe().subscriptions.retrieve(obj.id);
      await applySubscription(sub);
      break;
    }
  }
}
