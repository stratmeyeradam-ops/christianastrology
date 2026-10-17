// Tiny i18n: English is the source language and the dictionary key.
//   t("Sign In")                     → "Iniciar sesión" (es)
//   t("Welcome, {name}", { name })   → interpolates after lookup
// Locale comes from a URL prefix (/es/…, /pt/…), then the `lang` cookie, then Accept-Language.
// It is stored per request in AsyncLocalStorage so views can call t() without threading params.
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, existsSync } from "node:fs";

export const LOCALES = ["en", "es", "pt"];
export const LOCALE_NAMES = { en: "English", es: "Español", pt: "Português" };
// BCP-47 tags for Intl formatting, <html lang>, Stripe Checkout, og:locale.
export const LOCALE_TAGS = { en: "en-US", es: "es", pt: "pt-BR" };
export const STRIPE_LOCALES = { en: "en", es: "es", pt: "pt-BR" };

const load = (f) => {
  const url = new URL(f, import.meta.url);
  return existsSync(url) ? JSON.parse(readFileSync(url, "utf8")) : {};
};
const DICT = { es: load("./i18n/es.json"), pt: load("./i18n/pt.json") };

const als = new AsyncLocalStorage();
export const getLocale = () => als.getStore()?.locale || "en";

/** Run fn with a fixed locale (emails, webhooks, tests). */
export const withLocale = (locale, fn) => als.run({ locale: LOCALES.includes(locale) ? locale : "en" }, fn);

/** True when key is one of our own UI strings (every key exists in the Spanish dictionary). */
export const isKnownKey = (key) => Object.hasOwn(DICT.es, key);

export function t(key, vars) {
  const loc = getLocale();
  let s = (loc !== "en" && DICT[loc]?.[key]) || key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** Path for the same page in another locale ("/store", "es" → "/es/store"). */
export const localePath = (path, locale) => (locale === "en" ? path : `/${locale}${path === "/" ? "" : path}`);
/** Prefix an internal link with the current locale (keeps crawlers on the right language). */
export const href = (path) => localePath(path, getLocale());

export const fmtDate = (unix, opts = { dateStyle: "medium" }) =>
  new Intl.DateTimeFormat(LOCALE_TAGS[getLocale()], opts).format(new Date(unix * 1000));
export const fmtMoney = (cents) =>
  new Intl.NumberFormat(LOCALE_TAGS[getLocale()], { style: "currency", currency: "USD" }).format(cents / 100);

function fromAcceptLanguage(header = "") {
  for (const part of header.split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (LOCALES.includes(code)) return code;
  }
  return "en";
}

function readCookie(req, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || "");
  return m ? decodeURIComponent(m[1]) : null;
}

export function localeMiddleware({ secure }) {
  return (req, res, next) => {
    let locale = null;
    const m = /^\/(en|es|pt)(\/|$|\?)/.exec(req.url);
    if (m) {
      locale = m[1];
      req.url = req.url.slice(3) || "/";
      if (req.url.startsWith("?")) req.url = "/" + req.url;
      // Remember the choice so plain links / redirects stay in this language.
      if (readCookie(req, "lang") !== locale)
        res.cookie("lang", locale, { maxAge: 365 * 86400 * 1000, sameSite: "lax", secure, path: "/" });
    }
    locale ||= LOCALES.includes(readCookie(req, "lang")) ? readCookie(req, "lang") : fromAcceptLanguage(req.headers["accept-language"]);
    res.locals.locale = locale;
    als.run({ locale }, next);
  };
}
