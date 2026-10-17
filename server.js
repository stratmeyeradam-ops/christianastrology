import { PAYMENT_LINKS } from "./src/plans.js";
import express from "express";
import { resolve } from "node:path";
import { config, stripeEnabled, printifyEnabled } from "./src/config.js";
import { db, now } from "./src/db.js";
import { loadUser, requireUser, requireAdmin, createUser, normalizeEmail, validEmail, verifyPassword, hashPassword, createSession, destroySession, syncAdmin, rateLimited, issueVerifyToken, consumeVerifyToken, markEmailVerified } from "./src/auth.js";
import { PLANS, planById, tierOf, rankOf, GUIDES, storeDiscountOf, joinHref } from "./src/plans.js";
import { randomBytes } from "node:crypto";
import { sendMail, retryMail, mailQueueStatus } from "./src/mail.js";
import * as letters from "./src/letters.js";
import * as content from "./src/content.js";
import * as printify from "./src/printify.js";
import * as stripeApp from "./src/stripe.js";

// View imports
import { homeView } from "./src/views/home.js";
import { signsIndexView, signDetailView } from "./src/views/signs.js";
import { libraryIndexView, readingDetailView } from "./src/views/library.js";
import { chartCalculatorView } from "./src/views/chart.js";
import { quizzesIndexView, quizDetailView } from "./src/views/quizzes.js";
import { boardCategoriesView, boardCategoryDetailView, boardThreadView, boardNewThreadView, boardLockedView } from "./src/views/board.js";
import { storeIndexView, productDetailView, cartView } from "./src/views/store.js";
import { pricingView, accountView } from "./src/views/pricing.js";
import { loginView, signupView, staticPageView, forgotView, resetView } from "./src/views/auth.js";
import { guidesView, ordersSection } from "./src/views/guides.js";
import * as adminViews from "./src/views/admin.js";
import * as pages from "./src/views/pages.js";
import { lettersView } from "./src/views/letters.js";
import { escapeHtml } from "./src/views/layout.js";
import { localeMiddleware, t, getLocale, withLocale, LOCALES, localePath, href, isKnownKey } from "./src/i18n.js";
import { articlesIndexView, articleDetailView } from "./src/views/articles.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback"); // Nginx on the same box sets X-Forwarded-For / -Proto

// Basic security headers (no helmet dependency needed).
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (config.secureCookies) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

/** Only allow same-site relative redirects ("/x", not "//evil.com" or "/\\evil.com"). */
const safeNext = (n, fallback = "/account") => (typeof n === "string" && /^\/(?![\/\\])/.test(n) ? n : fallback);
const clientIp = (req) => req.ip || "unknown";
const tooMany = (res, user) => res.status(429).send(pages.tooManyPage(user));
// Messages passed through ?error= are only shown if they're our own text (known translation keys);
// anything else becomes a generic line, so nobody can craft a link that puts their words on our page.
const knownMessage = (m) => (!m ? "" : isKnownKey(String(m)) ? String(m) : "Something went wrong. Please try again, or contact us if it keeps happening.");

app.post(["/webhook/stripe", "/api/stripe/webhook", "/api/webhook/stripe"], express.raw({ type: "application/json" }), async (req, res, next) => {
  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).send("Missing stripe-signature header");
  try {
    const result = await stripeApp.handleWebhook(req.body, sig);
    res.json(result);
  } catch (err) {
    console.error("[stripe-webhook-error]", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// Printify webhook (raw body for HMAC verification). Always answer 200 quickly once verified,
// otherwise Printify retries 3x and then blocks the hook for an hour.
app.post("/webhook/printify", express.raw({ type: "*/*", limit: "1mb" }), async (req, res, next) => {
  if (!printify.verifyWebhook(req.body, req.headers["x-pfy-signature"])) return res.status(401).send("bad signature");
  let evt;
  try {
    evt = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).send("bad json");
  }
  res.json({ ok: true });
  try {
    await handlePrintifyEvent(evt);
  } catch (e) {
    console.error("[printify-webhook]", evt?.type, e.message);
  }
});

async function handlePrintifyEvent(evt) {
  const r = evt.resource || {};
  const data = r.data || {};
  if (data.shop_id && String(data.shop_id) !== String(config.printify.shopId)) return;
  switch (evt.type) {
    case "product:publish:started":
      if (data.action === "delete") printify.bustCache();
      else await printify.markPublished(r.id);
      break;
    case "product:updated":
    case "product:deleted":
      printify.bustCache();
      break;
    case "order:updated":
    case "order:sent-to-production":
      db.prepare("UPDATE store_orders SET printify_status = ?, status = CASE WHEN ? = 'canceled' THEN 'canceled' ELSE status END, updated_at = ? WHERE printify_order_id = ?")
        .run(data.status || evt.type.split(":")[1], data.status || "", now(), String(r.id));
      if (evt.type === "order:sent-to-production" || data.status === "in-production")
        db.prepare("UPDATE store_orders SET status = 'in_production' WHERE printify_order_id = ? AND status IN ('submitted','paid')").run(String(r.id));
      break;
    case "order:shipment:created":
    case "order:shipment:delivered": {
      const order = db.prepare("SELECT * FROM store_orders WHERE printify_order_id = ?").get(String(r.id));
      if (!order) return;
      const c = data.carrier || {};
      await recordShipment(order, { carrier: c.code, number: c.tracking_number, url: c.tracking_url }, evt.type === "order:shipment:delivered");
      break;
    }
  }
}

/** Save a tracking number on an order and email the customer the first time we see it. */
async function recordShipment(order, { carrier = "", number = "", url = "" }, delivered = false) {
  if (!number) return;
  const fresh = db.prepare("SELECT * FROM store_orders WHERE id = ?").get(order.id);
  const tracking = JSON.parse(fresh.tracking_json || "[]");
  const isNew = !tracking.some((x) => x.number === number);
  if (isNew) tracking.push({ carrier: carrier || "", number, url: url || "" });
  const status = delivered ? "delivered" : fresh.status === "delivered" ? "delivered" : "shipped";
  db.prepare("UPDATE store_orders SET tracking_json = ?, status = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(tracking), status, now(), order.id);
  if (isNew && fresh.email) { // Printify may report the same shipment many times: email once per tracking number
    const ref = `CA-${String(order.id).padStart(5, "0")}`;
    const lang = fresh.lang || "en";
    await withLocale(lang, () =>
      sendMail({
        to: fresh.email,
        subject: t("Your order {ref} has shipped", { ref }),
        text: `${t("Good news — your order is on its way.")}\n\n${t("Carrier")}: ${String(carrier || "").toUpperCase()}\n${t("Tracking")}: ${number}\n${url || ""}\n\n${t("View your orders")}: ${config.appUrl}${localePath("/account", lang)}#orders\n\n— ${config.siteName}`,
      }),
    );
  }
}

/**
 * Ask Printify how each open order is doing: production status, tracking numbers, delivery.
 * Runs every 20 minutes, so shipping emails go out without needing Printify webhooks.
 */
export async function syncPrintifyOrders() {
  if (!printifyEnabled()) return 0;
  const open = db.prepare("SELECT * FROM store_orders WHERE printify_order_id IS NOT NULL AND status IN ('submitted','in_production','shipped')").all();
  for (const order of open) {
    try {
      const po = await printify.getOrder(order.printify_order_id);
      db.prepare("UPDATE store_orders SET printify_status = ?, updated_at = ? WHERE id = ?").run(po.status || null, now(), order.id);
      if (po.status === "canceled") {
        db.prepare("UPDATE store_orders SET status = 'canceled' WHERE id = ?").run(order.id);
        for (const to of config.adminEmails) sendMail({ to, subject: `[Store] Printify canceled order CA-${String(order.id).padStart(5, "0")}`, text: `Printify canceled this paid order. Refund the customer in Stripe or re-create the order: ${config.appUrl}/admin/orders` });
        continue;
      }
      if (["in-production", "sending-to-production"].includes(po.status) && order.status === "submitted")
        db.prepare("UPDATE store_orders SET status = 'in_production' WHERE id = ?").run(order.id);
      for (const s of po.shipments || []) await recordShipment(order, { carrier: s.carrier, number: s.number, url: s.url }, Boolean(s.delivered_at));
    } catch (e) {
      console.warn("[printify-sync]", order.id, e.message);
    }
  }
  return open.length;
}

// Standard Parsers & Static Files
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public", { maxAge: "1d" }));
app.use(localeMiddleware({ secure: config.secureCookies }));
app.use(loadUser);

// ---------------------------------------------------------------------------
// Main Pages
// ---------------------------------------------------------------------------

app.get("/", (req, res, next) => {
  res.send(homeView({ user: req.user }));
});

// The 12 Signs
app.get("/signs", (req, res, next) => {
  res.send(signsIndexView({ user: req.user }));
});

app.get("/signs/:slug", (req, res, next) => {
  const sign = content.getSign(req.params.slug);
  if (!sign) return next();
  res.send(signDetailView({ sign, user: req.user }));
});

// Readings Library (1,560 placements)
app.get("/library", (req, res, next) => {
  const { sign = "", q = "", page = 1 } = req.query;
  res.send(libraryIndexView({
    user: req.user,
    selectedSign: String(sign),
    query: String(q),
    page: Number(page) || 1,
  }));
});

app.get("/library/:slug", (req, res, next) => {
  const reading = content.getReading(req.params.slug);
  if (!reading) return next();
  res.send(readingDetailView({ reading, user: req.user }));
});

// Natal Chart
app.get("/chart", (req, res, next) => {
  res.send(chartCalculatorView({ user: req.user }));
});

app.post("/chart", (req, res, next) => {
  const { birthDate = "", birthTime = "", location = "", tz = "UTC", lat = "", lon = "" } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return res.redirect("/chart");
  const knownTime = /^\d{2}:\d{2}$/.test(birthTime);

  const [y, mo, d] = birthDate.split("-").map(Number);
  const [h, mi] = knownTime ? birthTime.split(":").map(Number) : [12, 0];
  const utc = localToUtc(y, mo, d, h, mi, tz);
  const latitude = String(lat).trim() === "" ? null : Number(lat);
  const longitude = String(lon).trim() === "" ? null : Number(lon);
  if ((latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) >= 90)) ||
      (longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180))) return res.status(400).send("Invalid birthplace coordinates.");
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate() ||
      y < 1800 || y > 2050 || h > 23 || mi > 59) return res.status(400).send("Enter a valid birth date from 1800 to 2050 and a valid time.");
  const chart = content.natalChart({
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    hourUT: utc.getUTCHours() + utc.getUTCMinutes() / 60,
    knownTime, lat: latitude, lon: longitude,
  });
  res.send(chartCalculatorView({
    user: req.user,
    chartData: chart,
    input: { birthDate, birthTime, location, tz, lat, lon },
  }));
});

/** Wall-clock time in an IANA zone → UTC Date (handles DST via Intl). */
function localToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms) => {
    try {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
          .formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
      );
      return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - ms;
    } catch {
      return 0; // unknown zone → treat as UTC
    }
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

// Discernment Quizzes
app.get("/quizzes", (req, res, next) => {
  res.send(quizzesIndexView({ user: req.user }));
});

app.get("/quizzes/:slug", (req, res, next) => {
  const quiz = content.getQuiz(req.params.slug);
  if (!quiz) return next();
  res.send(quizDetailView({ quiz, user: req.user }));
});

app.post("/quizzes/:slug", (req, res, next) => {
  const quiz = content.getQuiz(req.params.slug);
  if (!quiz) return next();

  const counts = {};
  quiz.questions.forEach((_, idx) => {
    const val = req.body[`q_${idx}`];
    if (val) counts[val] = (counts[val] || 0) + 1;
  });

  let topKey = Object.keys(quiz.results)[0];
  let maxCount = -1;
  for (const [k, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      topKey = k;
    }
  }

  const result = quiz.results[topKey] || Object.values(quiz.results)[0];
  res.send(quizDetailView({ quiz, user: req.user, result, answers: req.body }));
});

// Theological Journal
app.get("/articles", (req, res, next) => {
  res.send(articlesIndexView({ user: req.user }));
});

app.get("/articles/:slug", (req, res, next) => {
  const article = content.getArticle(req.params.slug);
  if (!article) return next();
  res.send(articleDetailView({ article, user: req.user }));
});

// ---------------------------------------------------------------------------
// Community Message Board
// ---------------------------------------------------------------------------

const withRank = (row) => ({ ...row, author_rank: rankOf(row), author_tier: tierOf(row) });
const MAX_TITLE = 140;
const MAX_BODY = 10000;

app.get("/board", (req, res, next) => {
  const categories = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM board_threads t WHERE t.category_id = c.id) as thread_count,
      (SELECT COUNT(*) FROM board_posts p JOIN board_threads t ON p.thread_id = t.id WHERE t.category_id = c.id) as post_count
    FROM board_categories c
    ORDER BY c.sort_order ASC
  `).all();
  res.send(boardCategoriesView({ categories, user: req.user }));
});

app.get("/board/:slug", (req, res, next) => {
  const category = db.prepare("SELECT * FROM board_categories WHERE slug = ?").get(req.params.slug);
  if (!category) return next();
  if (tierOf(req.user) < 1) return res.send(boardLockedView({ user: req.user, title: t(category.name) })); // members only

  const threads = db.prepare(`
    SELECT t.*, u.display_name as author_name, u.plan, u.plan_status, u.is_admin
    FROM board_threads t
    JOIN users u ON u.id = t.user_id
    WHERE t.category_id = ?
    ORDER BY t.pinned DESC, t.last_post_at DESC
    LIMIT 200
  `).all(category.id).map(withRank);

  res.send(boardCategoryDetailView({ category, threads, user: req.user }));
});

app.get("/board/:slug/new", requireUser, (req, res, next) => {
  const userTier = tierOf(req.user);
  if (userTier < 2) return res.redirect(joinHref("devoted"));

  const category = db.prepare("SELECT * FROM board_categories WHERE slug = ?").get(req.params.slug);
  if (!category) return next();
  res.send(boardNewThreadView({ category, user: req.user }));
});

app.post("/board/:slug/new", requireUser, (req, res, next) => {
  const userTier = tierOf(req.user);
  if (userTier < 2) return res.redirect(joinHref("devoted"));

  const category = db.prepare("SELECT * FROM board_categories WHERE slug = ?").get(req.params.slug);
  if (!category) return next();

  const title = String(req.body.title || "").trim();
  const body = String(req.body.body || "").trim();
  if (!title || !body) {
    return res.send(boardNewThreadView({ category, user: req.user, error: "Title and body are required." }));
  }
  if (title.length > MAX_TITLE || body.length > MAX_BODY) {
    return res.send(boardNewThreadView({ category, user: req.user, error: "Keep titles under 140 characters and posts under 10,000." }));
  }
  if (!req.user.is_admin && rateLimited(`thread:${req.user.id}`, 5, 3600)) return tooMany(res, req.user);

  const threadInfo = db.prepare(
    "INSERT INTO board_threads (category_id, user_id, title) VALUES (?, ?, ?)"
  ).run(category.id, req.user.id, title);

  const threadId = Number(threadInfo.lastInsertRowid);
  db.prepare("INSERT INTO board_posts (thread_id, user_id, body) VALUES (?, ?, ?)").run(threadId, req.user.id, body);

  res.redirect(`/board/thread/${threadId}`);
});

app.get("/board/thread/:id", (req, res, next) => {
  const thread = db.prepare("SELECT * FROM board_threads WHERE id = ?").get(Number(req.params.id));
  if (!thread) return next();
  if (tierOf(req.user) < 1) return res.send(boardLockedView({ user: req.user })); // members only; titles stay private too

  const category = db.prepare("SELECT * FROM board_categories WHERE id = ?").get(thread.category_id);
  const posts = db.prepare(`
    SELECT p.*, u.display_name as author_name, u.plan, u.plan_status, u.is_admin
    FROM board_posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.thread_id = ?
    ORDER BY p.id ASC
  `).all(thread.id).map(withRank);

  const categories = req.user?.is_admin ? db.prepare("SELECT * FROM board_categories ORDER BY sort_order").all() : [];
  res.send(boardThreadView({ thread, posts, category, categories, user: req.user }));
});

app.post("/board/thread/:id/reply", requireUser, (req, res, next) => {
  const userTier = tierOf(req.user);
  if (userTier < 2) return res.redirect(joinHref("devoted"));

  const thread = db.prepare("SELECT * FROM board_threads WHERE id = ?").get(Number(req.params.id));
  if (!thread) return next();

  if (thread.locked && !req.user.is_admin) return res.redirect(`/board/thread/${thread.id}`);

  const body = String(req.body.body || "").trim().slice(0, MAX_BODY);
  if (body) {
    if (!req.user.is_admin && rateLimited(`reply:${req.user.id}`, 30, 3600)) return tooMany(res, req.user);
    const info = db.prepare("INSERT INTO board_posts (thread_id, user_id, body) VALUES (?, ?, ?)").run(thread.id, req.user.id, body);
    db.prepare("UPDATE board_threads SET reply_count = reply_count + 1, last_post_at = unixepoch() WHERE id = ?").run(thread.id);
    notifyReply(thread, req.user, Number(info.lastInsertRowid), body);
    return res.redirect(`/board/thread/${thread.id}#post-${info.lastInsertRowid}`);
  }
  res.redirect(`/board/thread/${thread.id}`);
});

/**
 * Email everyone taking part in a thread (except the replier) that there's a new reply.
 * At most one email per person per thread every 6 hours, so a lively thread doesn't flood inboxes.
 * Each recipient gets it in their own language; they can switch these off on their account page.
 */
const NOTIFY_GAP = 6 * 3600;
function notifyReply(thread, author, postId, body) {
  const people = db.prepare(`
    SELECT DISTINCT u.* FROM board_posts p JOIN users u ON u.id = p.user_id
    LEFT JOIN thread_notifications n ON n.user_id = u.id AND n.thread_id = ?
    WHERE p.thread_id = ? AND u.id != ? AND u.notify_replies = 1 AND u.email_verified = 1 AND u.banned = 0
      AND (n.last_sent_at IS NULL OR n.last_sent_at < ?)
  `).all(thread.id, thread.id, author.id, now() - NOTIFY_GAP);
  const snippet = body.length > 400 ? body.slice(0, 400) + "…" : body;
  for (const u of people) {
    db.prepare("INSERT INTO thread_notifications (user_id, thread_id, last_sent_at) VALUES (?, ?, ?) ON CONFLICT(user_id, thread_id) DO UPDATE SET last_sent_at = excluded.last_sent_at")
      .run(u.id, thread.id, now());
    const loc = u.locale || "en";
    withLocale(loc, () =>
      sendMail({
        to: u.email,
        subject: t("New reply: {title}", { title: thread.title }),
        text: `${t("{name} replied in “{title}”:", { name: author.display_name, title: thread.title })}\n\n${snippet}\n\n${t("Read and reply")}: ${config.appUrl}${localePath(`/board/thread/${thread.id}`, loc)}#post-${postId}\n\n—\n${t("Turn off reply emails")}: ${config.appUrl}${localePath("/account", loc)}#notifications`,
      }),
    );
  }
}

// Authors can edit/delete their own posts; admins can moderate anything.
const ownPost = (req) => {
  const post = db.prepare("SELECT * FROM board_posts WHERE id = ?").get(Number(req.params.id));
  if (!post || (post.user_id !== req.user.id && !req.user.is_admin)) return null;
  return post;
};

app.post("/board/post/:id/edit", requireUser, (req, res, next) => {
  const post = ownPost(req);
  if (!post) return res.status(404).send("Not found");
  const body = String(req.body.body || "").trim().slice(0, MAX_BODY);
  if (body) db.prepare("UPDATE board_posts SET body = ?, edited_at = unixepoch() WHERE id = ?").run(body, post.id);
  res.redirect(`/board/thread/${post.thread_id}#post-${post.id}`);
});

app.post("/board/post/:id/delete", requireUser, (req, res, next) => {
  const post = ownPost(req);
  if (!post) return res.status(404).send("Not found");
  const first = db.prepare("SELECT MIN(id) AS id FROM board_posts WHERE thread_id = ?").get(post.thread_id).id;
  const thread = db.prepare("SELECT * FROM board_threads WHERE id = ?").get(post.thread_id);
  const category = db.prepare("SELECT slug FROM board_categories WHERE id = ?").get(thread.category_id);
  if (first === post.id) {
    // Deleting the opening post removes the whole thread.
    db.prepare("DELETE FROM board_threads WHERE id = ?").run(thread.id);
    return res.redirect(`/board/${category.slug}`);
  }
  db.prepare("DELETE FROM board_posts WHERE id = ?").run(post.id);
  db.prepare("UPDATE board_threads SET reply_count = MAX(reply_count - 1, 0) WHERE id = ?").run(thread.id);
  res.redirect(`/board/thread/${thread.id}`);
});

app.post("/board/thread/:id/mod", requireAdmin, (req, res, next) => {
  const thread = db.prepare("SELECT * FROM board_threads WHERE id = ?").get(Number(req.params.id));
  if (!thread) return res.status(404).send("Not found");
  const action = req.body.action;
  if (action === "pin") db.prepare("UPDATE board_threads SET pinned = 1 - pinned WHERE id = ?").run(thread.id);
  if (action === "lock") db.prepare("UPDATE board_threads SET locked = 1 - locked WHERE id = ?").run(thread.id);
  if (action === "move" && req.body.category) {
    const cat = db.prepare("SELECT id FROM board_categories WHERE slug = ?").get(String(req.body.category));
    if (cat) db.prepare("UPDATE board_threads SET category_id = ? WHERE id = ?").run(cat.id, thread.id);
  }
  res.redirect(`/board/thread/${thread.id}`);
});

// ---------------------------------------------------------------------------
// Printify Sanctuary Store
// ---------------------------------------------------------------------------

app.get("/store", async (req, res, next) => {
  const products = await printify.getProducts();
  res.send(storeIndexView({ products, user: req.user, discount: storeDiscountOf(req.user), error: printify.catalogError() }));
});

// Must be registered before /store/:id or "thanks" is treated as a product id.
app.get("/store/thanks", async (req, res, next) => {
  const order = req.query.session_id
    ? db.prepare("SELECT * FROM store_orders WHERE stripe_session_id = ?").get(String(req.query.session_id))
    : null;
  // The webhook normally fulfils the order; this is a fallback in case it is delayed.
  if (order && order.status === "pending") {
    try {
      const session = await stripeApp.stripe().checkout.sessions.retrieve(order.stripe_session_id);
      await stripeApp.fulfillStoreSession(session);
    } catch (e) {
      console.warn("[store-thanks-sync]", e.message);
    }
  }
  const ref = order ? `CA-${String(order.id).padStart(5, "0")}` : "";
  res.send(pages.orderThanks(req.user, ref));
});

app.get("/store/:id", async (req, res, next) => {
  const product = await printify.getProduct(req.params.id);
  if (!product) return next();
  res.send(productDetailView({ product, user: req.user, discount: storeDiscountOf(req.user) }));
});

app.get("/cart", (req, res, next) => {
  res.send(cartView({ user: req.user, discount: storeDiscountOf(req.user), error: knownMessage(req.query.error) }));
});

app.post("/api/cart/details", async (req, res, next) => {
  const rawItems = Array.isArray(req.body.items) ? req.body.items.slice(0, 25) : [];
  const pct = storeDiscountOf(req.user);
  const items = [];
  for (const raw of rawItems) {
    const p = await printify.getProduct(raw.productId);
    if (!p) continue;
    const v = p.variants.find((vr) => vr.id === Number(raw.variantId));
    if (!v) continue; // discontinued option: drop it (checkout would reject it anyway)
    items.push({
      productId: p.id,
      variantId: v.id,
      title: `${p.title} — ${v.title}`,
      price: Math.round((v.price * (100 - pct)) / 100),
      listPrice: v.price,
      image: p.image,
      qty: Math.max(1, Math.min(10, Number(raw.qty) || 1)),
      demo: p.demo,
    });
  }
  const { shippingCents, freeShippingOverCents } = config.store;
  res.json({ items, discountPct: pct, shippingCents, freeShippingOverCents });
});

app.post("/checkout/store", async (req, res, next) => {
  try {
    const rawCart = JSON.parse(req.body.cart_json || "[]");
    if (!rawCart.length) return res.redirect("/cart");
    const checkoutUrl = await stripeApp.createStoreCheckout(req.user, rawCart);
    res.redirect(checkoutUrl);
  } catch (err) {
    console.warn("[store-checkout]", err.message);
    res.redirect(`/cart?error=${encodeURIComponent(err.message)}`);
  }
});

// ---------------------------------------------------------------------------
// Pricing & Stripe Subscriptions
// ---------------------------------------------------------------------------

app.get("/pricing", (req, res, next) => {
  res.send(pricingView({ user: req.user, error: knownMessage(req.query.error), canceled: Boolean(req.query.canceled), next: returnPathFor(req) }));
});

/** Where to send someone after they join: ?next=, else the page on this site they came from (e.g. a locked reading). */
function returnPathFor(req) {
  let path = typeof req.query.next === "string" ? req.query.next : "";
  if (!path && req.get("referer")) {
    try {
      const ref = new URL(req.get("referer"));
      if (ref.host === req.get("host")) path = ref.pathname + ref.search;
    } catch {}
  }
  const p = safeNext(path, "");
  return /^\/(?:(?:es|pt)\/)?(?:pricing|checkout|login|signup|account|reset|forgot|verify)\b/.test(p) || p === "/" ? "" : p;
}

app.get(["/checkout/subscribe/:planId", "/checkout/:planId"], async (req, res, next) => {
  try {
    const { planId } = req.params;
    const plan = planById(planId);
    if (!plan) return res.status(404).send("Unknown plan");
    if (req.user) {
      const checkoutUrl = await stripeApp.createSubscriptionCheckout(req.user, planId, { next: returnPathFor(req) });
      return res.redirect(checkoutUrl);
    }
    const stripeLink = PAYMENT_LINKS[planId];
    const priceIds = { pilgrim: "price_1UQF26BESAZWLwwZrn6BrW10", devoted: "price_1UQF26BESAZWLwwZYyhY9Zhi", saint: "price_1UQF26BESAZWLwwZcTJuaxqb" };
    res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Christian Astrology — ${plan.name} Membership Checkout ($${plan.price}/month)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/styles.css">
</head>
<body style="background:#f8f5ef;color:#1b2432;font-family:Georgia,serif;padding:3rem 1rem;">
  <main style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2d9c8;border-radius:12px;padding:2.5rem;box-shadow:0 8px 24px rgba(0,0,0,0.06);">
    <div style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.12em;color:#8c6d2c;font-weight:700;">Christian Astrology · Live Stripe Checkout</div>
    <h1 style="margin:0.5rem 0 0.25rem;font-size:1.85rem;">${plan.name} Membership</h1>
    <div style="font-size:1.75rem;font-weight:700;color:#1b2432;margin-bottom:0.75rem;">$${plan.price}.00 <span style="font-size:1rem;font-weight:400;color:#64748b;">/ month (USD)</span></div>
    <p style="color:#475569;line-height:1.6;margin-bottom:1.25rem;">${plan.blurb}</p>
    <ul style="margin:0 0 1.5rem 1.25rem;color:#334155;line-height:1.7;">
      ${plan.points.map(pt => `<li>${pt}</li>`).join("")}
    </ul>
    <form action="${stripeLink}" method="GET" style="display:grid;gap:1rem;border-top:1px solid #e2d9c8;padding-top:1.5rem;">
      <div>
        <label for="checkout-email" style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:0.35rem;">Email address</label>
        <input id="checkout-email" name="prefilled_email" type="email" placeholder="you@example.com" required style="width:100%;padding:0.75rem;border:1px solid #cbd5e1;border-radius:6px;font-size:1rem;">
      </div>
      <div style="font-size:0.85rem;color:#475569;">
        <strong>Accepted payment methods:</strong> Visa, Mastercard, American Express, Discover, Apple Pay, Google Pay, Cash App Pay, Link.<br>
        <strong>Stripe Price ID:</strong> <code>${priceIds[planId]}</code> · <strong>Status:</strong> Active (Live Mode)
      </div>
      <button type="submit" class="btn btn-gold" style="width:100%;padding:0.9rem;font-size:1.05rem;font-weight:700;cursor:pointer;background:#c59b48;color:#fff;border:none;border-radius:6px;">
        Pay $${plan.price}.00/month on Stripe →
      </button>
      <a href="${stripeLink}" style="text-align:center;font-size:0.9rem;color:#8c6d2c;text-decoration:underline;">
        Direct Stripe Payment Link: ${stripeLink}
      </a>
    </form>
  </main>
</body>
</html>`);
  } catch (err) {
    console.warn("[subscribe]", err.message);
    res.redirect(`/pricing?error=${encodeURIComponent(err.message)}`);
  }
});

app.get("/checkout/success", async (req, res, next) => {
  const sessionId = String(req.query.session_id || "");
  let session = null;
  if (sessionId) {
    try {
      session = await stripeApp.syncCheckoutSession(sessionId);
    } catch (e) {
      console.warn("[checkout-sync-warning]", e.message);
    }
  }
  const back = returnPathFor(req);
  if (req.user) return res.redirect(back || "/account?subscribed=1");
  // Pay-first: a brand-new account made by this very checkout can choose its password right here.
  const fresh = session && newAccountFor(session);
  if (fresh) return res.send(pages.choosePassword({ sessionId, email: fresh.email, next: back }));
  // They already had an account (or the webhook is still on its way): sign in as usual.
  res.send(pages.subscribedGuest(back));
});

/**
 * The account a completed subscription checkout just created, if it still has no password.
 * Never an account that existed before: those sign in with their own password, so paying
 * with someone else's email can't take their account over.
 */
function newAccountFor(session) {
  if (session.mode !== "subscription" || session.status !== "complete" || session.client_reference_id) return null;
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const user = customer && db.prepare("SELECT * FROM users WHERE stripe_customer_id = ?").get(customer);
  return user && !user.banned && !stripeApp.hasPassword(user) ? user : null;
}

app.post("/checkout/welcome", async (req, res, next) => {
  const sessionId = String(req.body.session_id || "");
  const password = String(req.body.password || "").trim();
  if (rateLimited(`welcome:${clientIp(req)}`, 10, 3600)) return tooMany(res, null);
  let session = null;
  try {
    session = await stripeApp.stripe().checkout.sessions.retrieve(sessionId);
  } catch (e) {
    console.warn("[checkout-welcome]", e.message);
  }
  const user = session && newAccountFor(session);
  const back = safeNext(req.body.next, "/account?subscribed=1");
  if (!user) return res.send(pages.subscribedGuest(safeNext(req.body.next, ""))); // already set, or not a new account
  if (password.length < 8) return res.send(pages.choosePassword({ sessionId, email: user.email, next: req.body.next, error: "Password must be at least 8 characters." }));
  db.prepare("UPDATE users SET password_hash = ?, locale = ? WHERE id = ?").run(hashPassword(password), getLocale(), user.id);
  db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(user.id); // the emailed link is no longer needed
  createSession(res, user.id);
  res.redirect(back);
});

app.post("/billing/portal", requireUser, async (req, res, next) => {
  try {
    const url = await stripeApp.createPortal(req.user);
    res.redirect(url);
  } catch (err) {
    res.redirect(`/account?error=${encodeURIComponent(err.message)}`);
  }
});

// Member Account & Guides Downloads
app.get("/account", requireUser, (req, res, next) => {
  const message = req.query.subscribed
    ? "✦ Welcome to your membership! Your access has been unlocked."
    : req.query.verified ? "Thank you — your email is confirmed."
    : req.query.sent ? "Confirmation email sent. Check your inbox."
    : req.query.saved ? "Saved." : "";
  const error = knownMessage(req.query.error);
  const orders = db.prepare("SELECT * FROM store_orders WHERE user_id = ? AND status NOT IN ('pending','abandoned') ORDER BY id DESC LIMIT 50").all(req.user.id);
  res.send(accountView({ user: req.user, message, error, ordersHtml: ordersSection(orders) }));
});

app.post("/account/notifications", requireUser, (req, res) => {
  db.prepare("UPDATE users SET notify_replies = ? WHERE id = ?").run(req.body.notify_replies ? 1 : 0, req.user.id);
  res.redirect("/account?saved=1#notifications");
});

app.post("/account/profile", requireUser, (req, res, next) => {
  const name = String(req.body.displayName || "").trim().slice(0, 60);
  if (name) db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(name, req.user.id);
  res.redirect("/account?saved=1");
});

app.post("/account/password", requireUser, (req, res, next) => {
  const current = String(req.body.current || "");
  const pw = String(req.body.next || "").trim();
  if (rateLimited(`pwchange:${req.user.id}`, 10, 3600)) return tooMany(res, req.user);
  if (!checkPassword(current, req.user.password_hash)) return res.redirect("/account?error=" + encodeURIComponent("Current password is incorrect."));
  if (pw.length < 8) return res.redirect("/account?error=" + encodeURIComponent("New password must be at least 8 characters."));
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(pw), req.user.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(req.user.id);
  createSession(res, req.user.id);
  res.redirect("/account?saved=1");
});

app.get("/letters", (req, res) => {
  const locked = tierOf(req.user) < 1;
  res.send(lettersView({ user: req.user, letters: locked ? [] : letters.list(), locked }));
});

app.get("/letters/:id", (req, res, next) => {
  if (tierOf(req.user) < 1) return res.send(lettersView({ user: req.user, locked: true }));
  const letter = letters.get(req.params.id);
  if (!letter) return next();
  res.send(lettersView({ user: req.user, letter }));
});

app.get("/guides", (req, res, next) => {
  res.send(guidesView({ user: req.user, error: knownMessage(req.query.error) }));
});

app.get("/guides/download/:file", requireUser, (req, res, next) => {
  const guide = GUIDES.find(g => g.file === req.params.file);
  if (!guide) return res.status(404).send("Guide not found");

  // Not on a plan that includes it (or membership lapsed) → the pricing page, not a bare error.
  if (tierOf(req.user) < guide.tier) return res.redirect(href("/pricing") + "?error=" + encodeURIComponent("This guide is included with a higher membership."));

  res.download(resolve(`private/guides/${guide.file}`), guide.file, (err) => {
    if (!err) return;
    console.error("[guides] download failed:", guide.file, err.message);
    if (!res.headersSent) res.redirect("/guides?error=" + encodeURIComponent("That guide couldn't be downloaded just now. Please try again, or contact us."));
  });
});

// ---------------------------------------------------------------------------
// Auth Routes
// ---------------------------------------------------------------------------

app.get("/login", (req, res, next) => {
  if (req.user) return res.redirect(safeNext(req.query.next)); // already signed in → carry on to where they were headed
  res.send(loginView({ next: safeNext(req.query.next, "") }));
});

app.post("/login", (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const next = safeNext(req.body.next);
  if (rateLimited(`login:${clientIp(req)}`, 10, 900) || rateLimited(`login:${email}`, 10, 900)) {
    return res.status(429).send(loginView({ error: "Too many sign-in attempts. Please wait 15 minutes.", next }));
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  // Accounts made by a guest checkout have no password yet: send the set-password link instead of a dead end.
  if (user && !stripeApp.hasPassword(user) && !user.banned) {
    if (!rateLimited(`setpw:${user.id}`, 3, 3600)) sendSetPasswordEmail(user);
    return res.send(loginView({ message: "Your account doesn't have a password yet. We've emailed you a link to set one.", email, next }));
  }
  // Always run the hash check so response time doesn't reveal whether the email exists.
  const passwordOk = checkPassword(password, user?.password_hash);
  if (!user || !passwordOk) {
    return res.status(400).send(loginView({ error: "Invalid email or password.", email, next }));
  }

  if (user.banned) {
    return res.status(403).send(loginView({ error: "Account has been suspended.", next }));
  }

  syncAdmin(user);
  if (user.locale !== getLocale()) db.prepare("UPDATE users SET locale = ? WHERE id = ?").run(getLocale(), user.id);
  createSession(res, user.id);
  res.redirect(next);
});

app.get("/signup", (req, res, next) => {
  if (req.user) return res.redirect(safeNext(req.query.next));
  // Accounts come with a membership now: joining = picking a plan and paying. Reading stays free without one.
  const target = safeNext(req.query.next, "");
  if (/^\/checkout\/subscribe\//.test(target)) return res.redirect(target);
  res.redirect(href("/pricing"));
});

app.post("/signup", (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "").trim();
  const displayName = String(req.body.displayName || "").trim();
  const next = safeNext(req.body.next);
  if (rateLimited(`signup:${clientIp(req)}`, 20, 3600)) {
    return res.status(429).send(signupView({ error: "Too many accounts created from this network. Try again later.", next }));
  }
  // Honeypot: real people never fill the hidden "website" field.
  if (req.body.website) return res.redirect("/");

  if (!validEmail(email)) {
    return res.status(400).send(signupView({ error: "Please enter a valid email address.", next, email, displayName }));
  }
  if (password.length < 8) {
    return res.status(400).send(signupView({ error: "Password must be at least 8 characters.", next, email, displayName }));
  }
  if (!displayName || displayName.length > 60) {
    return res.status(400).send(signupView({ error: "Display name is required.", next, email, displayName }));
  }

  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (existing) {
    // Common mistake: they already have an account. Right password → just sign them in and carry on.
    if (!existing.banned && checkPassword(password, existing.password_hash)) {
      syncAdmin(existing);
      createSession(res, existing.id);
      return res.redirect(next);
    }
    return res.send(loginView({ message: "You already have an account with this email. Sign in below, or reset your password.", email, next }));
  }

  let userId;
  try {
    userId = createUser({ email, password, displayName });
  } catch {
    // Two signups racing for the same email: the UNIQUE constraint wins.
    return res.status(400).send(signupView({ error: "An account with this email already exists.", next }));
  }
  createSession(res, userId);
  db.prepare("UPDATE users SET locale = ? WHERE id = ?").run(getLocale(), userId);
  sendWelcome({ id: userId, email, display_name: displayName });
  res.redirect(next);
});

/** Welcome email doubling as the email-confirmation link. */
function sendWelcome(user) {
  const link = `${config.appUrl}${localePath(`/verify/${issueVerifyToken(user.id)}`, getLocale())}`;
  return sendMail({
    to: user.email,
    subject: t("Welcome to {site}", { site: config.siteName }),
    text: `${t("Peace be with you, {name}.", { name: user.display_name })}\n\n${t("Please confirm your email address:")}\n${link}\n\n${t("Memberships unlock the message board, the full reading library, study guides, and store discounts")}: ${config.appUrl}${localePath("/pricing", getLocale())}\n\n— ${config.siteName}`,
  });
}

app.get("/verify/:token", (req, res) => {
  const userId = consumeVerifyToken(req.params.token);
  if (!userId) return res.redirect(req.user ? "/account?error=" + encodeURIComponent("That confirmation link has expired. Send a new one below.") : "/login");
  if (!req.user) createSession(res, userId);
  res.redirect("/account?verified=1");
});

app.post("/account/verify-email", requireUser, async (req, res) => {
  if (!req.user.email_verified && !rateLimited(`verify:${req.user.id}`, 3, 3600)) await sendWelcome(req.user);
  res.redirect("/account?sent=1");
});

app.get("/forgot", (req, res) => res.send(forgotView({})));

app.post("/forgot", async (req, res, next) => {
  const email = normalizeEmail(req.body.email);
  if (rateLimited(`forgot:${clientIp(req)}`, 5, 3600)) return tooMany(res, null);
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (user && !user.banned) {
    const link = issueResetLink(user.id);
    await sendMail({
      to: user.email,
      subject: t("Reset your {site} password", { site: config.siteName }),
      text: `${t("Someone (hopefully you) asked to reset your password.")}\n\n${t("Choose a new one here (valid for 1 hour):")}\n${link}\n\n${t("If this wasn't you, you can ignore this email.")}`,
    });
  }
  // Same response either way so emails can't be enumerated.
  res.send(forgotView({ sent: true }));
});

/** Passwords are trimmed when set; older accounts may have kept a stray space, so try exact first. */
function checkPassword(password, hash) {
  if (verifyPassword(password, hash)) return true;
  return password !== password.trim() && verifyPassword(password.trim(), hash);
}

function sendSetPasswordEmail(user) {
  return sendMail({
    to: user.email,
    subject: t("Set your {site} password", { site: config.siteName }),
    text: `${t("Choose a password for your account here (valid for 1 hour):")}\n${issueResetLink(user.id)}\n\n${t("If this wasn't you, you can ignore this email.")}`,
  });
}

function issueResetLink(userId) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(userId);
  db.prepare("INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, now() + 3600);
  return `${config.appUrl}${localePath(`/reset/${token}`, getLocale())}`;
}

const validReset = (token) => db.prepare("SELECT * FROM password_resets WHERE token = ? AND expires_at > ?").get(String(token), now());

app.get("/reset/:token", (req, res, next) => {
  if (!validReset(req.params.token)) return res.send(forgotView({ error: "That reset link has expired. Request a new one below." }));
  res.send(resetView({ token: req.params.token }));
});

app.post("/reset/:token", (req, res, next) => {
  const row = validReset(req.params.token);
  if (!row) return res.send(forgotView({ error: "That reset link has expired. Request a new one below." }));
  const pw = String(req.body.password || "").trim();
  if (pw.length < 8) return res.send(resetView({ token: req.params.token, error: "Password must be at least 8 characters." }));
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(pw), row.user_id);
  db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(row.user_id);
  markEmailVerified(row.user_id); // they clicked a link sent to the address
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);
  createSession(res, row.user_id);
  res.redirect("/account?saved=1");
});

app.post("/logout", (req, res, next) => {
  destroySession(req, res);
  res.redirect("/");
});

// Newsletter Subscription
app.post("/newsletter/subscribe", (req, res, next) => {
  const email = normalizeEmail(req.body.email);
  if (validEmail(email) && !rateLimited(`news:${clientIp(req)}`, 5, 3600)) {
    db.prepare("INSERT OR IGNORE INTO newsletter (email) VALUES (?)").run(email);
  }
  res.send(pages.newsletterThanks(req.user));
});

app.get("/newsletter/unsubscribe", (req, res, next) => {
  const email = normalizeEmail(req.query.e);
  if (letters.validUnsubscribe(email, req.query.k)) db.prepare("DELETE FROM newsletter WHERE email = ?").run(email);
  res.send(pages.unsubscribed());
});

// ---------------------------------------------------------------------------
// Static Ministry Pages
// ---------------------------------------------------------------------------

app.get("/about", (req, res) => res.send(pages.aboutPage(req.user)));
app.get("/contact", (req, res) => res.send(pages.contactPage(req.user)));
app.get("/privacy", (req, res) => res.send(pages.privacyPage(req.user)));
app.get("/terms", (req, res) => res.send(pages.termsPage(req.user)));

// ---------------------------------------------------------------------------
// Admin (only accounts listed in ADMIN_EMAILS)
// ---------------------------------------------------------------------------

app.get("/admin", requireAdmin, (req, res, next) => {
  const stats = {
    users: db.prepare("SELECT COUNT(*) c FROM users").get().c,
    members: db.prepare("SELECT plan, COUNT(*) c FROM users WHERE plan_status IN ('active','trialing','past_due','comped') GROUP BY plan").all(),
    pastDue: db.prepare("SELECT COUNT(*) c FROM users WHERE plan_status = 'past_due'").get().c,
    threads: db.prepare("SELECT COUNT(*) c FROM board_threads").get().c,
    posts: db.prepare("SELECT COUNT(*) c FROM board_posts").get().c,
    newsletter: db.prepare("SELECT COUNT(*) c FROM newsletter").get().c,
    orders: db.prepare("SELECT status, COUNT(*) c FROM store_orders GROUP BY status").all(),
    orderErrors: db.prepare("SELECT COUNT(*) c FROM store_orders WHERE printify_error IS NOT NULL AND printify_order_id IS NULL AND status = 'paid'").get().c,
  };
  res.send(adminViews.dashboardView({ user: req.user, stats, flash: req.query.flash || "", stripe: stripeEnabled(), printify: printifyEnabled() }));
});

app.get("/admin/users", requireAdmin, (req, res, next) => {
  const q = String(req.query.q || "").trim();
  const users = q
    ? db.prepare("SELECT * FROM users WHERE email LIKE ? OR display_name LIKE ? ORDER BY id DESC LIMIT 100").all(`%${q}%`, `%${q}%`)
    : db.prepare("SELECT * FROM users ORDER BY id DESC LIMIT 100").all();
  res.send(adminViews.usersView({ user: req.user, users, q, flash: req.query.flash || "" }));
});

app.post("/admin/users/:id", requireAdmin, (req, res, next) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(req.params.id));
  if (!target) return res.redirect("/admin/users");
  let flash = "Updated.";
  switch (req.body.action) {
    case "ban":
      if (target.is_admin) { flash = "Admins can't be banned."; break; }
      db.prepare("UPDATE users SET banned = 1 - banned WHERE id = ?").run(target.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
      break;
    case "comp": {
      // Grant a plan without Stripe (staff, volunteers, giveaways). Never overrides a paying subscription.
      const plan = planById(req.body.plan);
      if (target.stripe_subscription_id && ["active", "trialing", "past_due"].includes(target.plan_status)) { flash = "User has a paid subscription — change it in Stripe."; break; }
      if (plan) db.prepare("UPDATE users SET plan = ?, plan_status = 'comped' WHERE id = ?").run(plan.id, target.id);
      else db.prepare("UPDATE users SET plan = NULL, plan_status = NULL WHERE id = ? AND plan_status = 'comped'").run(target.id);
      break;
    }
    case "reset": {
      flash = `Reset link (valid 1 hour): ${issueResetLink(target.id)}`;
      break;
    }
  }
  res.redirect(`/admin/users?flash=${encodeURIComponent(flash)}`);
});

app.get("/admin/orders", requireAdmin, (req, res, next) => {
  const orders = db.prepare("SELECT o.*, u.email AS user_email FROM store_orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.status != 'pending' OR o.created_at > unixepoch() - 86400 ORDER BY o.id DESC LIMIT 200").all();
  res.send(adminViews.ordersView({ user: req.user, orders, flash: req.query.flash || "", autoSend: config.printify.autoSend }));
});

app.post("/admin/orders/:id", requireAdmin, async (req, res, next) => {
  const order = db.prepare("SELECT * FROM store_orders WHERE id = ?").get(Number(req.params.id));
  if (!order) return res.redirect("/admin/orders");
  let flash = "Done.";
  try {
    if (req.body.action === "retry") {
      await stripeApp.submitToPrintify(order.id);
      const o = db.prepare("SELECT * FROM store_orders WHERE id = ?").get(order.id);
      flash = o.printify_order_id ? `Sent to Printify (${o.printify_order_id}).` : `Still failing: ${o.printify_error}`;
    } else if (req.body.action === "produce" && order.printify_order_id) {
      await printify.sendToProduction(order.printify_order_id);
      db.prepare("UPDATE store_orders SET status = 'in_production', updated_at = ? WHERE id = ?").run(now(), order.id);
      flash = "Sent to production — Printify will charge your Printify balance/card.";
    } else if (req.body.action === "refresh" && order.printify_order_id) {
      const po = await printify.getOrder(order.printify_order_id);
      db.prepare("UPDATE store_orders SET printify_status = ?, updated_at = ? WHERE id = ?").run(po.status, now(), order.id);
      for (const s of po.shipments || []) await recordShipment(order, { carrier: s.carrier, number: s.number, url: s.url }, Boolean(s.delivered_at));
      flash = `Printify status: ${po.status}`;
    }
  } catch (e) {
    flash = `Error: ${e.message}`;
  }
  res.redirect(`/admin/orders?flash=${encodeURIComponent(flash)}`);
});

app.post("/admin/integrations", requireAdmin, async (req, res, next) => {
  let flash = "Done.";
  try {
    if (req.body.action === "printify-webhooks") {
      const hooks = await printify.registerWebhooks();
      flash = `Registered ${hooks.length} Printify webhooks → ${config.appUrl}/webhook/printify`;
    } else if (req.body.action === "printify-publish") {
      const ids = await printify.confirmAllPublishing();
      flash = ids.length ? `Confirmed ${ids.length} product(s) as published.` : "No products were stuck in Publishing.";
    } else if (req.body.action === "printify-refresh") {
      printify.bustCache();
      const products = await printify.getProducts({ force: true });
      flash = `Store catalog refreshed: ${products.length} product(s).`;
    } else if (req.body.action === "stripe-prices") {
      const prices = await stripeApp.ensurePrices();
      flash = `Stripe membership prices ready: ${Object.entries(prices).map(([k, v]) => `${k}=${v}`).join(", ")}`;
    }
  } catch (e) {
    flash = `Error: ${e.message}`;
  }
  res.redirect(`/admin?flash=${encodeURIComponent(flash)}`);
});

app.get("/admin/letters", requireAdmin, (req, res) => {
  res.send(adminViews.lettersAdminView({
    user: req.user,
    flash: req.query.flash || "",
    letters: letters.list(),
    counts: { members: letters.recipients("members").length, all: letters.recipients("all").length },
  }));
});

app.post("/admin/letters", requireAdmin, (req, res) => {
  const subject = String(req.body.subject || "").trim().slice(0, 200);
  const body = String(req.body.body || "").trim();
  const audience = req.body.audience === "all" ? "all" : "members";
  if (!subject || !body) return res.redirect("/admin/letters?flash=" + encodeURIComponent("Subject and body are required."));
  if (req.body.test) {
    sendMail({ to: req.user.email, subject: `[TEST] ${subject}`, text: body });
    return res.redirect("/admin/letters?flash=" + encodeURIComponent(`Test sent to ${req.user.email}.`));
  }
  const { total } = letters.publish({ subject, body, audience });
  res.redirect("/admin/letters?flash=" + encodeURIComponent(`Publishing to ${total} recipient(s). It's also live at /letters.`));
});

app.get("/admin/newsletter.csv", requireAdmin, (req, res, next) => {
  const rows = db.prepare("SELECT email, datetime(created_at, 'unixepoch') AS joined FROM newsletter ORDER BY created_at").all();
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=newsletter.csv");
  res.send("email,joined\n" + rows.map((r) => `${r.email},${r.joined}`).join("\n"));
});

// Health check for uptime monitors / deploy scripts.
app.get("/healthz", (req, res, next) => {
  db.prepare("SELECT 1").get();
  res.json({ ok: true, stripe: stripeEnabled(), printify: printifyEnabled(),
    webhook: Boolean(stripeApp.webhookSecret()), email: Boolean(config.resend.apiKey || config.smtp.host),
    queuedEmails: mailQueueStatus(),
    paidOrdersAwaitingSubmission: db.prepare("SELECT count(*) AS n FROM store_orders WHERE status = 'paid' AND printify_order_id IS NULL").get().n });
});

// Sitemap
app.get("/sitemap.xml", (req, res) => {
  const paths = ["/", "/signs", "/library", "/chart", "/quizzes", "/board", "/store", "/pricing", "/articles", "/guides", "/about", "/contact"];
  content.SIGNS_DATA.forEach((s) => paths.push(`/signs/${s.slug}`));
  content.ARTICLES.forEach((a) => paths.push(`/articles/${a.slug}`));
  content.QUIZZES.forEach((q) => paths.push(`/quizzes/${q.slug}`));
  content.READINGS.forEach((r) => paths.push(`/library/${r.slug}`));
  // One <url> per language, each listing its alternates (how Google learns the /es and /pt versions).
  const alt = (p) => LOCALES.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${config.appUrl}${localePath(p, l)}"/>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${paths.flatMap((p) => LOCALES.map((l) => `<url><loc>${config.appUrl}${localePath(p, l)}</loc>${alt(p)}</url>`)).join("\n")}
</urlset>`;
  res.type("application/xml").send(xml);
});

// Authorized ad sellers (required by AdSense).
app.get("/ads.txt", (req, res) => {
  res.type("text/plain").send(config.adsensePublisher ? `google.com, ${config.adsensePublisher}, DIRECT, f08c47fec0942fa0\n` : "");
});

// Robots.txt
app.get("/robots.txt", (req, res, next) => {
  res.setHeader("Content-Type", "text/plain");
  res.send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /account\nDisallow: /cart\nDisallow: /checkout\nDisallow: /*/account\nDisallow: /*/cart\nDisallow: /login\nDisallow: /signup\nDisallow: /*/login\nDisallow: /*/signup\nDisallow: /*?next=\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nSitemap: ${config.appUrl}/sitemap.xml\n`);
});

// 404 + error pages (Express 5 forwards async errors here automatically).
app.use((req, res) => {
  res.status(404).send(pages.notFound(req.user));
});

app.use((err, req, res, next) => {
  console.error("[error]", req.method, req.originalUrl, err);
  if (res.headersSent) return next(err);
  res.status(500).send(pages.serverError(req.user));
});

// Start Server
if (process.env.NODE_ENV !== "test") {
  app.listen(config.port, config.host, () => {
    console.log(`[christian-astrology] Server running on http://${config.host}:${config.port}`);
    console.log(`[christian-astrology] App URL configured as: ${config.appUrl}`);
    console.log(`[christian-astrology] Stripe enabled: ${stripeEnabled()}`);
    console.log(`[christian-astrology] Printify enabled: ${printifyEnabled()}`);
    // Printify order status + tracking, checked every 20 minutes (no Printify webhooks needed).
    setTimeout(() => syncPrintifyOrders().catch((e) => console.warn("[printify-sync]", e.message)), 30_000);
    setInterval(() => syncPrintifyOrders().catch((e) => console.warn("[printify-sync]", e.message)), 20 * 60_000).unref();
    const recover = () => Promise.allSettled([stripeApp.retryPaidOrders(), retryMail()]);
    setTimeout(recover, 10_000).unref();
    setInterval(recover, 60_000).unref();
    // Self-check at startup, so nobody has to test payments by hand: key works, prices exist, webhook is set up.
    let stripeSetupDone = false;
    let stripeSetupRunning = false;
    async function setupStripe() {
      if (!stripeEnabled() || stripeSetupDone || stripeSetupRunning) return;
      stripeSetupRunning = true;
      return stripeApp
        .ensurePrices()
        .then(() => console.log("[christian-astrology] Stripe connected: membership prices ready"))
        .then(() => stripeApp.ensureWebhook())
        .then((r) => {
          if (!r.skipped) console.log(`[christian-astrology] Stripe webhook ready (${r.id})`);
          stripeSetupDone = Boolean(r.ok || stripeApp.webhookSecret());
        })
        .catch((e) => console.error("[christian-astrology] Stripe setup will retry:", e.message))
        .finally(() => { stripeSetupRunning = false; });
    }
    setupStripe();
    setInterval(setupStripe, 60_000).unref();
  });
}

export default app;
