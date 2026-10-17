import { readFileSync } from "node:fs";
import { natalChart, SIGNS } from "./astro.js";
import { getLocale, LOCALES } from "./i18n.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));

export const SIGNS_DATA = load("signs.json");
export const ARTICLES = load("articles.json");
export const QUIZZES = load("quizzes.json");
export const READINGS = load("readings.json");

// --- Localized content --------------------------------------------------------
// data/i18n/<lang>/{signs,articles,quizzes}.json: { "<slug>": { ...fields to override } }
// data/i18n/<lang>/sentences.json: { "<English sentence>": "<translation>" } — a translation
//   memory for the 1,560 readings, which share a lot of sentences. Untranslated sentences stay English.
const loadOpt = (f) => {
  try {
    return load(f);
  } catch {
    return {};
  }
};
const OVERLAY = Object.fromEntries(
  LOCALES.filter((l) => l !== "en").map((l) => [
    l,
    {
      signs: loadOpt(`i18n/${l}/signs.json`),
      articles: loadOpt(`i18n/${l}/articles.json`),
      quizzes: loadOpt(`i18n/${l}/quizzes.json`),
      sentences: loadOpt(`i18n/${l}/sentences.json`),
    },
  ]),
);

const overlay = (list, kind, loc) => {
  const o = OVERLAY[loc]?.[kind] || {};
  return list.map((item) => (o[item.slug] ? { ...item, ...o[item.slug], lang: loc } : item));
};

/**
 * Call fn(sentence) for every sentence of text outside HTML tags; fn's return value replaces it.
 * Shared by translateProse and scripts/i18n-readings.js so both split text identically.
 */
export function mapSentences(text, fn) {
  return String(text).replace(/[^<>]+(?=<|$)/g, (chunk) =>
    chunk.replace(/[^.!?]+[.!?]*["”’)]*\s*/g, (sent) => {
      const core = sent.trim();
      if (!core) return sent;
      const out = fn(core);
      return out ? sent.replace(core, out) : sent;
    }),
  );
}

/** Translate prose sentence-by-sentence using the translation memory (keeps HTML tags intact). */
export function translateProse(text, loc = getLocale()) {
  const tm = OVERLAY[loc]?.sentences;
  if (!tm || !text) return text;
  return mapSentences(text, (s) => tm[s]);
}

const memo = new Map();
const cached = (key, build) => {
  if (!memo.has(key)) memo.set(key, build());
  return memo.get(key);
};

export const signs = () => cached(`signs:${getLocale()}`, () => overlay(SIGNS_DATA, "signs", getLocale()));
export const articles = () => cached(`articles:${getLocale()}`, () => overlay(ARTICLES, "articles", getLocale()));
export const quizzes = () => cached(`quizzes:${getLocale()}`, () => overlay(QUIZZES, "quizzes", getLocale()));
export const readings = () =>
  cached(`readings:${getLocale()}`, () => {
    const loc = getLocale();
    if (loc === "en" || !Object.keys(OVERLAY[loc]?.sentences || {}).length) return READINGS;
    return READINGS.map((r) => ({
      ...r,
      title: translateProse(r.title, loc),
      excerpt: translateProse(r.excerpt, loc),
      body: translateProse(r.body, loc),
      translated: true,
    }));
  });

const bySlug = (list) => new Map(list.map((x) => [x.slug, x]));
export const getReading = (slug) => cached(`readingMap:${getLocale()}`, () => bySlug(readings())).get(slug);
export const getSign = (slug) => signs().find((s) => s.slug === slug);
export const getArticle = (slug) => articles().find((a) => a.slug === slug);
export const getQuiz = (slug) => quizzes().find((q) => q.slug === slug);

export const PLANETS = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
export const PLANET_GLYPH = { sun: "☉", moon: "☽", mercury: "☿", venus: "♀", mars: "♂", jupiter: "♃", saturn: "♄", uranus: "♅", neptune: "♆", pluto: "♇" };
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Parse "venus-in-leo" / "venus-in-leo-house-7". */
export function parseReadingSlug(slug) {
  const m = /^([a-z]+)-in-([a-z]+)(?:-house-(\d+))?$/.exec(slug);
  return m ? { planet: m[1], sign: m[2], house: m[3] ? Number(m[3]) : null } : null;
}

export const signReadings = (sign) => readings().filter((r) => r.sign === sign);

// Rotating daily verses for Today's Sky.
const VERSES = [
  ["The heavens declare the glory of God; and the firmament sheweth his handywork.", "Psalm 19:1"],
  ["He telleth the number of the stars; he calleth them all by their names.", "Psalm 147:4"],
  ["Canst thou bring forth Mazzaroth in his season? or canst thou guide Arcturus with his sons?", "Job 38:32"],
  ["Let them be for signs, and for seasons, and for days, and years.", "Genesis 1:14"],
  ["To every thing there is a season, and a time to every purpose under the heaven.", "Ecclesiastes 3:1"],
  ["Lift up your eyes on high, and behold who hath created these things.", "Isaiah 40:26"],
  ["When I consider thy heavens, the work of thy fingers, the moon and the stars, which thou hast ordained.", "Psalm 8:3"],
  ["Every good gift and every perfect gift is from above, and cometh down from the Father of lights.", "James 1:17"],
  ["I am the root and the offspring of David, and the bright and morning star.", "Revelation 22:16"],
  ["We have seen his star in the east, and are come to worship him.", "Matthew 2:2"],
  ["Canst thou bind the sweet influences of Pleiades, or loose the bands of Orion?", "Job 38:31"],
  ["The sun shall not smite thee by day, nor the moon by night.", "Psalm 121:6"],
  ["They that be wise shall shine as the brightness of the firmament; and they that turn many to righteousness as the stars for ever and ever.", "Daniel 12:3"],
  ["He appointed the moon for seasons: the sun knoweth his going down.", "Psalm 104:19"],
];

export function verseOfDay(date = new Date()) {
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
  const [text, ref] = VERSES[day % VERSES.length];
  return { text, ref };
}

/** Current planetary positions (noon UTC today) with linked readings. */
export function todaysSky(date = new Date()) {
  const chart = natalChart({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hourUT: date.getUTCHours() + date.getUTCMinutes() / 60,
  });
  return chart.positions.map((p) => ({
    ...p,
    glyph: PLANET_GLYPH[p.key],
    reading: getReading(`${p.key}-in-${p.sign.toLowerCase()}`),
  }));
}

/** Reading of the Week — deterministic by ISO week, from the house library. */
export function weeklyReading(date = new Date()) {
  const tier2 = readings().filter((r) => r.tier === 2);
  const week = Math.floor((date.getTime() / 86400000 + 3) / 7); // weeks since epoch, Monday-aligned
  return tier2[(week * 7919) % tier2.length];
}

export { natalChart, SIGNS };
