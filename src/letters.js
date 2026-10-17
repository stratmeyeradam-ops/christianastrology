// The Sunday Letter: composed in /admin/letters, emailed to members (and optionally newsletter
// subscribers), and archived on the site at /letters for Pilgrim+ members.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db, now } from "./db.js";
import { config } from "./config.js";
import { sendMail } from "./mail.js";

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

// Per-install secret for signing unsubscribe links (generated once, kept in the DB).
function secret() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app_secret'").get();
  if (row) return row.value;
  const v = randomBytes(32).toString("hex");
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('app_secret', ?)").run(v);
  return db.prepare("SELECT value FROM settings WHERE key = 'app_secret'").get().value;
}

const sign = (email) => createHmac("sha256", secret()).update(`unsub:${email}`).digest("hex").slice(0, 32);
export const unsubscribeUrl = (email) => `${config.appUrl}/newsletter/unsubscribe?e=${encodeURIComponent(email)}&k=${sign(email)}`;
export function validUnsubscribe(email, k) {
  const a = Buffer.from(sign(email));
  const b = Buffer.from(String(k || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function recipients(audience) {
  const members = db
    .prepare("SELECT email FROM users WHERE banned = 0 AND (is_admin = 1 OR (plan IS NOT NULL AND plan_status IN ('active','trialing','past_due','comped')))")
    .all()
    .map((r) => ({ email: r.email, member: true }));
  if (audience !== "all") return members;
  const seen = new Set(members.map((m) => m.email));
  const subs = db.prepare("SELECT email FROM newsletter").all().filter((r) => !seen.has(r.email)).map((r) => ({ email: r.email, member: false }));
  return [...members, ...subs];
}

/** Save the letter, then send in the background (one at a time, gentle on the SMTP server). */
export function publish({ subject, body, audience }) {
  const id = Number(db.prepare("INSERT INTO letters (subject, body, audience) VALUES (?, ?, ?)").run(subject, body, audience).lastInsertRowid);
  const list = recipients(audience);
  (async () => {
    let sent = 0;
    for (const r of list) {
      const footer = r.member
        ? `\n\n—\nRead past letters: ${config.appUrl}/letters\nManage your membership: ${config.appUrl}/account`
        : `\n\n—\nUnsubscribe: ${unsubscribeUrl(r.email)}`;
      if (await sendMail({ to: r.email, subject, text: body + footer })) sent++;
      db.prepare("UPDATE letters SET sent_count = ? WHERE id = ?").run(sent, id);
      await new Promise((ok) => setTimeout(ok, 250));
    }
    console.log(`[letters] #${id} sent to ${sent}/${list.length}`);
  })();
  return { id, total: list.length };
}

export const list = () => db.prepare("SELECT * FROM letters ORDER BY id DESC LIMIT 100").all();
export const get = (id) => db.prepare("SELECT * FROM letters WHERE id = ?").get(Number(id));
export { now };
