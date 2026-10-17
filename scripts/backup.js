// Consistent online backup of the SQLite database (safe while the site is running).
//   npm run backup   → data/backups/app-YYYY-MM-DD.db, keeps the newest 14
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const dbPath = resolve(process.env.DATABASE_PATH || "./data/app.db");
const dir = join(dirname(dbPath), "backups");
mkdirSync(dir, { recursive: true });
const out = join(dir, `app-${new Date().toISOString().slice(0, 10)}.db`);
rmSync(out, { force: true });
new DatabaseSync(dbPath).exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
const old = readdirSync(dir).filter((f) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -14);
for (const f of old) rmSync(join(dir, f));
console.log(`backup → ${out}`);
