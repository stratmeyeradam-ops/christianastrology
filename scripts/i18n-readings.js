// Translation memory for the 1,560 readings.
//
//   node scripts/i18n-readings.js export          → data/i18n/readings-source.json (every unique English sentence)
//   node scripts/i18n-readings.js status          → how much of the library each language covers
//
// To translate: produce data/i18n/<lang>/sentences.json as { "<English sentence>": "<translation>", ... }
// (any tool or translator can work from readings-source.json, in chunks). Untranslated sentences
// simply stay in English, so partial files are safe to deploy. Restart the app to pick up changes.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { READINGS, mapSentences } from "../src/content.js";

const root = new URL("../data/i18n/", import.meta.url);
const counts = new Map();
for (const r of READINGS) for (const f of [r.title, r.excerpt, r.body]) mapSentences(f, (s) => void counts.set(s, (counts.get(s) || 0) + 1));

const cmd = process.argv[2] || "status";
if (cmd === "export") {
  // Most-used sentences first, so translating the top of the list covers the most text.
  const list = [...counts].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  writeFileSync(new URL("readings-source.json", root), JSON.stringify(list, null, 1));
  console.log(`Wrote ${list.length} unique sentences to data/i18n/readings-source.json`);
} else {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  for (const lang of ["es", "pt"]) {
    const f = new URL(`${lang}/sentences.json`, root);
    const tm = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
    let covered = 0;
    for (const [s, n] of counts) if (tm[s]) covered += n;
    console.log(`${lang}: ${Object.keys(tm).length}/${counts.size} unique sentences · ${((covered / total) * 100).toFixed(1)}% of library text`);
  }
}
