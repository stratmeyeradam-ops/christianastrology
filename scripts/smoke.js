// End-to-end smoke test. Runs the real app against a throwaway database — never touches data/app.db.
//   npm run smoke
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "ca-smoke-"));
Object.assign(process.env, { RESEND_API_KEY: "", PRINTIFY_AUTO_SEND: "false",
  NODE_ENV: "test",
  DATABASE_PATH: join(dir, "test.db"),
  ADMIN_EMAILS: "admin@test.local",
  APP_URL: "http://localhost",
  STRIPE_SECRET_KEY: "",
  PRINTIFY_API_TOKEN: "",
  SMTP_HOST: "",
  PRINTIFY_WEBHOOK_SECRET: "smoke-secret",
});
console.log = ((log) => (...a) => (String(a[0]).startsWith("[mail:disabled]") ? null : log(...a)))(console.log);

const { default: app } = await import("../server.js");
const { db } = await import("../src/db.js");
const content = await import("../src/content.js");
const { GUIDES } = await import("../src/plans.js");

const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;

// Minimal cookie-jar client.
function client() {
  const jar = new Map();
  return async function req(path, { method = "GET", form, json, headers = {}, raw } = {}) {
    const h = { ...headers, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
    let body;
    if (form) { body = new URLSearchParams(form).toString(); h["content-type"] = "application/x-www-form-urlencoded"; }
    if (json) { body = JSON.stringify(json); h["content-type"] = "application/json"; }
    if (raw) body = raw;
    const res = await fetch(base + path, { method, headers: h, body, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k, v] = kv.split("=");
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c)) jar.delete(k); else jar.set(k, v);
    }
    return { status: res.status, location: res.headers.get("location"), text: await res.text() };
  };
}

let passed = 0;
const step = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

try {
  console.log("\nContent");
  await step("12 signs, 1,560 readings, articles, quizzes, guide PDFs", () => {
    assert.equal(content.SIGNS_DATA.length, 12);
    assert.equal(content.READINGS.length, 1560);
    assert.ok(content.ARTICLES.length >= 4 && content.QUIZZES.length >= 3);
    assert.equal(GUIDES.length, 4);
  });

  console.log("\nPublic pages (en / es / pt)");
  const anon = client();
  const pages = ["/", "/signs", "/signs/aries", "/library", "/library/sun-in-aries", "/chart", "/quizzes", "/articles", "/board", "/board/welcome", "/store", "/store/demo-tee", "/cart", "/pricing", "/guides", "/letters", "/login", "/forgot", "/about", "/contact", "/privacy", "/terms"];
  await step(`${pages.length} pages × 3 languages return 200`, async () => {
    for (const pre of ["", "/es", "/pt"]) for (const p of pages) assert.equal((await anon(pre + p)).status, 200, pre + p);
  });
  await step("Spanish and Portuguese actually render translated", async () => {
    assert.match((await anon("/es/pricing")).text, /Membresías/);
    assert.match((await anon("/pt/pricing")).text, /Assinaturas/);
    assert.match((await anon("/es")).text, /<html lang="es">/);
  });
  await step("404 page, /store/thanks not shadowed by /store/:id", async () => {
    assert.equal((await anon("/en/definitely-not-here")).status, 404);
    assert.match((await anon("/store/thanks")).text, /Thank you for your order/);
  });
  await step("open redirect blocked on login", async () => {
    const r = await anon("/login", { method: "POST", form: { email: "x@y.z", password: "nope", next: "//evil.com" } });
    assert.ok(!String(r.location || "").includes("evil"));
  });

  console.log("\nAccounts");
  let alice = client();
  await step("signup → signed in → account page", async () => {
    const r = await alice("/signup", { method: "POST", form: { displayName: "Alice", email: "alice@test.local", password: "password123", next: "/account" } });
    assert.equal(r.status, 302);
    assert.match((await alice("/account")).text, /Alice/);
  });
  await step("signing up again: right password signs in, wrong one shows sign-in; honeypot ignored", async () => {
    const again = client();
    const r = await again("/signup", { method: "POST", form: { displayName: "A2", email: " Alice@Test.local ", password: "password123 ", next: "/pricing" } });
    assert.equal(r.location, "/pricing");
    assert.match((await again("/account")).text, /Alice/);
    const wrong = await client()("/signup", { method: "POST", form: { displayName: "A2", email: "alice@test.local", password: "wrongpass99" } });
    assert.match(wrong.text, /You already have an account with this email/);
    assert.match(wrong.text, /value="alice@test.local"/);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE email = 'alice@test.local'").get().c, 1);
    await client()("/signup", { method: "POST", form: { displayName: "Bot", email: "bot@test.local", password: "password123", website: "spam" } });
    assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE email = 'bot@test.local'").get().c, 0);
  });
  await step("login keeps the typed email on a wrong password; signed-in visitors go straight to ?next", async () => {
    const r = await client()("/login", { method: "POST", form: { email: "alice@test.local", password: "nope-nope" } });
    assert.match(r.text, /value="alice@test.local"/);
    assert.equal((await alice("/signup?next=%2Fcheckout%2Fsubscribe%2Fdevoted")).location, "/checkout/subscribe/devoted");
  });
  await step("no free-signup detour: /signup goes to memberships, plan links go straight to checkout", async () => {
    assert.equal((await anon("/signup")).location, "/pricing");
    assert.equal((await anon("/signup?next=%2Fcheckout%2Fsubscribe%2Fsaint")).location, "/checkout/subscribe/saint");
    assert.match((await anon("/login")).text, /href="\/pricing"[^>]*>See memberships/);
  });
  await step("pricing remembers the locked page the visitor came from", async () => {
    const page = (await anon("/pricing", { headers: { referer: `${base}/library/sun-in-aries` } })).text;
    assert.match(page, /href="\/checkout\/subscribe\/pilgrim\?next=%2Flibrary%2Fsun-in-aries"/);
    assert.doesNotMatch((await anon("/pricing", { headers: { referer: "https://evil.example/x" } })).text, /\?next=/);
  });
  await step("password reset link works once", async () => {
    await anon("/forgot", { method: "POST", form: { email: "alice@test.local" } });
    const { token } = db.prepare("SELECT token FROM password_resets").get();
    const c = client();
    assert.equal((await c(`/reset/${token}`, { method: "POST", form: { password: "newpassword1" } })).status, 302);
    assert.match((await c("/account")).text, /Alice/);
    assert.match((await anon(`/reset/${token}`)).text, /expired/);
    // A reset signs out every old session (by design) — log back in for the rest of the run.
    assert.equal((await alice("/account")).status, 302);
    alice = client();
    assert.equal((await alice("/login", { method: "POST", form: { email: "alice@test.local", password: "newpassword1" } })).status, 302);
  });

  console.log("\nMembership gating & rewards");
  const admin = client();
  await admin("/signup", { method: "POST", form: { displayName: "Pastor", email: "admin@test.local", password: "password123" } });
  await step("admin email gets no access until the emailed link is clicked", async () => {
    assert.equal((await admin("/admin")).status, 404);
    const adminId = db.prepare("SELECT id FROM users WHERE email = 'admin@test.local'").get().id;
    const { token } = db.prepare("SELECT token FROM email_verifications WHERE user_id = ?").get(adminId);
    await admin(`/verify/${token}`);
    assert.equal((await admin("/admin")).status, 200);
  });
  const aliceId = db.prepare("SELECT id FROM users WHERE email = 'alice@test.local'").get().id;
  await step("free user: board read-only, guides locked, no discount", async () => {
    assert.equal((await alice("/board/welcome/new")).location, "/checkout/subscribe/devoted");
    assert.match((await alice("/board/welcome")).text, /The message board is for members/);
    assert.match((await alice(`/guides/download/${GUIDES[0].file}`)).location, /^\/pricing\?error=/);
    assert.doesNotMatch((await alice("/store")).text, /membership reward is applied/);
  });
  await step("admin comps Devoted → board posting, 20% store discount, Devoted guide", async () => {
    await admin(`/admin/users/${aliceId}`, { method: "POST", form: { action: "comp", plan: "devoted" } });
    assert.match((await alice("/store")).text, /<strong>20% off<\/strong>/);
    const cart = JSON.parse((await alice("/api/cart/details", { method: "POST", json: { items: [{ productId: "demo-mug", variantId: 3000, qty: 1 }] } })).text);
    assert.equal(cart.items[0].price, 1280); // $16.00 − 20%
    assert.equal((await alice(`/guides/download/${GUIDES[0].file}`)).status, 200);
    assert.match((await alice(`/guides/download/${GUIDES[2].file}`)).location, /^\/pricing\?error=/); // Saint-only
  });
  await step("preview-catalog items can't be bought", async () => {
    const r = await alice("/checkout/store", { method: "POST", form: { cart_json: JSON.stringify([{ productId: "demo-mug", variantId: 3000, qty: 1 }]) } });
    assert.match(r.location, /^\/cart\?error=/);
  });

  console.log("\nMessage board");
  let threadId;
  let bobC; // second member; signups are rate-limited per IP (5/hour), so the test reuses him
  await step("Devoted member starts a thread and replies", async () => {
    const r = await alice("/board/prayer/new", { method: "POST", form: { title: "Pray for my family", body: "Thank you all." } });
    threadId = Number(r.location.split("/").pop());
    await alice(`/board/thread/${threadId}/reply`, { method: "POST", form: { body: "Update: all is well." } });
    const page = (await alice(`/board/thread/${threadId}`)).text;
    assert.match(page, /Update: all is well/);
    assert.match(page, /Steward/);
    // Non-members see neither the posts nor the thread title.
    const locked = (await anon(`/board/thread/${threadId}`)).text;
    assert.match(locked, /The message board is for members/);
    assert.doesNotMatch(locked, /Update: all is well|Pray for my family/);
  });
  await step("reply emails go to thread participants (verified, opted in), throttled", async () => {
    bobC = client();
    await bobC("/signup", { method: "POST", form: { displayName: "Reply Bob", email: "rbob@test.local", password: "password123" } });
    const bob = db.prepare("SELECT id FROM users WHERE email = 'rbob@test.local'").get();
    db.prepare("UPDATE users SET plan = 'devoted', plan_status = 'comped', email_verified = 1 WHERE id = ?").run(bob.id);
    db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(aliceId);
    await bobC(`/board/thread/${threadId}/reply`, { method: "POST", form: { body: "Praying for you." } });
    assert.ok(db.prepare("SELECT 1 FROM thread_notifications WHERE user_id = ? AND thread_id = ?").get(aliceId, threadId), "Alice notified");
    assert.ok(!db.prepare("SELECT 1 FROM thread_notifications WHERE user_id = ?").get(bob.id), "replier not notified");
  });
  await step("HTML in posts is escaped", async () => {
    await alice(`/board/thread/${threadId}/reply`, { method: "POST", form: { body: "<script>alert(1)</script>" } });
    assert.doesNotMatch((await alice(`/board/thread/${threadId}`)).text, /<script>alert\(1\)/);
  });
  await step("author edits own post; others cannot delete it", async () => {
    const post = db.prepare("SELECT id FROM board_posts WHERE thread_id = ? ORDER BY id DESC").get(threadId);
    await alice(`/board/post/${post.id}/edit`, { method: "POST", form: { body: "Edited text" } });
    assert.equal(db.prepare("SELECT body FROM board_posts WHERE id = ?").get(post.id).body, "Edited text");
    assert.equal((await bobC(`/board/post/${post.id}/delete`, { method: "POST" })).status, 404);
  });
  await step("admin locks thread → member can't reply; pin works", async () => {
    await admin(`/board/thread/${threadId}/mod`, { method: "POST", form: { action: "lock" } });
    await admin(`/board/thread/${threadId}/mod`, { method: "POST", form: { action: "pin" } });
    const before = db.prepare("SELECT COUNT(*) c FROM board_posts WHERE thread_id = ?").get(threadId).c;
    await alice(`/board/thread/${threadId}/reply`, { method: "POST", form: { body: "should not post" } });
    assert.equal(db.prepare("SELECT COUNT(*) c FROM board_posts WHERE thread_id = ?").get(threadId).c, before);
    assert.equal(db.prepare("SELECT pinned FROM board_threads WHERE id = ?").get(threadId).pinned, 1);
  });
  await step("banned member is signed out", async () => {
    await admin(`/admin/users/${aliceId}`, { method: "POST", form: { action: "ban" } });
    assert.equal((await alice("/account")).status, 302);
    await admin(`/admin/users/${aliceId}`, { method: "POST", form: { action: "ban" } });
  });

  console.log("\nAdmin, letters, Printify webhook");
  await step("admin pages require admin", async () => {
    assert.equal((await anon("/admin")).status, 404);
    for (const p of ["/admin", "/admin/users", "/admin/orders", "/admin/letters"]) assert.equal((await admin(p)).status, 200, p);
  });
  await step("Sunday Letter publishes and is members-only on the site", async () => {
    await admin("/admin/letters", { method: "POST", form: { subject: "Week One", body: "Grace and peace.", audience: "members" } });
    const l = db.prepare("SELECT id FROM letters").get();
    assert.match((await admin(`/letters/${l.id}`)).text, /Grace and peace/);
    assert.doesNotMatch((await anon(`/letters/${l.id}`)).text, /Grace and peace/);
  });
  await step("Printify webhook: bad signature rejected, shipment updates order", async () => {
    const orderId = Number(db.prepare("INSERT INTO store_orders (user_id, items_json, subtotal_cents, status, printify_order_id, email) VALUES (?, '[]', 1000, 'submitted', 'pf_1', 'a@b.c')").run(aliceId).lastInsertRowid);
    const evt = JSON.stringify({ id: "e1", type: "order:shipment:created", resource: { id: "pf_1", type: "order", data: { carrier: { code: "usps", tracking_number: "9400", tracking_url: "https://t.example/9400" } } } });
    assert.equal((await anon("/webhook/printify", { method: "POST", raw: evt, headers: { "content-type": "application/json", "x-pfy-signature": "sha256=" + "0".repeat(64) } })).status, 401);
    const sig = "sha256=" + createHmac("sha256", "smoke-secret").update(evt).digest("hex");
    assert.equal((await anon("/webhook/printify", { method: "POST", raw: evt, headers: { "content-type": "application/json", "x-pfy-signature": sig } })).status, 200);
    await new Promise((r) => setTimeout(r, 100));
    const o = db.prepare("SELECT * FROM store_orders WHERE id = ?").get(orderId);
    assert.equal(o.status, "shipped");
    assert.match(o.tracking_json, /9400/);
  });

  console.log("\nSEO, ads, messages");
  await step("verification tags, ads.txt, ads only for non-members", async () => {
    const home = (await anon("/")).text;
    assert.match(home, /google-site-verification/);
    assert.match(home, /msvalidate\.01/);
    assert.match(home, /yandex-verification/);
    assert.match(home, /adsbygoogle\.js\?client=ca-pub-/);
    assert.doesNotMatch((await bobC("/")).text, /adsbygoogle\.js/); // Bob is a member
    assert.doesNotMatch((await anon("/pricing")).text, /adsbygoogle\.js/);
    assert.match((await anon("/ads.txt")).text, /google\.com, pub-\d+, DIRECT/);
    assert.match((await anon("/sitemap.xml")).text, /hreflang="pt"/);
  });
  await step("?error= only shows our own messages", async () => {
    assert.doesNotMatch((await anon("/pricing?error=Call%20555-SCAM")).text, /555-SCAM/);
    assert.match((await anon("/pricing?error=Your%20cart%20is%20empty.")).text, /Your cart is empty/);
  });

  console.log("\nNatal chart");
  await step("time zone converts local birth time to UT", async () => {
    const r = await anon("/chart", { method: "POST", form: { birthDate: "1990-01-01", birthTime: "23:30", tz: "America/New_York" } });
    assert.equal(r.status, 200);
    assert.match(r.text, /Capricorn/);
  });

  await step("Saint chart calculates and renders houses from birthplace coordinates", async () => {
    const chartUser = client();
    await chartUser('/signup', { method: 'POST', form: { email: 'chart@test.local', password: 'chart-pass-123', displayName: 'Chart' } });
    db.prepare("UPDATE users SET plan = 'saint', plan_status = 'comped' WHERE email = 'chart@test.local'").run();
    const r = await chartUser('/chart', { method: 'POST', form: { birthDate: '1990-01-01', birthTime: '23:30', tz: 'America/New_York', lat: '40.7128', lon: '-74.0060' } });
    assert.equal(r.status, 200);
    assert.match(r.text, /Ascendant/);
    assert.match(r.text, /House 12/);
    const missing = await chartUser('/chart', { method: 'POST', form: { birthDate: '1990-01-01', birthTime: '23:30', tz: 'America/New_York' } });
    assert.match(missing.text, /Add birth time and birthplace coordinates/);
    assert.doesNotMatch(missing.text, /NaN/);
    assert.equal((await chartUser('/chart', { method: 'POST', form: { birthDate: '1990-02-31', lat: '40', lon: '-74' } })).status, 400);
    assert.equal((await chartUser('/chart', { method: 'POST', form: { birthDate: '1990-01-01', lat: '200', lon: '-74' } })).status, 400);
  });
  console.log(`\n✅ ${passed} checks passed\n`);
} catch (e) {
  console.error("\n❌ Smoke test failed:\n", e);
  process.exitCode = 1;
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  setTimeout(() => process.exit(), 50).unref();
}
