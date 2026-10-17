// Offline end-to-end test of memberships + store against a fake Stripe and fake Printify.
// Exercises the real app code (checkout params, signed webhooks, portal switching, refunds, Printify orders)
// without network access or real keys. Never touches data/app.db.
//   npm run test:payments
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Stripe from "stripe";

// ---------------------------------------------------------------- fake Stripe
const S = { products: {}, prices: {}, coupons: {}, sessions: {}, subs: {}, portalConfigs: [], portalSessions: [], endpoints: [], subRetrieveFailures: 0, n: 0 };
const id = (p) => `${p}_${++S.n}`;

// Stripe sends application/x-www-form-urlencoded with bracket keys: a[b][0][c]=v
function parseForm(str) {
  const out = {};
  for (const [k, v] of new URLSearchParams(str)) {
    const path = k.replace(/\]/g, "").split("[");
    let o = out;
    path.forEach((p, i) => {
      if (i === path.length - 1) o[p] = v;
      else o = o[p] ??= /^\d+$/.test(path[i + 1]) ? [] : {};
    });
  }
  return out;
}
const list = (data) => ({ object: "list", data, has_more: false });
const err = (res, status, code, message) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: { type: "invalid_request_error", code, message } }));

const stripeMock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const p = req.method === "GET" ? parseForm(url.search.slice(1)) : parseForm(body);
    const send = (o) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
    const r = `${req.method} ${url.pathname}`;
    let m;
    if (r === "GET /v1/prices") return send(list(Object.values(S.prices).filter((x) => (p.lookup_keys || []).includes(x.lookup_key))));
    if (r === "POST /v1/products") { const o = { id: id("prod"), ...p }; S.products[o.id] = o; return send(o); }
    if (r === "POST /v1/prices") { const o = { id: id("price"), product: p.product, unit_amount: Number(p.unit_amount), lookup_key: p.lookup_key, metadata: p.metadata }; S.prices[o.id] = o; return send(o); }
    if ((m = /^GET \/v1\/coupons\/(.+)$/.exec(r))) return S.coupons[m[1]] ? send(S.coupons[m[1]]) : err(res, 404, "resource_missing", "No such coupon");
    if (r === "POST /v1/coupons") { S.coupons[p.id] = { ...p, amount_off: Number(p.amount_off) }; return send(S.coupons[p.id]); }
    if (r === "POST /v1/checkout/sessions") { const o = { id: id("cs"), url: `https://checkout.stripe.test/${S.n}`, ...p }; S.sessions[o.id] = o; return send(o); }
    if ((m = /^GET \/v1\/checkout\/sessions\/(.+)$/.exec(r))) {
      const s = { ...S.sessions[m[1]] };
      if (p.expand?.includes("subscription") && s.subscription) s.subscription = S.subs[s.subscription];
      return send(s);
    }
    if ((m = /^GET \/v1\/subscriptions\/(.+)$/.exec(r))) {
      if (S.subRetrieveFailures > 0) { S.subRetrieveFailures--; return err(res, 500, "api_error", "temporary outage"); }
      return S.subs[m[1]] ? send(S.subs[m[1]]) : err(res, 404, "resource_missing", "No such subscription");
    }
    if (r === "GET /v1/subscriptions") return send(list(Object.values(S.subs).filter((s) => s.customer === p.customer)));
    if ((m = /^GET \/v1\/customers\/(.+)$/.exec(r))) return send({ id: m[1], object: "customer", email: S.customerEmails?.[m[1]] || null });
    if (r === "GET /v1/webhook_endpoints") return send(list(S.endpoints));
    if (r === "POST /v1/webhook_endpoints") { const o = { id: id("we"), object: "webhook_endpoint", status: "enabled", secret: `whsec_${id("auto")}`, ...p }; S.endpoints.push(o); return send(o); }
    if ((m = /^DELETE \/v1\/webhook_endpoints\/(.+)$/.exec(r))) { S.endpoints = S.endpoints.filter((e) => e.id !== m[1]); return send({ id: m[1], deleted: true }); }
    if ((m = /^POST \/v1\/webhook_endpoints\/(.+)$/.exec(r))) { const e = S.endpoints.find((x) => x.id === m[1]); Object.assign(e, p, { status: p.disabled === "false" ? "enabled" : e.status }); return send(e); }
    if (r === "GET /v1/billing_portal/configurations") return send(list(S.portalConfigs));
    if (r === "POST /v1/billing_portal/configurations") { const o = { id: id("bpc"), ...p }; S.portalConfigs.push(o); return send(o); }
    if (r === "POST /v1/billing_portal/sessions") { const o = { id: id("bps"), url: `https://billing.stripe.test/${S.n}`, ...p }; S.portalSessions.push(o); return send(o); }
    err(res, 404, "unhandled", `mock has no ${r}`);
  });
});

// Simulate the customer finishing a subscription checkout in Stripe.
function completeSubscription(sessionId, planLookup, { status = "active" } = {}) {
  const sess = S.sessions[sessionId];
  const price = Object.values(S.prices).find((x) => x.lookup_key === planLookup);
  const customer = sess.customer || id("cus");
  const sub = {
    id: id("sub"), object: "subscription", customer, status, cancel_at_period_end: false, metadata: sess.subscription_data?.metadata || {},
    items: { data: [{ id: id("si"), price, current_period_end: 2_000_000_000 }] },
  };
  S.subs[sub.id] = sub;
  Object.assign(sess, { customer, subscription: sub.id, mode: "subscription", status: "complete", payment_status: "paid" });
  return sub;
}

// --------------------------------------------------------------- fake Printify
const P = { orders: [], failOrders: false, failProduction: false, lostResponse: false, productions: 0 };
const PRODUCT = {
  id: "pf_hoodie", title: "Pleiades Hoodie", description: "<p>Warm</p>", tags: ["Apparel"], options: [], visible: true,
  variants: [{ id: 101, title: "M", price: 5000, is_enabled: true, is_available: true }, { id: 102, title: "L", price: 5000, is_enabled: true, is_available: true }],
  images: [{ src: "https://images.printify.test/h.png", variant_ids: [101, 102], is_default: true }],
};
const HIDDEN = { ...PRODUCT, id: "pf_hidden", title: "Draft", visible: false };
const PLAIN = { ...PRODUCT, id: "pf_plain", title: "Psalm 19 Mug", tags: [] }; // no tags needed: the whole shop is this site's
const printifyMock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (s, o) => res.writeHead(s, { "content-type": "application/json" }).end(JSON.stringify(o));
    if (req.headers.authorization !== "Bearer pf-token") return send(401, { error: "bad token" });
    const path = new URL(req.url, "http://x").pathname;
    if (req.method === "GET" && path === "/v1/shops/42/products.json") return send(200, { data: [PRODUCT, HIDDEN, PLAIN], last_page: 1 });
    if (req.method === "GET" && path === "/v1/shops/42/orders.json") return send(200, { data: P.orders, last_page: 1 });
    if (req.method === "POST" && path.endsWith('/send_to_production.json')) {
      if (P.failProduction) return send(503, { message: 'Production temporarily unavailable' });
      P.productions++;
      const po = P.orders.find((x) => path.includes('/' + x.id + '/'));
      if (po) po.status = 'in-production';
      return send(200, {});
    }
    if (req.method === "POST" && path === "/v1/shops/42/orders.json") {
      if (P.failOrders) return send(400, { message: "Address is invalid" });
      const o = { id: `pfo_${P.orders.length + 1}`, ...JSON.parse(body) };
      P.orders.push(o);
      if (P.lostResponse) { P.lostResponse = false; return send(503, { message: 'Response lost after creating order' }); }
      return send(200, { id: o.id });
    }
    let m;
    if (req.method === "GET" && (m = /^\/v1\/shops\/42\/orders\/(.+)\.json$/.exec(path))) {
      const o = P.orders.find((x) => x.id === m[1]);
      return o ? send(200, { id: o.id, status: o.status || "in-production", shipments: o.shipments || [] }) : send(404, { error: "no order" });
    }
    send(404, { error: `printify mock has no ${req.method} ${path}` });
  });
});

const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const stripePort = await listen(stripeMock);
const printifyPort = await listen(printifyMock);

// -------------------------------------------------------------------- the app
const dir = mkdtempSync(join(tmpdir(), "ca-pay-"));
const WHSEC = "whsec_test_secret";
Object.assign(process.env, { RESEND_API_KEY: "", PRINTIFY_AUTO_SEND: "false",
  NODE_ENV: "test", DATABASE_PATH: join(dir, "t.db"), APP_URL: "https://shop.test", ADMIN_EMAILS: "admin@test.local",
  STRIPE_SECRET_KEY: "sk_test_mock", STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_API_BASE: `http://127.0.0.1:${stripePort}`,
  PRINTIFY_API_TOKEN: "pf-token", PRINTIFY_SHOP_ID: "42", PRINTIFY_API_BASE: `http://127.0.0.1:${printifyPort}/v1`,
  PRINTIFY_WEBHOOK_SECRET: "pf-secret", SMTP_HOST: "", STORE_SHIPPING_CENTS: "699", STORE_FREE_SHIPPING_OVER_CENTS: "7500",
});
const mails = [];
console.log = ((log) => (...a) => (String(a[0]).startsWith("[mail:disabled]") ? mails.push(String(a[0])) : log(...a)))(console.log);

const { default: app, syncPrintifyOrders } = await import("../server.js");
const { db } = await import("../src/db.js");
const { config } = await import("../src/config.js");
const stripeApp = await import("../src/stripe.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;

function client() {
  const jar = new Map();
  return async (path, { method = "GET", form, raw, headers = {} } = {}) => {
    const h = { ...headers, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
    let body = raw;
    if (form) { body = new URLSearchParams(form).toString(); h["content-type"] = "application/x-www-form-urlencoded"; }
    const r = await fetch(base + path, { method, headers: h, body, redirect: "manual" });
    for (const c of r.headers.getSetCookie()) { const [k, v] = c.split(";")[0].split("="); jar.set(k, v); }
    return { status: r.status, location: r.headers.get("location"), text: await r.text() };
  };
}
const signer = new Stripe("sk_test_mock");
let evtN = 0;
async function webhook(type, object, { eventId } = {}) {
  const payload = JSON.stringify({ id: eventId || `evt_${++evtN}`, type, data: { object } });
  const sig = signer.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
  const r = await fetch(`${base}/webhook/stripe`, { method: "POST", body: payload, headers: { "content-type": "application/json", "stripe-signature": sig } });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const mailsTo = (to, re) => mails.filter((m) => m.includes(`to=${to} `) && re.test(m));
const user = (email) => db.prepare("SELECT * FROM users WHERE email = ?").get(email);
const lastSession = () => Object.values(S.sessions).at(-1);

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };

try {
  const mary = client();
  await mary("/signup", { method: "POST", form: { displayName: "Mary", email: "mary@test.local", password: "password123" } });

  console.log("\nMemberships");
  await step("checkout session: right price, first-month coupon, user link, locale, URLs", async () => {
    const r = await mary("/es/checkout/subscribe/devoted");
    assert.match(r.location, /^https:\/\/checkout\.stripe\.test\//);
    const s = lastSession();
    assert.equal(S.prices[s.line_items[0].price].lookup_key, "ca_devoted_monthly");
    assert.equal(S.prices[s.line_items[0].price].unit_amount, 2000);
    assert.equal(s.discounts[0].coupon, "ca_devoted_intro_500"); // $20 → $15 first month
    assert.equal(s.client_reference_id, String(user("mary@test.local").id));
    assert.equal(s.customer_email, "mary@test.local");
    assert.equal(s.locale, "es");
    assert.equal(s.success_url, "https://shop.test/checkout/success?session_id={CHECKOUT_SESSION_ID}");
    assert.equal(Object.keys(S.products).length, 3, "three membership products created once");
    await mary("/en/"); // the /es visit remembered Spanish; switch back so text checks below are English
  });

  let sub;
  await step("bad webhook signature is rejected", async () => {
    const r = await fetch(`${base}/webhook/stripe`, { method: "POST", body: "{}", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=bad" } });
    assert.equal(r.status, 400);
  });
  await step("failed webhook is retried, not lost (Stripe hiccup on first delivery)", async () => {
    sub = completeSubscription(lastSession().id, "ca_devoted_monthly");
    S.subRetrieveFailures = 5; // outlasts the SDK's own automatic retries
    const sess = { ...lastSession(), object: "checkout.session" };
    assert.equal((await webhook("checkout.session.completed", sess, { eventId: "evt_retry" })).status, 400);
    assert.equal(user("mary@test.local").plan_status, null);
    assert.equal((await webhook("checkout.session.completed", sess, { eventId: "evt_retry" })).status, 200);
    const u = user("mary@test.local");
    assert.equal(u.plan, "devoted");
    assert.equal(u.plan_status, "active");
    assert.equal(u.stripe_subscription_id, sub.id);
  });
  await step("duplicate delivery of the same event is ignored", async () => {
    const r = await webhook("checkout.session.completed", { ...lastSession() }, { eventId: "evt_retry" });
    assert.equal(r.json.duplicate, true);
  });
  await step("member gets one 'membership is active' email listing their deliverables", async () => {
    await webhook("customer.subscription.updated", sub); // a repeat event must not resend it
    const sent = mailsTo("mary@test.local", /membership is active/);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /\/library/);
    assert.match(sent[0], /\/board/);
    assert.match(sent[0], /guides\/download\/twelve-signs-workbook\.pdf/); // Devoted guides
    assert.doesNotMatch(sent[0], /birth-chart-prayer\.pdf/); // Saint-only
  });
  await step("another site's subscription on the shared Stripe account is ignored", async () => {
    mails.length = 0;
    const otherPrice = { id: "price_ms", lookup_key: "methspace_pro_monthly", unit_amount: 1500, metadata: {} };
    const cus = id("cus");
    (S.customerEmails ||= {})[cus] = "someone@methspace.test";
    const other = { id: id("sub"), object: "subscription", customer: cus, status: "active", metadata: {}, items: { data: [{ id: id("si"), price: otherPrice, current_period_end: 2_000_000_000 }] } };
    S.subs[other.id] = other;
    assert.equal((await webhook("customer.subscription.created", other)).status, 200);
    assert.equal(user("someone@methspace.test"), undefined);
    assert.equal(mails.length, 0, "no welcome email, no admin alert");
  });
  await step("guest subscriber: account created, set-password email, login points them to it, then works", async () => {
    mails.length = 0;
    const newbie = client();
    await newbie("/checkout/subscribe/pilgrim");
    const s = lastSession();
    const gsub = completeSubscription(s.id, "ca_pilgrim_monthly");
    S.customerEmails[gsub.customer] = "newbie@test.local";
    await webhook("checkout.session.completed", { ...s, object: "checkout.session" });
    const u = user("newbie@test.local");
    assert.equal(u.plan, "pilgrim");
    assert.equal(u.email_verified, 0, "unverified until they use the emailed link");
    const [welcome] = mailsTo("newbie@test.local", /membership is active/);
    const token = /\/reset\/([a-f0-9]{64})/.exec(welcome)?.[1];
    assert.ok(token, "welcome email carries a set-password link");
    const tryLogin = await newbie("/login", { method: "POST", form: { email: "newbie@test.local", password: "anything123" } });
    assert.match(tryLogin.text, /have a password yet/);
    // That login attempt mailed a fresh link, which replaces the one in the welcome email.
    const fresh = db.prepare("SELECT token FROM password_resets WHERE user_id = ?").get(u.id).token;
    await newbie(`/reset/${fresh}`, { method: "POST", form: { password: "my-new-pass" } });
    const back = client();
    assert.equal((await back("/login", { method: "POST", form: { email: "newbie@test.local", password: "my-new-pass" } })).location, "/account");
    assert.equal(user("newbie@test.local").email_verified, 1);
  });
  await step("pay first: plan button → Stripe → choose a password on return → signed in as a member", async () => {
    const buyer = client();
    assert.match((await buyer("/pricing")).text, /href="\/checkout\/subscribe\/saint"/);
    assert.match((await buyer("/checkout/subscribe/saint?next=%2Flibrary%2Fsun-in-aries")).location, /^https:\/\/checkout\.stripe\.test\//);
    const s = lastSession();
    assert.equal(s.success_url, "https://shop.test/checkout/success?session_id={CHECKOUT_SESSION_ID}&next=%2Flibrary%2Fsun-in-aries");
    const gsub = completeSubscription(s.id, "ca_saint_monthly");
    S.customerEmails[gsub.customer] = "payfirst@test.local";
    const page = await buyer(`/checkout/success?session_id=${s.id}&next=%2Flibrary%2Fsun-in-aries`);
    assert.match(page.text, /One last step/);
    assert.match(page.text, /payfirst@test\.local/);
    const short = await buyer("/checkout/welcome", { method: "POST", form: { session_id: s.id, next: "/library/sun-in-aries", password: "short" } });
    assert.match(short.text, /at least 8 characters/);
    const r = await buyer("/checkout/welcome", { method: "POST", form: { session_id: s.id, next: "/library/sun-in-aries", password: "saint-pass-1" } });
    assert.equal(r.location, "/library/sun-in-aries", "lands back on the reading they were unlocking");
    const acct = await buyer("/account?subscribed=1");
    assert.equal(acct.status, 200, `account: ${acct.status} ${acct.location}`);
    assert.match(acct.text, /Welcome to your membership/);
    assert.equal(user("payfirst@test.local").plan, "saint");
    // The form can't be reused once a password exists.
    const again = await client()("/checkout/welcome", { method: "POST", form: { session_id: s.id, password: "hijack-pass" } });
    assert.equal(again.location, null);
    assert.equal((await client()("/login", { method: "POST", form: { email: "payfirst@test.local", password: "hijack-pass" } })).status, 400);
  });
  await step("locked reading's button → straight to Stripe for that plan, and back to the reading after", async () => {
    const reader = client();
    const page = (await reader("/library/sun-in-aries")).text;
    assert.match(page, /href="\/checkout\/subscribe\/pilgrim"/);
    const r = await reader("/checkout/subscribe/pilgrim", { headers: { referer: `${base}/library/sun-in-aries` } });
    assert.match(r.location, /^https:\/\/checkout\.stripe\.test\//);
    assert.match(lastSession().success_url, /&next=%2Flibrary%2Fsun-in-aries$/);
  });
  await step("member unlocks: board posting, 20% store discount, Devoted rank", async () => {
    assert.equal((await mary("/board/welcome/new")).status, 200);
    assert.match((await mary("/store")).text, /<strong>20% off<\/strong>/);
    assert.match((await mary("/")).text, /Steward/);
  });
  await step("guest checkout with a member's email doesn't sign the payer in or touch the member", async () => {
    const before = user("mary@test.local");
    const stranger = client();
    await stranger("/checkout/subscribe/saint");
    const s = lastSession();
    assert.equal(s.client_reference_id, undefined);
    const gsub = completeSubscription(s.id, "ca_saint_monthly");
    (S.customerEmails ||= {})[gsub.customer] = "mary@test.local";
    s.customer_details = { email: "mary@test.local" };
    const r = await stranger(`/checkout/success?session_id=${s.id}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /Sign in with the email you used at checkout/);
    assert.match((await stranger("/account")).location, /^\/login/);
    const after = user("mary@test.local");
    assert.equal(after.stripe_customer_id, before.stripe_customer_id);
    assert.equal(after.stripe_subscription_id, before.stripe_subscription_id);
    assert.equal(after.plan, "devoted");
  });
  await step("out-of-order event can't downgrade: stale 'canceled' snapshot vs Stripe's live state", async () => {
    await webhook("customer.subscription.updated", { ...sub, status: "canceled" });
    assert.equal(user("mary@test.local").plan_status, "active");
  });
  await step("subscribing again while active → billing portal plan switch, not a 2nd subscription", async () => {
    const before = Object.keys(S.sessions).length;
    const r = await mary("/checkout/subscribe/saint");
    assert.match(r.location, /^https:\/\/billing\.stripe\.test\//);
    assert.equal(Object.keys(S.sessions).length, before);
    const ps = S.portalSessions.at(-1);
    assert.equal(ps.flow_data.type, "subscription_update_confirm");
    assert.equal(S.prices[ps.flow_data.subscription_update_confirm.items[0].price].lookup_key, "ca_saint_monthly");
    assert.equal(ps.flow_data.subscription_update_confirm.items[0].id, sub.items.data[0].id);
    const cfg = S.portalConfigs.at(-1);
    assert.equal(cfg.features.subscription_update.products.length, 3);
  });
  await step("plan switch in portal → webhook → Saint access", async () => {
    sub.items.data[0].price = Object.values(S.prices).find((x) => x.lookup_key === "ca_saint_monthly");
    await webhook("customer.subscription.updated", sub);
    assert.equal(user("mary@test.local").plan, "saint");
    assert.match((await mary("/store")).text, /<strong>30% off<\/strong>/);
  });
  await step("cancel at period end: keeps access, account says it ends", async () => {
    sub.cancel_at_period_end = true;
    await webhook("customer.subscription.updated", sub);
    const u = user("mary@test.local");
    assert.equal(u.plan_status, "active");
    assert.match((await mary("/account")).text, /Canceled — access ends on/);
  });
  await step("subscription ends → access removed", async () => {
    sub.status = "canceled";
    await webhook("customer.subscription.deleted", sub);
    assert.equal(user("mary@test.local").plan_status, "canceled");
    assert.equal((await mary("/board/welcome/new")).location, "/checkout/subscribe/devoted");
  });
  await step("resubscribing gets no second intro discount", async () => {
    await mary("/checkout/subscribe/pilgrim");
    const s = lastSession();
    assert.equal(s.discounts, undefined);
    assert.equal(s.allow_promotion_codes, "true");
    assert.equal(s.customer, user("mary@test.local").stripe_customer_id); // reuses her Stripe customer
  });
  await step("DB behind Stripe (webhook not in yet) → no duplicate subscription sold", async () => {
    const s2 = completeSubscription(lastSession().id, "ca_pilgrim_monthly"); // paid, but we never got the webhook
    const before = Object.keys(S.sessions).length;
    const r = await mary("/checkout/subscribe/devoted");
    assert.match(r.location, /billing\.stripe\.test/);
    assert.equal(Object.keys(S.sessions).length, before);
    assert.equal(user("mary@test.local").stripe_subscription_id, s2.id);
  });
  await step("past_due keeps access while Stripe retries the card; account warns", async () => {
    const s2 = S.subs[user("mary@test.local").stripe_subscription_id];
    s2.status = "past_due";
    await webhook("customer.subscription.updated", s2);
    assert.match((await mary("/account")).text, /last payment didn't go through/);
    assert.match((await mary("/library")).text, /Pilgrim: 120 foundational readings unlocked/);
  });

  console.log("\nWebhook setup");
  await step("site creates its own Stripe webhook via the API; never touches other sites' endpoints", async () => {
    const envSecret = config.stripe.webhookSecret;
    config.stripe.webhookSecret = ""; // as on a fresh server with no secret in .env
    try {
      S.endpoints.push(
        { id: "we_other_site", object: "webhook_endpoint", url: "https://methspace.test/webhook/stripe", status: "enabled", enabled_events: ["*"] },
        { id: "we_stale", object: "webhook_endpoint", url: "https://shop.test/webhook/stripe", status: "enabled", enabled_events: ["charge.refunded"] },
      );
      const first = await stripeApp.ensureWebhook();
      assert.equal(first.created, true);
      assert.deepEqual(S.endpoints.map((e) => e.id).sort(), ["we_other_site", first.id].sort(), "stale copy of ours replaced, other site's kept");
      const ep = S.endpoints.find((e) => e.id === first.id);
      assert.equal(ep.url, "https://shop.test/webhook/stripe");
      assert.ok(ep.enabled_events.includes("checkout.session.completed") && ep.enabled_events.includes("customer.subscription.deleted"));
      const again = await stripeApp.ensureWebhook();
      assert.equal(again.created, undefined, "restart reuses it");
      assert.equal(S.endpoints.length, 2);
      // A webhook signed with the auto-created secret is accepted.
      const payload = JSON.stringify({ id: "evt_auto_1", type: "charge.dispute.created", data: { object: { id: "dp_1", payment_intent: null, charge: null } } });
      const sig = signer.webhooks.generateTestHeaderString({ payload, secret: ep.secret });
      const r = await fetch(`${base}/webhook/stripe`, { method: "POST", body: payload, headers: { "content-type": "application/json", "stripe-signature": sig } });
      assert.equal(r.status, 200);
    } finally {
      config.stripe.webhookSecret = envSecret;
    }
  });

  console.log("\nStore");
  const guest = client();
  await step("hidden Printify products don't show; real ones do with live prices", async () => {
    const page = (await guest("/store")).text;
    assert.match(page, /Pleiades Hoodie/);
    assert.doesNotMatch(page, /Draft/);
    assert.match(page, /Psalm 19 Mug/);
  });
  let order;
  await step("checkout: server-side prices (tampering ignored), member discount, shipping, image", async () => {
    const s2 = S.subs[user("mary@test.local").stripe_subscription_id];
    s2.status = "active";
    await webhook("customer.subscription.updated", s2); // Mary is Pilgrim again → 10%
    const cart = JSON.stringify([{ productId: "pf_hoodie", variantId: 102, qty: 2, price: 1 }]);
    const r = await mary("/checkout/store", { method: "POST", form: { cart_json: cart } });
    assert.match(r.location, /checkout\.stripe\.test/);
    const s = lastSession();
    assert.equal(s.mode, "payment");
    assert.equal(s.line_items[0].price_data.unit_amount, "4500"); // $50 − 10%, not the tampered $0.01
    assert.equal(s.line_items[0].quantity, "2");
    assert.equal(s.line_items[0].price_data.product_data.images[0], "https://images.printify.test/h.png");
    assert.equal(s.shipping_options[0].shipping_rate_data.fixed_amount.amount, "0"); // $90 ≥ $75 → free
    order = db.prepare("SELECT * FROM store_orders ORDER BY id DESC").get();
    assert.equal(order.discount_cents, 1000);
    assert.equal(order.subtotal_cents, 9000);
  });
  await step("paid → Printify order with the right items and address; thanks page shows ref", async () => {
    const s = lastSession();
    Object.assign(s, {
      object: "checkout.session", status: "complete", payment_status: "paid", amount_total: 9000, payment_intent: "pi_1",
      customer_details: { email: "mary@test.local", phone: "+15555550100" },
      collected_information: { shipping_details: { name: "Mary Anne Smith", address: { line1: "1 Grace St", line2: "", city: "Austin", state: "TX", postal_code: "78701", country: "US" } } },
    });
    await webhook("checkout.session.completed", s);
    const po = P.orders.at(-1);
    assert.deepEqual(po.line_items, [{ product_id: "pf_hoodie", variant_id: 102, quantity: 2 }]);
    assert.equal(po.address_to.first_name, "Mary");
    assert.equal(po.address_to.last_name, "Anne Smith");
    assert.equal(po.address_to.region, "TX");
    assert.equal(po.address_to.zip, "78701");
    assert.equal(po.external_id, `ca-${order.id}`);
    const o = db.prepare("SELECT * FROM store_orders WHERE id = ?").get(order.id);
    assert.equal(o.status, "submitted");
    assert.equal(o.printify_order_id, po.id);
    assert.match((await mary(`/store/thanks?session_id=${s.id}`)).text, new RegExp(`CA-${String(order.id).padStart(5, "0")}`));
    assert.match((await mary("/account")).text, /Pleiades Hoodie/);
    const [conf] = mailsTo("mary@test.local", new RegExp(`Order CA-${String(order.id).padStart(5, "0")} confirmed`));
    assert.match(conf, /2 × Pleiades Hoodie — L — \$90\.00/);
    assert.match(conf, /Total paid: \$90\.00/);
  });
  await step("same payment webhook twice → still exactly one Printify order and one confirmation", async () => {
    const n = P.orders.length;
    await webhook("checkout.session.completed", lastSession());
    assert.equal(P.orders.length, n);
    assert.equal(mailsTo("mary@test.local", /confirmed"/).length, 1);
  });
  await step("order tracking syncs from Printify without webhooks; one shipping email per tracking number", async () => {
    mails.length = 0;
    const po = P.orders.at(-1);
    await syncPrintifyOrders();
    assert.equal(db.prepare("SELECT status FROM store_orders WHERE id = ?").get(order.id).status, "in_production");
    po.shipments = [{ carrier: "usps", number: "9400TEST1", url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400TEST1", delivered_at: null }];
    await syncPrintifyOrders();
    await syncPrintifyOrders(); // runs every 20 minutes: must not email twice
    let o = db.prepare("SELECT * FROM store_orders WHERE id = ?").get(order.id);
    assert.equal(o.status, "shipped");
    assert.match(o.tracking_json, /9400TEST1/);
    assert.equal(mailsTo("mary@test.local", /has shipped/).length, 1);
    po.shipments[0].delivered_at = "2026-10-20 12:00:00+00:00";
    await syncPrintifyOrders();
    assert.equal(db.prepare("SELECT status FROM store_orders WHERE id = ?").get(order.id).status, "delivered");
    assert.equal(mailsTo("mary@test.local", /has shipped/).length, 1);
    db.prepare("UPDATE store_orders SET status = 'submitted' WHERE id = ?").run(order.id); // later steps refund this order
  });
  await step("full refund → order marked refunded, admin alerted", async () => {
    mails.length = 0;
    await webhook("charge.refunded", { id: "ch_1", object: "charge", payment_intent: "pi_1", amount: 9000, amount_refunded: 9000 });
    assert.equal(db.prepare("SELECT status FROM store_orders WHERE id = ?").get(order.id).status, "refunded");
    assert.ok(mails.some((m) => m.includes("admin@test.local") && m.includes("Refund")));
  });
  await step("Printify rejects an order → stays paid with the error, admin alerted, retry works", async () => {
    await guest("/checkout/store", { method: "POST", form: { cart_json: JSON.stringify([{ productId: "pf_hoodie", variantId: 101, qty: 1 }]) } });
    const s = lastSession();
    assert.equal(s.line_items[0].price_data.unit_amount, "5000"); // guest pays full price
    assert.equal(s.shipping_options[0].shipping_rate_data.fixed_amount.amount, "699");
    P.failOrders = true;
    mails.length = 0;
    Object.assign(s, { object: "checkout.session", status: "complete", payment_status: "paid", amount_total: 5699, payment_intent: "pi_2",
      customer_details: { email: "guest@test.local" }, collected_information: { shipping_details: { name: "Guest", address: { line1: "2 Hope Rd", city: "Reno", state: "NV", postal_code: "89501", country: "US" } } } });
    await webhook("checkout.session.completed", s);
    const o = db.prepare("SELECT * FROM store_orders ORDER BY id DESC").get();
    assert.equal(o.status, "paid");
    assert.match(o.printify_error, /Address is invalid/);
    assert.ok(mails.some((m) => m.includes("[Action needed]")));
    P.failOrders = false;
    const admin = client();
    await admin("/signup", { method: "POST", form: { displayName: "Admin", email: "admin@test.local", password: "password123" } });
    db.prepare("UPDATE users SET email_verified = 1 WHERE email = 'admin@test.local'").run();
    await admin(`/admin/orders/${o.id}`, { method: "POST", form: { action: "retry" } });
    assert.equal(db.prepare("SELECT status FROM store_orders WHERE id = ?").get(o.id).status, "submitted");
  });
  await step("abandoned checkout is marked abandoned, never sent to Printify", async () => {
    await guest("/checkout/store", { method: "POST", form: { cart_json: JSON.stringify([{ productId: "pf_hoodie", variantId: 101, qty: 1 }]) } });
    const s = lastSession();
    const n = P.orders.length;
    await webhook("checkout.session.expired", { ...s, object: "checkout.session", status: "expired" });
    assert.equal(db.prepare("SELECT status FROM store_orders WHERE stripe_session_id = ?").get(s.id).status, "abandoned");
    assert.equal(P.orders.length, n);
  });
  await step("other storefront's paid/expired events leave this site's pending order alone", async () => {
    await guest("/checkout/store", { method: "POST", form: { cart_json: JSON.stringify([{ productId: "pf_hoodie", variantId: 101, qty: 1 }]) } });
    const s = lastSession();
    const foreign = { ...s, id: 'cs_other_site', payment_status: 'paid', amount_total: 1 };
    const before = P.orders.length;
    await webhook('checkout.session.completed', foreign);
    await webhook('checkout.session.expired', foreign);
    assert.equal(db.prepare('SELECT status FROM store_orders WHERE stripe_session_id = ?').get(s.id).status, 'pending');
    assert.equal(P.orders.length, before);
  });
  await step("temporary Printify failure recovers automatically, including lost submission response", async () => {
    await guest("/checkout/store", { method: "POST", form: { cart_json: JSON.stringify([{ productId: "pf_hoodie", variantId: 101, qty: 1 }]) } });
    const s = lastSession();
    Object.assign(s, { status: 'complete', payment_status: 'paid', amount_total: 5699, customer_details: { email: 'auto@test.local' }, shipping_details: { name: 'Auto Retry', address: { country: 'US', line1: '1 Test St' } } });
    P.failOrders = true;
    await webhook('checkout.session.completed', s);
    const o = db.prepare('SELECT * FROM store_orders WHERE stripe_session_id = ?').get(s.id);
    assert.equal(o.status, 'paid');
    assert.ok(o.fulfillment_retry_at > 0);
    P.failOrders = false;
    P.lostResponse = true;
    db.prepare('UPDATE store_orders SET fulfillment_retry_at = 0 WHERE id = ?').run(o.id);
    const before = P.orders.length;
    await stripeApp.retryPaidOrders();
    assert.equal(P.orders.length, before + 1);
    assert.equal(db.prepare('SELECT status FROM store_orders WHERE id = ?').get(o.id).status, 'paid');
    db.prepare('UPDATE store_orders SET fulfillment_retry_at = 0 WHERE id = ?').run(o.id);
    await Promise.all([stripeApp.retryPaidOrders(), stripeApp.submitToPrintify(o.id)]);
    assert.equal(P.orders.length, before + 1, 'recovery must find the existing Printify order');
    assert.equal(db.prepare('SELECT status FROM store_orders WHERE id = ?').get(o.id).status, 'submitted');
  });
  await step("automatic production retries without manual approval or creating a second order", async () => {
    await guest("/checkout/store", { method: "POST", form: { cart_json: JSON.stringify([{ productId: "pf_hoodie", variantId: 101, qty: 1 }]) } });
    const s = lastSession();
    Object.assign(s, { status: 'complete', payment_status: 'paid', amount_total: 5699, customer_details: { email: 'print@test.local' }, shipping_details: { name: 'Auto Print', address: { country: 'US', line1: '1 Print St' } } });
    config.printify.autoSend = true;
    P.failProduction = true;
    await webhook('checkout.session.completed', s);
    const o = db.prepare('SELECT * FROM store_orders WHERE stripe_session_id = ?').get(s.id);
    P.orders.find(x => x.id === o.printify_order_id).status = 'on-hold';
    assert.equal(o.status, 'submitted');
    const before = P.orders.length;
    P.failProduction = false;
    await stripeApp.retryPaidOrders();
    assert.equal(db.prepare('SELECT status FROM store_orders WHERE id = ?').get(o.id).status, 'in_production');
    assert.equal(P.orders.length, before);
    assert.ok(P.productions > 0);
    config.printify.autoSend = false;
  });
  await step("email failure is persisted and delivered by the retry worker", async () => {
    const { sendMail, retryMail, mailQueueStatus } = await import('../src/mail.js');
    const realFetch = globalThis.fetch;
    let failing = true;
    const keys = [];
    globalThis.fetch = async (url, options) => {
      if (String(url) === 'https://api.resend.com/emails') {
        keys.push(options.headers['Idempotency-Key']);
        return new Response(JSON.stringify(failing ? { message: 'temporary mail outage' } : { id: 'mail_sent' }), { status: failing ? 503 : 200 });
      }
      return realFetch(url, options);
    };
    config.resend.apiKey = 'fake-test-key';
    try {
      assert.equal(await sendMail({ to: 'retry@test.local', subject: 'Test delivery', text: 'Test body' }), false);
      assert.equal(mailQueueStatus(), 1);
      failing = false;
      db.prepare('UPDATE mail_outbox SET retry_at = 0').run();
      await retryMail();
      assert.equal(mailQueueStatus(), 0);
      assert.equal(keys[0], keys[1]);
    } finally { globalThis.fetch = realFetch; config.resend.apiKey = ''; }
  });
  await step("discontinued variant: cart and checkout agree (dropped / rejected)", async () => {
    const r = await guest("/api/cart/details", { method: "POST", raw: JSON.stringify({ items: [{ productId: "pf_hoodie", variantId: 999, qty: 1 }] }), headers: { "content-type": "application/json" } });
    assert.equal(JSON.parse(r.text).items.length, 0);
    const c = await guest("/checkout/store", { method: "POST", form: { cart_json: JSON.stringify([{ productId: "pf_hoodie", variantId: 999, qty: 1 }]) } });
    assert.match(c.location, /^\/cart\?error=/);
  });

  console.log(`\n✅ ${passed} payment checks passed\n`);
} catch (e) {
  console.error("\n❌ Payment test failed:\n", e);
  process.exitCode = 1;
} finally {
  server.close(); stripeMock.close(); printifyMock.close();
  rmSync(dir, { recursive: true, force: true });
  setTimeout(() => process.exit(), 50).unref();
}
