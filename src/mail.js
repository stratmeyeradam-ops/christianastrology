// Immediate delivery with a persistent outbox for temporary provider failures.
// Resend HTTPS is preferred; SMTP remains available. The recovery worker retries once a minute.
import nodemailer from "nodemailer";
import { config } from "./config.js";
import { db, now } from "./db.js";

db.exec(`CREATE TABLE IF NOT EXISTS mail_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, subject TEXT NOT NULL,
  body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);
let transport;
function getTransport() {
  return transport ??= nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}
async function deliver(row) {
  if (config.resend.apiKey) {
    const html = row.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.resend.apiKey}`, "Content-Type": "application/json",
        "Idempotency-Key": `ca-mail-${row.created_at}-${row.id}` },
      body: JSON.stringify({ from: config.smtp.from, to: row.recipient, subject: row.subject, text: row.body, html }),
      signal: AbortSignal.timeout(20000),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Resend ${res.status}: ${result.message || res.statusText}`);
    return;
  }
  if (!config.smtp.host) throw new Error("Email is not configured; message queued until credentials are supplied.");
  await getTransport().sendMail({ from: config.smtp.from, to: row.recipient, subject: row.subject, text: row.body });
}
async function attempt(id) {
  const claimed = db.prepare("UPDATE mail_outbox SET lease_until = ? WHERE id = ? AND lease_until <= ?").run(now() + 60, id, now());
  if (!claimed.changes) return false;
  const row = db.prepare("SELECT * FROM mail_outbox WHERE id = ?").get(id);
  try {
    await deliver(row);
    db.prepare("DELETE FROM mail_outbox WHERE id = ?").run(id);
    return true;
  } catch (e) {
    const delay = Math.min(3600, 60 * 2 ** Math.min(row.attempts, 6));
    db.prepare("UPDATE mail_outbox SET attempts = attempts + 1, retry_at = ?, lease_until = 0, last_error = ? WHERE id = ?")
      .run(now() + delay, String(e.message).slice(0, 1000), id);
    console.error("[mail] delivery queued:", e.message);
    return false;
  }
}
export async function sendMail({ to, subject, text }) {
  // Offline tests capture messages without requiring a real mail service.
  if (process.env.NODE_ENV === "test" && !config.resend.apiKey && !config.smtp.host) {
    console.log(`[mail:disabled] to=${to} subject="${subject}"\n${text}\n`);
    return true;
  }
  const id = Number(db.prepare("INSERT INTO mail_outbox (recipient, subject, body) VALUES (?, ?, ?)")
    .run(String(to), String(subject), String(text)).lastInsertRowid);
  return attempt(id);
}
export const mailQueueStatus = () => db.prepare("SELECT count(*) AS n FROM mail_outbox").get().n;
let retrying = false;
export async function retryMail() {
  if (retrying) return 0;
  retrying = true;
  try {
    const rows = db.prepare("SELECT id FROM mail_outbox WHERE retry_at <= ? AND lease_until <= ? ORDER BY id LIMIT 25").all(now(), now());
    for (const row of rows) await attempt(row.id);
    return rows.length;
  } finally { retrying = false; }
}
