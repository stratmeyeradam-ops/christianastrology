import { escapeHtml, layout } from "./layout.js";
import { natalChart, PLANET_GLYPH, getReading } from "../content.js";
import { tierOf, joinHref } from "../plans.js";
import { t } from "../i18n.js";

let ZONES;
const zones = () => (ZONES ??= Intl.supportedValuesOf("timeZone"));

export function chartCalculatorView({ user = null, chartData = null, input = {} } = {}) {
  const userTier = tierOf(user);
  const isSaint = userTier >= 3;

  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0;border-bottom:1px solid var(--border-dark);">
      <div class="container text-center" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${t("JPL Keplerian Ephemeris Engine")}</span>
        <h1 style="color:var(--white);margin-bottom:1rem;">${t("Biblical Natal Chart Calculator")}</h1>
        <p style="max-width:650px;margin:0 auto;color:#b9c9de;font-size:1.05rem;">
          ${t("Calculate approximate celestial positions at your birth, with whole-sign houses when birth time and birthplace coordinates are provided.")}
        </p>
      </div>
    </div>

    <section class="section">
      <div class="container" style="max-width:880px;">
        <div class="card" style="padding:clamp(1.25rem, 4vw, 2.5rem);margin-bottom:3rem;background:var(--paper);">
          <h3 style="margin-bottom:1.5rem;text-align:center;">${t("Enter Date of Birth")}</h3>

          <form method="POST" action="/chart" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:1.25rem;">
            <div>
              <label class="form-label">${t("Birth Date")} *</label>
              <input type="date" name="birthDate" min="1800-01-01" max="2050-12-31" required value="${escapeHtml(input.birthDate || '1995-06-21')}" class="form-control" style="background:#fff;">
            </div>

            <div>
              <label class="form-label">${t("Birth Time (local)")}</label>
              <input type="time" name="birthTime" value="${escapeHtml(input.birthTime || '')}" class="form-control" style="background:#fff;">
              <small style="color:var(--muted);font-size:0.75rem;">${t("Leave blank if unknown — noon is used.")}</small>
            </div>

            <div>
              <label class="form-label">${t("Birth Time Zone")}</label>
              <select name="tz" class="form-control tz-select" style="background:#fff;" data-chosen="${escapeHtml(input.tz || '')}">
                ${zones().map(z => `<option value="${z}" ${z === (input.tz || 'America/Chicago') ? 'selected' : ''}>${z.replace(/_/g, ' ')}</option>`).join('')}
              </select>
              <small style="color:var(--muted);font-size:0.75rem;">${t("The zone where you were born — needed to convert your birth time.")}</small>
            </div>

            <div>
              <label class="form-label" for="birth-lat">${t("Birthplace latitude (optional)")}</label>
              <input id="birth-lat" type="number" name="lat" min="-89.9999" max="89.9999" step="any" value="${escapeHtml(input.lat ?? '')}" placeholder="44.0805" class="form-control">
            </div>
            <div>
              <label class="form-label" for="birth-lon">${t("Birthplace longitude (optional)")}</label>
              <input id="birth-lon" type="number" name="lon" min="-180" max="180" step="any" value="${escapeHtml(input.lon ?? '')}" placeholder="-103.2310" class="form-control">
            </div>
            <p style="grid-column:1/-1;font-size:0.85rem;color:var(--muted)">${t("Use negative coordinates for south and west. Houses need both coordinates and a known birth time; otherwise only planetary positions are shown.")}</p>
            <div style="grid-column:1/-1;text-align:center;margin-top:0.5rem;">
              <button type="submit" class="btn btn-primary" style="padding:0.8rem 2.5rem;">${t("Calculate Celestial Chart")} ✦</button>
            </div>
          </form>
        </div>

        ${chartData ? `
          <div class="card" style="padding:2.5rem;">
            <div style="text-align:center;margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:1px solid var(--border);">
              <span class="badge badge-gold" style="margin-bottom:0.5rem;">${t("Calculated Ephemeris")}</span>
              <h2>${t("Your Celestial Placements")}</h2>
              <p style="color:var(--muted);font-size:0.9rem;">
                ${t("Approximate planetary positions. Placements near sign boundaries may be uncertain.")}
              </p>
            </div>

            <!-- Basic Placements (Sun & Moon are open to all) -->
            <h3 style="font-size:1.15rem;margin-bottom:1rem;color:var(--navy);">${t("The Lights (free for everyone)")}</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:1rem;margin-bottom:2.5rem;">
              ${chartData.positions.slice(0, 2).map(p => {
                const reading = getReading(`${p.key}-in-${p.sign.toLowerCase()}`);
                return `
                  <div class="card" style="padding:1.25rem;background:var(--paper);border-color:var(--gold);">
                    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
                      <span style="font-size:2rem;color:var(--gold);line-height:1;">${PLANET_GLYPH[p.key] || '✦'}</span>
                      <div>
                        <strong>${escapeHtml(t(p.name))}</strong>
                        <div style="font-size:0.85rem;color:var(--gold-dim);">${escapeHtml(t(p.sign))} ${p.degree.toFixed(1)}°</div>
                      </div>
                    </div>
                    ${reading ? `
                      <a href="/library/${reading.slug}" class="btn btn-outline btn-sm" style="width:100%;margin-top:0.5rem;">
                        ${t("Read Biblical Reflection")} →
                      </a>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>

            <!-- Deep Chart: All 10 bodies & houses (Gated for Saint members) -->
            <div style="margin-top:2rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">
                <h3 style="font-size:1.15rem;color:var(--navy);">${t("Full 10-Planet Chart")}</h3>
                <span class="badge ${isSaint ? 'badge-gold' : 'badge-navy'}">
                  ${isSaint ? '✓ ' + t('Saint') : '🔒 ' + t('Saint') + ' ($30/' + t('month') + ')'}
                </span>
              </div>

              ${isSaint ? `
                ${chartData.houses ? `
                  <section style="margin-bottom:2rem" aria-label="${t('Whole-sign houses')}">
                    <h3>${t('Whole-sign houses')}</h3>
                    <p>${t('Ascendant')}: ${escapeHtml(t(chartData.ascendant.sign))} ${chartData.ascendant.degree.toFixed(1)}° · ${t('Midheaven')}: ${escapeHtml(t(chartData.midheaven.sign))} ${chartData.midheaven.degree.toFixed(1)}°</p>
                    <div class="grid-3">${chartData.houses.map(h => `<div class="card" style="padding:1rem"><strong>${t('House')} ${h.house}</strong>: ${escapeHtml(t(h.sign))}</div>`).join('')}</div>
                  </section>` : `<p>${t('Add birth time and birthplace coordinates above to calculate your ascendant and houses.')}</p>`}
                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:1rem;">
                  ${chartData.positions.slice(2).map(p => {
                    const reading = getReading(`${p.key}-in-${p.sign.toLowerCase()}`);
                    return `
                      <div class="card" style="padding:1.25rem;">
                        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
                          <span style="font-size:1.8rem;color:var(--gold);line-height:1;">${PLANET_GLYPH[p.key] || '✦'}</span>
                          <div>
                            <strong>${escapeHtml(t(p.name))}</strong>
                            <div style="font-size:0.85rem;color:var(--muted);">${escapeHtml(t(p.sign))} ${p.degree.toFixed(1)}° ${p.house ? ` · ${t('House')} ${p.house}` : ''} ${p.retrograde ? '(' + t('Retrograde') + ')' : ''}</div>
                          </div>
                        </div>
                        ${reading ? `
                          <a href="/library/${reading.slug}" class="btn btn-outline btn-sm" style="width:100%;margin-top:0.5rem;">
                            ${t("View Placement Study")} →
                          </a>
                        ` : ''}
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : `
                <div class="card" style="padding:2.5rem;text-align:center;background:var(--paper);border-color:var(--border);">
                  <span style="font-size:3rem;display:block;margin-bottom:0.5rem;">🔒</span>
                  <h4 style="margin-bottom:0.5rem;">${t("Complete chart analysis is reserved for Saint members")}</h4>
                  <p style="color:var(--muted);max-width:500px;margin:0 auto 1.5rem;font-size:0.9rem;">
                    ${t("Unlock Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune and Pluto, plus the downloadable Birth Chart Prayer Guide (PDF).")}
                  </p>
                  <a href="${joinHref("saint")}" class="btn btn-gold btn-sm">${t("Upgrade to Saint")} ($30/mo)</a>
                </div>
              `}
            </div>
          </div>
        ` : ''}
      </div>
    </section>
  `;

  return layout({
    title: t("Biblical Natal Chart Calculator"),
    description: t("Calculate your biblical natal chart using JPL Keplerian ephemeris elements and whole-sign houses."),
    user,
    currentPath: "/chart",
    body,
  });
}
