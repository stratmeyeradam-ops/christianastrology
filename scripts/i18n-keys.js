// Lists every translatable string and reports which ones are missing from src/i18n/<lang>.json.
//   node scripts/i18n-keys.js            → summary
//   node scripts/i18n-keys.js --missing  → JSON of missing keys per language
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PLANS, GUIDES } from "../src/plans.js";

const root = new URL("..", import.meta.url).pathname;
const files = ["server.js", "src/stripe.js", ...readdirSync(join(root, "src/views")).map((f) => `src/views/${f}`)].filter(
  (f) => !f.endsWith("admin.js"),
);

const keys = new Set();
// t("..."), t('...'), t(`...`) without interpolation; first argument only.
const re = /\b(?:t|p|h3)\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`$]*)`)/g;
for (const f of files) {
  const src = readFileSync(join(root, f), "utf8");
  for (const m of src.matchAll(re)) keys.add(JSON.parse(`"${(m[1] ?? m[2] ?? m[3]).replace(/\\'/g, "'").replace(/"/g, '\\"').replace(/\\\\"/g, '\\"')}"`));
}

// Strings that reach t() through variables.
const dynamic = [
  ...PLANS.flatMap((p) => [p.name, p.rank, p.blurb, ...p.points]),
  "Member", "Minister",
  "Home", "The 12 Signs", "Library", "Natal Chart", "Quizzes", "Message Board", "Store", "Memberships",
  ...GUIDES.flatMap((g) => [g.title, g.desc]),
  "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
  "active", "trialing", "past_due", "comped", "canceled", "incomplete", "unpaid",
  "Paid — preparing", "Sent to printer", "In production", "Shipped", "Delivered", "Canceled", "Refunded",
  "Welcome & Introductions", "Say hello, share your sign, and tell us how you found the fellowship.",
  "The Mazzaroth & Scripture", "Job 38, Psalm 19, Genesis 1:14 — study the heavens through the Word.",
  "Charts & Placements", "Share your chart, ask about placements, and learn together with grace.",
  "Seasons & Transits", "What is happening in the sky this week, and what it stirs in prayer.",
  "Prayer Requests", "Lift one another up. Saint members' requests are marked for priority prayer.",
  "The Sunday Letter (weekly email)", "Discernment quizzes", "Biblical reading library", "120 foundations", "✓ All 1,560",
  "Community Message Board", "Read only", "✓ Post & reply", "✓ Elder standing", "PDF study guides", "✓ 2 guides", "✓ All 4 guides",
  "Full 10-planet natal chart", "Priority prayer requests", "Store discount", "10% off", "20% off", "30% off",
  "✦ Welcome to your membership! Your access has been unlocked.", "Saved.",
  "Current password is incorrect.", "New password must be at least 8 characters.",
  "Your cart is empty.", "Too many items in cart.", "An item in your cart is no longer available.",
  "The store is in preview mode — checkout opens once Printify is connected.",
  "No billing account yet — choose a membership first.",
  "Thank you — your email is confirmed.", "Confirmation email sent. Check your inbox.",
  "That confirmation link has expired. Send a new one below.",
  "Something went wrong. Please try again, or contact us if it keeps happening.",
  "An option in your cart is no longer available.",
];
const verses = readFileSync(join(root, "src/content.js"), "utf8").matchAll(/\["([^"]+)", "([^"]+)"\]/g);
for (const [, text, ref] of verses) dynamic.push(text, ref);
dynamic.forEach((k) => keys.add(k));

const all = [...keys].sort();
const report = {};
for (const lang of ["es", "pt"]) {
  const f = join(root, `src/i18n/${lang}.json`);
  const dict = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  report[lang] = all.filter((k) => !dict[k]);
}
if (process.argv.includes("--missing")) console.log(JSON.stringify(report, null, 1));
else if (process.argv.includes("--all")) console.log(JSON.stringify(all, null, 1));
else for (const [l, m] of Object.entries(report)) console.log(`${l}: ${all.length - m.length}/${all.length} translated`);
