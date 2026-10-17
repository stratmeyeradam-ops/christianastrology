import { config } from "../config.js";
import { rankOf, tierOf, joinHref } from "../plans.js";
import { t, getLocale, LOCALES, LOCALE_NAMES, LOCALE_TAGS, localePath } from "../i18n.js";
import { statSync } from "node:fs";

// Cache-busting: asset URLs change whenever the file changes, so browsers never run stale CSS/JS after a deploy.
const assetVersion = (p) => {
  try {
    return Math.floor(statSync(new URL(`../../public${p}`, import.meta.url)).mtimeMs).toString(36);
  } catch {
    return "1";
  }
};
const CSS_V = () => assetVersion("/css/style.css"); // one stat() per page — cheap, and right in dev too
const JS_V = () => assetVersion("/js/main.js");

export function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Internal page links get the locale prefix (/es/…, /pt/…) so crawlers and shared links keep the language.
// Assets, downloads, APIs and the admin stay unprefixed.
const UNPREFIXED = /^\/(?:css|js|img|favicon|apple-touch|og\.jpg|guides\/download|api|webhook|admin|healthz|sitemap|robots|(?:es|pt|en)(?:\/|$))/; // already carries a language (incl. bare /es, /pt, /en from the language menu)
function prefixLinks(html, loc) {
  if (loc === "en") return html;
  return html.replace(/href="(\/[^"]*)"/g, (m, path) => (UNPREFIXED.test(path) ? m : `href="${localePath(path, loc)}"`));
}

// Pages where ads never show: transactional, private, or where they'd distract from paying.
const NO_ADS = /^\/(account|cart|checkout|admin|login|signup|forgot|reset|verify|store\/thanks|pricing)/;

export function layout({ title = "", description = "", user = null, currentPath = "", body = "", noindex = false } = {}) {
  const loc = getLocale();
  const pub = config.adsensePublisher;
  // Members (and admins) browse ad-free — part of what a membership buys.
  const showAds = Boolean(pub) && tierOf(user) === 0 && !noindex && !NO_ADS.test(currentPath || "/");
  // Views sometimes already end their title with the site name; don't print it twice.
  const bare = String(title).replace(new RegExp(`\\s*[—-]\\s*${config.siteName}\\s*$`), "");
  const pageTitle = bare ? `${bare} — ${config.siteName}` : `${config.siteName} — ${t("Guiding Faith, Aligning Stars")}`;
  const pageDesc = description || t("A reverent gathering place for Christians exploring biblical cosmology, the ancient Mazzaroth, personal discernment, and sacred study.");
  const userRank = user ? t(rankOf(user)) : "";
  const path = currentPath.split("?")[0] || "/";
  const nav = (p, label, match = (x) => x.startsWith(p)) =>
    `<a href="${p}" class="${(p === "/" ? path === "/" : match(path)) ? "active" : ""}">${t(label)}</a>`;

  const html = `<!doctype html>
<html lang="${LOCALE_TAGS[loc]}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(pageDesc)}">
  ${noindex ? `<meta name="robots" content="noindex">` : ""}
  <link rel="canonical" href="${config.appUrl}${localePath(path, loc)}">
  ${LOCALES.map((l) => `<link rel="alternate" hreflang="${l}" href="${config.appUrl}${localePath(path, l)}">`).join("\n  ")}
  <link rel="alternate" hreflang="x-default" href="${config.appUrl}${path}">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(pageDesc)}">
  <meta property="og:image" content="${config.appUrl}/og.jpg">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="${LOCALE_TAGS[loc].replace("-", "_")}">
  <link rel="stylesheet" href="/css/style.css?v=${CSS_V()}">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="theme-color" content="#081225">
  ${config.seo.google ? `<meta name="google-site-verification" content="${escapeHtml(config.seo.google)}">` : ""}
  ${config.seo.bing ? `<meta name="msvalidate.01" content="${escapeHtml(config.seo.bing)}">` : ""}
  ${config.seo.yandex ? `<meta name="yandex-verification" content="${escapeHtml(config.seo.yandex)}">` : ""}
  ${pub ? `<meta name="google-adsense-account" content="ca-${escapeHtml(pub)}">` : ""}
  ${showAds ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${escapeHtml(pub)}" crossorigin="anonymous"></script>` : ""}
</head>
<body data-added="${escapeHtml(t("Added to your cart"))}">
  <a class="skip-link" href="#main">${t("Skip to content")}</a>
  <header class="site-header">
    <div class="container header-inner">
      <a href="/" class="brand">
        <span class="brand-cross">☧</span>
        <span>Christian Astrology</span>
      </a>

      <nav class="site-nav" aria-label="${t("Main")}">
        ${nav("/", "Home")}
        ${nav("/signs", "The 12 Signs")}
        ${nav("/library", "Library")}
        ${nav("/chart", "Natal Chart")}
        ${nav("/quizzes", "Quizzes")}
        ${nav("/board", "Message Board")}
        ${nav("/store", "Store")}
        ${nav("/pricing", "Memberships")}
        <span class="nav-mobile-only">
          ${user ? `<a href="/account">✦ ${escapeHtml(user.display_name)}</a>${user.is_admin ? `<a href="/admin">⚙ Admin</a>` : ""}` : `<a href="/login">${t("Sign In")}</a>`}
        </span>
      </nav>

      <div class="nav-actions">
        <details class="lang-menu">
          <summary aria-label="${t("Language")}">🌐 ${loc.toUpperCase()}</summary>
          <div class="lang-menu-list">
            ${LOCALES.map((l) => `<a href="${localePath(path, l)}" hreflang="${l}" lang="${l}" class="${l === loc ? "active" : ""}" data-noprefix>${LOCALE_NAMES[l]}</a>`).join("")}
          </div>
        </details>
        <a href="/cart" class="btn btn-outline btn-sm" title="${t("View Cart")}">
          🛒 <span class="cart-label">${t("Cart")}</span> <span class="badge badge-gold cart-count-badge" style="display:none;margin-left:4px;padding:2px 6px;"></span>
        </a>
        ${user ? `
          ${user.is_admin ? `<a href="/admin" class="btn btn-outline btn-sm desktop-only" title="Admin">⚙</a>` : ""}
          <a href="/account" class="btn btn-primary btn-sm desktop-only">
            <span>✦</span> <span class="user-name">${escapeHtml(user.display_name)}</span>
            <span class="badge badge-gold rank-badge" style="font-size:0.68rem;padding:2px 6px;margin-left:4px;">${escapeHtml(userRank)}</span>
          </a>
        ` : `
          <a href="/login" class="btn btn-primary btn-sm desktop-only">${t("Sign In")}</a>
        `}
        <button class="nav-toggle" aria-label="${t("Menu")}" aria-expanded="false">☰</button>
      </div>
    </div>
  </header>

  <main id="main">
    ${getLocale() !== 'en' && /^\/(library|pricing|guides)(\/|$)/.test(currentPath) ? `<p class="container" style="padding-top:1rem">${t("The reading library and PDF guides are currently in English. Navigation is available in Spanish and Portuguese.")}</p>` : ''}
    ${body}
  </main>

  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div>
          <div class="footer-brand">☧ Christian Astrology</div>
          <p style="font-size:0.9rem;line-height:1.6;margin-bottom:1.5rem;max-width:320px;">
            ${t("A reverent, scripture-grounded space exploring God's cosmos, personal discernment, and the ancient Hebrew Mazzaroth without fatalism.")}
          </p>
          <div style="font-size:0.8rem;color:#788ca6;">
            ${t("Ordained Universal Life Church Ministry.")}<br>
            “${t("The heavens declare the glory of God.")}” — ${t("Psalm")} 19:1
          </div>
        </div>

        <div class="footer-col">
          <h5>${t("Study & Cosmos")}</h5>
          <ul>
            <li><a href="/signs">${t("The Twelve Signs")}</a></li>
            <li><a href="/library">${t("1,560 Readings")}</a></li>
            <li><a href="/chart">${t("Biblical Natal Chart")}</a></li>
            <li><a href="/articles">${t("Theological Articles")}</a></li>
            <li><a href="/quizzes">${t("Discernment Quizzes")}</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <h5>${t("Fellowship & Goods")}</h5>
          <ul>
            <li><a href="/board">${t("Community Message Board")}</a></li>
            <li><a href="/pricing">${t("Memberships")} ($10 / $20 / $30)</a></li>
            <li><a href="/store">${t("Sanctuary Store")}</a></li>
            <li><a href="/guides">${t("Study Guides & PDFs")}</a></li>
            <li><a href="/account">${t("Member Portal")}</a></li>
          </ul>
        </div>

        <div class="footer-col">
          ${tierOf(user) >= 1 ? `
          <h5>${t("The Sunday Letter")}</h5>
          <p style="font-size:0.85rem;margin-bottom:1rem;color:#cbd6e6;">${t("Your weekly pastoral letter arrives every Lord's Day.")}</p>
          <a href="/letters" class="btn btn-outline-gold btn-sm">${t("Letter archive")} →</a>
          ` : `
          <h5>${t("Free Updates")}</h5>
          <p style="font-size:0.85rem;margin-bottom:0.75rem;color:#cbd6e6;">${t("New articles and site news by email. Occasional, never spam.")}</p>
          <p style="font-size:0.8rem;margin-bottom:1rem;color:#9cb0ca;">${t("The Sunday Letter, our weekly pastoral email, is included with every membership.")} <a href="${joinHref("pilgrim")}" style="color:var(--gold-light);text-decoration:underline;">${t("Join Pilgrim")}</a></p>
          <form action="/newsletter/subscribe" method="POST" style="display:flex;gap:0.5rem;">
            <label for="nl-email" class="hp-field">Email</label>
            <input type="email" id="nl-email" name="email" required placeholder="you@example.com" class="form-control" style="font-size:0.85rem;padding:0.6rem 0.8rem;">
            <button type="submit" class="btn btn-gold btn-sm">${t("Join")}</button>
          </form>`}
        </div>
      </div>

      <div class="footer-bottom">
        <div>© ${new Date().getFullYear()} Christian Astrology. ${t("All rights reserved.")}</div>
        <div class="footer-links">
          <a href="/about">${t("About")}</a>
          <a href="/contact">${t("Contact")}</a>
          <a href="/privacy">${t("Privacy Policy")}</a>
          <a href="/terms">${t("Terms of Service")}</a>
        </div>
      </div>
    </div>
  </footer>

  <script src="/js/main.js?v=${JS_V()}"></script>
</body>
</html>`;
  // Switcher links carry their own locale; strip the marker after prefixing everything else.
  return prefixLinks(html.replace(/(<a href=")(\/(?:es|pt)?[^"]*)("[^>]*data-noprefix)/g, (m, a, p, b) => `${a}${p.startsWith("/es") || p.startsWith("/pt") ? p : `/en${p === "/" ? "" : p}`}${b}`), loc).replace(/ data-noprefix/g, "");
}
