// Mark an account's email as confirmed from the server shell (e.g. the owner's, before email is set up).
//   npm run confirm-email -- owner@example.com
import { db } from "../src/db.js";

const email = String(process.argv[2] || "").trim().toLowerCase();
const u = email && db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (!u) {
  console.error(email ? `No account for ${email} — sign up on the site first.` : "Usage: npm run confirm-email -- you@example.com");
  process.exit(1);
}
db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(u.id);
console.log(`Confirmed ${email}. If it's listed in ADMIN_EMAILS, it has admin access on its next page load.`);
