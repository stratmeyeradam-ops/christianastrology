import { escapeHtml, layout } from "./layout.js";
import { signs, articles, quizzes, todaysSky, verseOfDay, weeklyReading } from "../content.js";
import { PLANS, tierOf, joinHref } from "../plans.js";
import { t } from "../i18n.js";

export function homeView({ user = null } = {}) {
  const verse = verseOfDay();
  const sky = todaysSky();
  const readingWeek = weeklyReading();
  const userTier = tierOf(user);

  const body = `
    <section class="hero">
      <div class="container">
        <div style="max-width: 680px;">
          <div class="eyebrow" style="color:var(--gold-light);">
            <span>✦</span>
            <span>${t("Ordained Universal Life Church Ministry")}</span>
          </div>

          <h1>${t("The Heavens Declare <span>His Glory.</span>")}</h1>

          <p class="lead">
            ${t("Welcome to a luminous, scripture-grounded sanctuary for Christians who see God's hand in the cosmos. We explore the ancient Mazzaroth, personal discernment, and biblical cosmology—welcoming all believers into wonder without superstition.")}
          </p>

          <div class="hero-cta">
            <a href="/pricing" class="btn btn-gold">${t("Explore Memberships")} ($10 / $20 / $30)</a>
            <a href="/signs" class="btn btn-outline-gold">${t("Explore the 12 Signs")} →</a>
          </div>

          <div class="hero-badges">
            <span>${t("Ecumenical & Welcoming")}</span>
            <span>${t("Job 38 & Psalm 19 Biblical Grounding")}</span>
            <span>${t("No Fatalism or Divination")}</span>
          </div>
        </div>
      </div>
    </section>

    <section style="background:var(--paper);border-bottom:1px solid var(--border);padding:1.75rem 0;">
      <div class="container" style="display:flex;align-items:center;justify-content:center;gap:1.5rem;text-align:center;flex-wrap:wrap;">
        <span class="badge badge-gold">${t("Scripture of the Day")}</span>
        <blockquote class="font-editorial" style="font-size:1.15rem;font-style:italic;color:var(--navy);">
          “${escapeHtml(t(verse.text))}”
        </blockquote>
        <cite style="font-size:0.85rem;font-weight:700;color:var(--gold-dim);text-transform:uppercase;letter-spacing:0.1em;">
          — ${escapeHtml(t(verse.ref))}
        </cite>
      </div>
    </section>

    <section class="section" style="padding:4rem 0;">
      <div class="container">
        <div class="section-head" style="margin-bottom:2.5rem;">
          <span class="eyebrow">${t("Cosmic Clockwork")}</span>
          <h2>${t("Today's Sky & Planetary Alignments")}</h2>
          <p>${t("The solar system at this hour, calculated by geocentric Keplerian coordinates.")}</p>
        </div>

        <div class="sky-grid">
          ${sky.map(p => `
            <a href="${p.reading ? `/library/${p.reading.slug}` : '/library'}" class="card" style="padding:1rem;text-align:center;border-color:var(--border);">
              <span style="font-size:1.8rem;color:var(--gold);display:block;margin-bottom:0.25rem;">${p.glyph}</span>
              <strong style="font-size:0.9rem;display:block;">${escapeHtml(t(p.name))}</strong>
              <span style="font-size:0.8rem;color:var(--muted);">${escapeHtml(t(p.sign))}</span>
              <span style="font-size:0.75rem;color:var(--gold-dim);display:block;margin-top:0.25rem;">${p.degree.toFixed(1)}°</span>
            </a>
          `).join('')}
        </div>
      </div>
    </section>

    <section class="section section-paper">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">${t("Ancient Biblical Mazzaroth")}</span>
          <h2>${t("The Twelve Constellations")}</h2>
          <p>${t("Each constellation heralds a chapter in God's redemptive work, from Betulah (Virgo) to Aryeh (Leo).")}</p>
        </div>

        <div class="grid-4">
          ${signs().map(s => `
            <a href="/signs/${s.slug}" class="sign-card">
              <span class="sign-glyph">${s.symbol}</span>
              <h3 class="sign-title">${escapeHtml(s.name)}</h3>
              <div class="sign-hebrew">${escapeHtml(s.hebrewName)}</div>
              <div class="sign-tribe">${escapeHtml(s.tribe)}</div>
              <p class="sign-summary">${escapeHtml(s.summary)}</p>
            </a>
          `).join('')}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="feature-panel">
          <div class="feature-split">
            <div>
              <span class="badge badge-gold" style="margin-bottom:1rem;">${t("Reading of the Week")}</span>
              <h2 style="color:var(--white);margin-bottom:1rem;">${escapeHtml(readingWeek.title)}</h2>
              <p style="font-size:1.05rem;color:#cad6e7;line-height:1.7;margin-bottom:1.5rem;">
                ${escapeHtml(readingWeek.excerpt)}
              </p>
              <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
                <a href="/library/${readingWeek.slug}" class="btn btn-gold">
                  ${t("Read Pastoral Reflection")} ${userTier >= 2 ? '→' : `🔒 (${t("Devoted")}+)`}
                </a>
                <span style="font-size:0.85rem;color:#9cb0ca;">
                  ${t("Fresh reflection drawn weekly from the 1,560 house library.")}
                </span>
              </div>
            </div>

            <div style="text-align:center;background:rgba(255,255,255,0.05);padding:2rem;border-radius:var(--radius-md);border:1px solid rgba(255,255,255,0.1);">
              <span style="font-size:4rem;color:var(--gold);display:block;margin-bottom:1rem;">✦</span>
              <h4 style="color:var(--gold-light);margin-bottom:0.5rem;">${t("The Fellowship Board")}</h4>
              <p style="font-size:0.88rem;color:#b9c8de;margin-bottom:1.25rem;">
                ${t("Devoted and Saint members gather to discuss weekly transits, share prayer requests, and study chart placements.")}
              </p>
              <a href="/board" class="btn btn-outline-gold btn-sm">${t("Visit Message Board")}</a>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section section-paper">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">${t("Self-Discovery & Discernment")}</span>
          <h2>${t("Faith & Temperament Quizzes")}</h2>
          <p>${t("Reflect prayerfully upon your spiritual language, season of patience, and heart's treasure.")}</p>
        </div>

        <div class="grid-3">
          ${quizzes().map(q => `
            <div class="card">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <span class="badge badge-gold">${q.tier ? t(PLANS[q.tier - 1].name) : t("Free")}</span>
                <span style="font-size:0.8rem;color:var(--muted);">${t("{n} Questions", { n: q.questions.length })}</span>
              </div>
              <h3 style="margin-bottom:0.75rem;">${escapeHtml(q.title)}</h3>
              <p style="font-size:0.9rem;color:var(--muted);margin-bottom:1.5rem;flex-grow:1;">
                ${escapeHtml(q.intro)}
              </p>
              <a href="/quizzes/${q.slug}" class="btn btn-outline btn-sm">${t("Take Quiz")} →</a>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">${t("Fellowship & Discernment")}</span>
          <h2>${t("Choose Your Spiritual Walk")}</h2>
          <p>${t("Three intentional tiers built to support your daily prayer life, astrological study, and Christian fellowship.")}</p>
        </div>

        <div class="pricing-grid">
          ${PLANS.map(p => `
            <div class="pricing-card ${p.featured ? 'featured' : ''}">
              ${p.featured ? `<div class="pricing-ribbon">${t("Most Cherished")}</div>` : ''}
              <h3>${escapeHtml(t(p.name))}</h3>
              <div class="pricing-price">$${p.price}<span>/${t("month")}</span></div>
              ${p.introPrice ? `<div class="pricing-promo">${t("Special intro: ${price} your first month", { price: p.introPrice })}</div>` : ''}
              <p class="pricing-blurb">${escapeHtml(t(p.blurb))}</p>
              <ul class="pricing-points">
                ${p.points.map(pt => `<li>${escapeHtml(t(pt))}</li>`).join('')}
              </ul>
              <a href="${joinHref(p.id)}" class="btn ${p.featured ? 'btn-gold' : 'btn-primary'}">
                ${t("Choose {plan}", { plan: escapeHtml(t(p.name)) })}
              </a>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <section class="section section-paper">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">${t("Theological Journal")}</span>
          <h2>${t("Essays on Biblical Faith & the Stars")}</h2>
          <p>${t("Thoughtful scholarship and pastoral reflections from our ordained ministry team.")}</p>
        </div>

        <div class="grid-2">
          ${articles().map(a => `
            <article class="card article-card">
              <div class="article-card-img">
                <img src="${a.image}" alt="" loading="lazy">
              </div>
              <div class="article-card-body">
                <div>
                  <span style="font-size:0.75rem;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:0.1em;display:block;margin-bottom:0.5rem;">
                    ${escapeHtml(a.category)} · ${escapeHtml(a.readTime)}
                  </span>
                  <h3 style="font-size:1.15rem;margin-bottom:0.5rem;">${escapeHtml(a.title)}</h3>
                  <p style="font-size:0.85rem;color:var(--muted);line-height:1.5;">${escapeHtml(a.dek)}</p>
                </div>
                <a href="/articles/${a.slug}" class="btn btn-outline btn-sm" style="margin-top:1.25rem;align-self:flex-start;">
                  ${t("Read Article")} →
                </a>
              </div>
            </article>
          `).join('')}
        </div>
      </div>
    </section>
  `;

  return layout({
    title: t("Faith & the Stars in Sacred Harmony"),
    description: t("A reverent, scripture-grounded sanctuary for Christians exploring biblical cosmology, the ancient Mazzaroth, personal discernment, and sacred study."),
    user,
    currentPath: "/",
    body,
  });
}
