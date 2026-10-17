// Crawls the whole site in all three languages, as a visitor and as a Saint member, on a throwaway database.
// Reports broken links/images/scripts, server errors, redirect loops and members being bounced to sign-in.
//   node --env-file-if-exists=.env --disable-warning=ExperimentalWarning scripts/crawl.js
// Read-only against Printify (it just lists products); never touches Stripe.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ca-crawl-"));
Object.assign(process.env, { RESEND_API_KEY: "", PRINTIFY_AUTO_SEND: "false", NODE_ENV: "test", DATABASE_PATH: join(dir, "c.db"), STRIPE_SECRET_KEY: "", SMTP_HOST: "" });
console.log = ((log) => (...a) => (String(a[0]).startsWith("[mail:disabled]") ? null : log(...a)))(console.log);

const { default: app } = await import("../server.js");
const { db } = await import("../src/db.js");
const { createUser } = await import("../src/auth.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;

// A Saint member (comped) with a confirmed email, plus one board thread so thread pages get crawled.
const uid = createUser({ email: "crawl@test.local", password: "crawl-pass-1", displayName: "Crawler" });
db.prepare("UPDATE users SET plan = 'saint', plan_status = 'comped', email_verified = 1 WHERE id = ?").run(uid);
const cat = db.prepare("SELECT id FROM board_categories ORDER BY sort_order LIMIT 1").get();
const tid = db.prepare("INSERT INTO board_threads (category_id, user_id, title, last_post_at) VALUES (?, ?, 'Crawl thread', unixepoch())").run(cat.id, uid).lastInsertRowid;
db.prepare("INSERT INTO board_posts (thread_id, user_id, body) VALUES (?, ?, 'Hello')").run(tid, uid);

async function login() {
  const r = await fetch(base + "/login", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "email=crawl%40test.local&password=crawl-pass-1" });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const SKIP = /^\/(?:(?:es|pt)\/)?(?:logout|checkout\/|billing|admin|webhook|newsletter\/unsubscribe|verify\/|reset\/)/;
const PER_PATTERN = 25; // e.g. 1,560 readings × 3 languages: sample, don't fetch them all
const pattern = (p) => p.replace(/^\/(es|pt)(?=\/|$)/, "").replace(/\/[^/]+$/, "/*");

async function crawl(label, cookie, lang) {
  const member = Boolean(cookie);
  cookie = [cookie, `lang=${lang}`].filter(Boolean).join("; "); // links are unprefixed; the cookie keeps the language
  const seen = new Set();
  const perPattern = new Map();
  const queue = [lang === "en" ? "/" : `/${lang}/`];
  const problems = [];
  let pages = 0, assets = 0;
  const fetchOne = (url) => fetch(base + url, { redirect: "manual", headers: cookie ? { cookie } : {} });
  while (queue.length) {
    const url = queue.shift();
    let res = await fetchOne(url);
    const hops = [url];
    while (res.status >= 300 && res.status < 400) {
      const to = new URL(res.headers.get("location"), base);
      if (to.origin !== base) break; // off-site (e.g. Stripe): fine
      const next = to.pathname + to.search;
      if (hops.includes(next) || hops.length > 5) { problems.push(`${url}: redirect loop ${hops.join(" → ")}`); break; }
      hops.push(next);
      res = await fetchOne(next);
    }
    const final = hops.at(-1);
    if (member && /^\/(?:(?:es|pt)\/)?login/.test(final) && !/login/.test(url)) problems.push(`${url}: member bounced to sign-in`);
    if (res.status >= 400) { problems.push(`${url}: HTTP ${res.status}${hops.length > 1 ? ` (via ${hops.join(" → ")})` : ""}`); continue; }
    pages++;
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html")) continue;
    const html = await res.text();
    if (/Something went wrong|Internal Server Error|undefined<\/|>undefined<|NaN|\[object Object\]/.test(html)) problems.push(`${final}: suspicious text on page (undefined/NaN/error)`);
    if (lang !== "en" && !new RegExp(`<html lang="${lang}`).test(html)) problems.push(`${final}: not in ${lang}`);
    for (const m of html.matchAll(/<(?:img|script)[^>]+src="([^"]+)"|<link[^>]+href="([^"]+)"/g)) {
      const src = m[1] || m[2];
      if (!src.startsWith("/") || src.startsWith("//") || seen.has(src)) continue;
      seen.add(src);
      const a = await fetchOne(src);
      assets++;
      if (a.status >= 400) problems.push(`${final}: asset ${src} → HTTP ${a.status}`);
    }
    for (const m of html.matchAll(/<a[^>]+href="([^"#]+)/g)) {
      let href = m[1].replace(/&amp;/g, "&");
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      href = href.split("#")[0];
      if (seen.has(href) || SKIP.test(href)) continue;
      const pre = /^\/(en|es|pt)(?=\/|$)/.exec(href)?.[1];
      if (pre && pre !== lang) continue; // the language menu: switching languages is fine, crawl each one on its own pass
      const key = pattern(href);
      const n = perPattern.get(key) || 0;
      if (n >= PER_PATTERN && key.endsWith("/*")) continue;
      perPattern.set(key, n + 1);
      seen.add(href);
      queue.push(href);
    }
  }
  console.log(`\n${label} (${lang}): ${pages} pages, ${assets} assets checked, ${problems.length} problem(s)`);
  for (const p of problems) console.log("  ✗", p);
  return problems.length;
}

let bad = 0;
try {
  const member = await login();
  for (const lang of ["en", "es", "pt"]) {
    bad += await crawl("Visitor", "", lang);
    bad += await crawl("Saint member", member, lang);
  }
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  setTimeout(() => process.exit(bad ? 1 : 0), 50).unref();
}
