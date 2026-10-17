import { escapeHtml, layout } from "./layout.js";
import { signs, signReadings } from "../content.js";
import { tierOf, joinHref } from "../plans.js";
import { t } from "../i18n.js";

export function signsIndexView({ user = null } = {}) {
  const body = `
    <div class="page-head" style="background:var(--navy);color:var(--cream);padding:4rem 0;border-bottom:1px solid var(--border-dark);">
      <div class="container text-center" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${t("Job 38:32 · The Hebrew Mazzaroth")}</span>
        <h1 style="color:var(--white);margin-bottom:1rem;">${t("The Twelve Constellations")}</h1>
        <p style="max-width:640px;margin:0 auto;color:#b9c9de;font-size:1.05rem;">
          ${t("In biblical tradition, the twelve constellations of the Mazzaroth reveal God's celestial redemptive story, linked to the twelve tribes of Israel and Christ's fulfillment.")}
        </p>
      </div>
    </div>

    <section class="section">
      <div class="container">
        <div class="grid-3">
          ${signs().map(s => `
            <div class="sign-card" style="padding:2rem 1.5rem;">
              <span class="sign-glyph">${s.symbol}</span>
              <h3 class="sign-title" style="font-size:1.35rem;">${escapeHtml(s.name)}</h3>
              <div class="sign-hebrew" style="font-size:0.9rem;margin-bottom:0.25rem;">${escapeHtml(s.hebrewName)}</div>
              <div class="sign-tribe" style="font-weight:600;color:var(--ink-light);">${escapeHtml(s.tribe)}</div>
              <div style="font-size:0.75rem;color:var(--gold-dim);margin:0.5rem 0;">${escapeHtml(s.dates)} · ${escapeHtml(s.element)}</div>
              <p class="sign-summary" style="margin-bottom:1.5rem;">${escapeHtml(s.summary)}</p>
              <a href="/signs/${s.slug}" class="btn btn-outline btn-sm">${t("Explore Sign Profile")} →</a>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;

  return layout({
    title: t("The Twelve Signs of the Mazzaroth"),
    description: t("Explore the ancient biblical Hebrew roots and Christological fulfillment of each constellation."),
    user,
    currentPath: "/signs",
    body,
  });
}

export function signDetailView({ sign, user = null } = {}) {
  const readings = signReadings(sign.slug);
  const tier1Readings = readings.filter(r => r.tier === 1);
  const tier2Readings = readings.filter(r => r.tier === 2);
  const userTier = tierOf(user);

  const body = `
    <div style="background:linear-gradient(135deg, var(--navy) 0%, var(--navy-soft) 100%);color:var(--cream);padding:5rem 0 4rem;border-bottom:1px solid var(--gold);">
      <div class="container">
        <div style="display:flex;align-items:center;gap:2rem;flex-wrap:wrap;">
          <div style="font-size:5rem;color:var(--gold);line-height:1;background:rgba(255,255,255,0.05);padding:1rem 1.5rem;border-radius:var(--radius-md);border:1px solid rgba(255,255,255,0.1);">
            ${sign.symbol}
          </div>
          <div>
            <div class="eyebrow" style="color:var(--gold-light);">${escapeHtml(sign.dates)} · ${escapeHtml(sign.element)}</div>
            <h1 style="color:var(--white);margin-bottom:0.5rem;">${escapeHtml(sign.name)}</h1>
            <div style="font-size:1.15rem;color:var(--gold-light);margin-bottom:0.5rem;">
              ${t("Hebrew")}: <strong>${escapeHtml(sign.hebrewName)}</strong>
            </div>
            <div style="font-size:0.95rem;color:#b9c9de;">
              ${t("Biblical Tribe")}: <strong>${escapeHtml(sign.tribe)}</strong> · ${t("Key Scriptures")}: <em>${escapeHtml(sign.scriptures)}</em>
            </div>
          </div>
        </div>
      </div>
    </div>

    <section class="section">
      <div class="container">
        <div class="sidebar-layout">
          <div>
            <h2 style="margin-bottom:1rem;">${t("Spiritual & Theological Theme")}</h2>
            <div style="font-size:1.1rem;font-weight:600;color:var(--gold-dim);margin-bottom:1.5rem;">
              “${escapeHtml(sign.theme)}”
            </div>

            <div style="font-size:1.05rem;line-height:1.8;color:var(--ink-light);margin-bottom:2.5rem;">
              <p style="margin-bottom:1.25rem;">${escapeHtml(sign.deepAnalysis)}</p>
              <p>${escapeHtml(sign.summary)}</p>
            </div>

            <hr style="border:0;border-top:1px solid var(--border);margin:2.5rem 0;">

            <h2 style="margin-bottom:0.5rem;">${t("Planetary Readings in {sign}", { sign: escapeHtml(sign.name) })}</h2>
            <p style="color:var(--muted);font-size:0.95rem;margin-bottom:2rem;">
              ${t("Detailed theological reflections for each heavenly body in this sign.")}
            </p>

            <h3 style="font-size:1.1rem;color:var(--gold-dim);margin-bottom:1rem;">${t("Foundational Readings (Pilgrim)")}</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:1rem;margin-bottom:2.5rem;">
              ${tier1Readings.map(r => `
                <a href="/library/${r.slug}" class="card" style="padding:1.2rem;">
                  <strong style="display:block;font-size:0.95rem;margin-bottom:0.35rem;">${escapeHtml(r.title)}</strong>
                  <span style="font-size:0.8rem;color:var(--muted);">${userTier >= 1 ? t('Unlocked') : '🔒 ' + t('Pilgrim') + '+'}</span>
                </a>
              `).join('')}
            </div>

            <h3 style="font-size:1.1rem;color:var(--gold-dim);margin-bottom:1rem;">${t("House Placements ({n} Readings — Devoted)", { n: tier2Readings.length })}</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(240px, 1fr));gap:1rem;">
              ${tier2Readings.slice(0, 12).map(r => `
                <a href="/library/${r.slug}" class="card" style="padding:1.2rem;">
                  <strong style="display:block;font-size:0.95rem;margin-bottom:0.35rem;">${escapeHtml(r.title)}</strong>
                  <span style="font-size:0.8rem;color:var(--muted);">${userTier >= 2 ? t('Unlocked') : '🔒 ' + t('Devoted') + '+'}</span>
                </a>
              `).join('')}
            </div>
            ${tier2Readings.length > 12 ? `
              <p style="margin-top:1.5rem;font-size:0.9rem;color:var(--muted);">
                ${t("Showing 12 of {n} house placement readings for {sign}.", { n: tier2Readings.length, sign: escapeHtml(sign.name) })} <a href="/library?sign=${sign.slug}" style="color:var(--gold);font-weight:600;">${t("Browse all in library")} →</a>
              </p>
            ` : ''}
          </div>

          <div>
            <div class="card" style="background:var(--paper);border-color:var(--border);padding:2rem;">
              <h3 style="margin-bottom:1rem;">${t("Sign Quick Facts")}</h3>
              <ul style="list-style:none;font-size:0.9rem;line-height:1.8;">
                <li style="margin-bottom:0.75rem;">
                  <strong>${t("Hebrew Name")}:</strong><br>
                  ${escapeHtml(sign.hebrewName)}
                </li>
                <li style="margin-bottom:0.75rem;">
                  <strong>${t("Allotted Tribe")}:</strong><br>
                  ${escapeHtml(sign.tribe)}
                </li>
                <li style="margin-bottom:0.75rem;">
                  <strong>${t("Appointed Season")}:</strong><br>
                  ${escapeHtml(sign.dates)}
                </li>
                <li style="margin-bottom:0.75rem;">
                  <strong>${t("Cosmic Element")}:</strong><br>
                  ${escapeHtml(sign.element)}
                </li>
                <li style="margin-bottom:0.75rem;">
                  <strong>${t("Biblical Grounding")}:</strong><br>
                  ${escapeHtml(sign.scriptures)}
                </li>
              </ul>

              <div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--border);">
                <a href="${joinHref("devoted")}" class="btn btn-primary btn-sm" style="width:100%;">${t("Unlock All Readings")}</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  return layout({
    title: `${sign.name} (${sign.hebrewName})`,
    description: t("Biblical and astronomical study of {sign}, representing the tribe of {tribe}.", { sign: sign.name, tribe: sign.tribe }),
    user,
    currentPath: `/signs/${sign.slug}`,
    body,
  });
}
