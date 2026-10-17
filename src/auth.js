import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, now } from "./db.js";
import { config } from "./config.js";

const COOKIE = "ca_sid";
const SESSION_DAYS = 30;

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

// Used when the email doesn't exist, so a failed login takes as long either way (no account enumeration by timing).
const DUMMY_HASH = hashPassword("not-a-real-password");

export function verifyPassword(pw, stored = DUMMY_HASH) {
  if (typeof pw !== "string") return false;
  const [alg, saltHex, hashHex] = String(stored).split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pw, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

export const normalizeEmail = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

export function createSession(res, userId) {
  const id = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(
    id,
    userId,
    now() + SESSION_DAYS * 86400,
  );
  res.cookie(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    maxAge: SESSION_DAYS * 86400 * 1000,
    path: "/",
  });
}

export function destroySession(req, res) {
  const sid = readCookie(req, COOKIE);
  if (sid) db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
  res.clearCookie(COOKIE, { path: "/" });
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Attaches req.user (or null) on every request. */
export function loadUser(req, res, next) {
  req.user = null;
  const sid = readCookie(req, COOKIE);
  if (sid) {
    const row = db
      .prepare(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?",
      )
      .get(sid, now());
    if (row && !row.banned) {
      syncAdmin(row);
      req.user = row;
    }
  }
  res.locals.user = req.user;
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(404).send("Not found");
  next();
}

export function createUser({ email, password, displayName }) {
  const info = db
    .prepare("INSERT INTO users (email, password_hash, display_name, is_admin) VALUES (?, ?, ?, 0)")
    .run(email, hashPassword(password), displayName);
  return Number(info.lastInsertRowid);
}

/**
 * Admin = email listed in ADMIN_EMAILS *and* proven by clicking an emailed link.
 * Without the second half, anyone could sign up with the owner's address before they do.
 * Mutates the row and keeps the DB column in sync (board queries read it for the Minister rank).
 */
export function syncAdmin(user) {
  const shouldBe = user.email_verified && config.adminEmails.includes(user.email) ? 1 : 0;
  if (user.is_admin !== shouldBe) {
    db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(shouldBe, user.id);
    user.is_admin = shouldBe;
  }
}

/** One-time link that confirms the account's email address (valid 7 days). */
export function issueVerifyToken(userId) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM email_verifications WHERE user_id = ?").run(userId);
  db.prepare("INSERT INTO email_verifications (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, now() + 7 * 86400);
  return token;
}

export function consumeVerifyToken(token) {
  const row = db.prepare("SELECT * FROM email_verifications WHERE token = ? AND expires_at > ?").get(String(token), now());
  if (!row) return null;
  markEmailVerified(row.user_id);
  return row.user_id;
}

export function markEmailVerified(userId) {
  db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(userId);
  db.prepare("DELETE FROM email_verifications WHERE user_id = ?").run(userId);
}

// --- Minimal in-memory rate limiter (per key, sliding window) ---
const hits = new Map();
export function rateLimited(key, max, windowSec) {
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowSec * 1000);
  arr.push(t);
  hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => {
  const t = Date.now();
  for (const [k, arr] of hits) if (!arr.some((x) => t - x < 3600_000)) hits.delete(k);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now());
}, 600_000).unref();
