import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  plan TEXT,
  plan_status TEXT,
  current_period_end INTEGER,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS newsletter (
  email TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS board_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS board_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES board_categories(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  last_post_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS threads_cat_idx ON board_threads(category_id, pinned DESC, last_post_at DESC);

CREATE TABLE IF NOT EXISTS board_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES board_threads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS posts_thread_idx ON board_posts(thread_id, id);

CREATE TABLE IF NOT EXISTS store_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  items_json TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_session_id TEXT UNIQUE,
  email TEXT,
  shipping_json TEXT,
  printify_order_id TEXT,
  printify_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

// Additive migrations for databases created by earlier versions.
function addColumn(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}
addColumn("store_orders", "discount_cents", "INTEGER NOT NULL DEFAULT 0");
addColumn("store_orders", "total_cents", "INTEGER");
addColumn("store_orders", "printify_status", "TEXT");
addColumn("store_orders", "tracking_json", "TEXT");
addColumn("store_orders", "updated_at", "INTEGER");
addColumn("board_posts", "edited_at", "INTEGER");
addColumn("store_orders", "lang", "TEXT");
addColumn("users", "locale", "TEXT");
addColumn("users", "email_verified", "INTEGER NOT NULL DEFAULT 0");
addColumn("users", "notify_replies", "INTEGER NOT NULL DEFAULT 1");
addColumn("users", "cancel_at_period_end", "INTEGER NOT NULL DEFAULT 0");
addColumn("store_orders", "stripe_payment_intent", "TEXT");
addColumn("store_orders", "fulfillment_attempts", "INTEGER NOT NULL DEFAULT 0");
addColumn("store_orders", "fulfillment_retry_at", "INTEGER NOT NULL DEFAULT 0");
addColumn("store_orders", "fulfillment_lease_until", "INTEGER NOT NULL DEFAULT 0");
db.exec("CREATE INDEX IF NOT EXISTS orders_pi_idx ON store_orders(stripe_payment_intent)");
db.exec(`
CREATE TABLE IF NOT EXISTS email_verifications (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_notifications (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL REFERENCES board_threads(id) ON DELETE CASCADE,
  last_sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, thread_id)
);
`);
db.exec("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
db.exec("CREATE INDEX IF NOT EXISTS orders_user_idx ON store_orders(user_id, id DESC)");
db.exec("CREATE INDEX IF NOT EXISTS orders_pf_idx ON store_orders(printify_order_id)");

// Seed board categories once.
const seed = [
  ["welcome", "Welcome & Introductions", "Say hello, share your sign, and tell us how you found the fellowship.", 1],
  ["mazzaroth", "The Mazzaroth & Scripture", "Job 38, Psalm 19, Genesis 1:14 — study the heavens through the Word.", 2],
  ["charts", "Charts & Placements", "Share your chart, ask about placements, and learn together with grace.", 3],
  ["seasons", "Seasons & Transits", "What is happening in the sky this week, and what it stirs in prayer.", 4],
  ["prayer", "Prayer Requests", "Lift one another up. Saint members' requests are marked for priority prayer.", 5],
];
const insertCat = db.prepare(
  "INSERT OR IGNORE INTO board_categories (slug, name, description, sort_order) VALUES (?, ?, ?, ?)",
);
for (const row of seed) insertCat.run(...row);

export const now = () => Math.floor(Date.now() / 1000);

/** Run fn inside a transaction. */
export function tx(fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
