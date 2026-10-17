import { escapeHtml, layout } from "./layout.js";
import { readings, signs, cap } from "../content.js";
import { tierOf, joinHref } from "../plans.js";
import { t, getLocale, LOCALE_TAGS } from "../i18n.js";

const signLabel = (slug) => t(cap(slug));

export function libraryIndexView({ user = null, selectedSign = "", query = "", page = 1 } = {}) {
  const userTier = tierOf(user);
  let filtered = readings();

  if (selectedSign) {
    filtered = filtered.filter(r => r.sign.toLowerCase() === selectedSign.toLowerCase());
  }

  if (query) {
    const q = query.toLowerCase();
    filtered = filtered.filter(r => r.title.toLowerCase().includes(q) || r.excerpt.toLowerCase().includes(q));
  }

  const perPage = 30;
  const totalPages = Math.ceil(filtered.length / perPage) || 1;
  const p = Math.max(1, Math.min(totalPages, Number(page) || 1));
  const slice = filtered.slice((p - 1) * perPage, p * perPage);

  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0;border-bottom:1px solid var(--border-dark);">
      <div class="container text-center" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${t("1,560 Sacred Text Records")}</span>
        <h1 style="color:var(--white);margin-bottom:1rem;">${t("Biblical Astrology Reading Library")}</h1>
        <p style="max-width:650px;margin:0 auto;color:#b9c9de;font-size:1.05rem;">
          ${t("Comprehensive library exploring every celestial placement through the lens of Scripture and divine grace.")}
        </p>
      </div>
    </div>

    <section class="section">
      <div class="container">
        <!-- Filter Bar -->
        <div class="card" style="margin-bottom:2.5rem;padding:1.5rem;background:var(--paper);">
          <form method="GET" action="/library" style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center;">
            <div style="flex:1;min-width:200px;">
              <input type="text" name="q" value="${escapeHtml(query)}" placeholder="${t("Search placements (e.g. Venus in 7th House, Mars in Taurus)...")}" aria-label="${t("Search")}" class="form-control" style="background:#fff;">
            </div>

            <div style="min-width:180px;">
              <select name="sign" class="form-control" style="background:#fff;">
                <option value="">${t("All 12 Signs")}</option>
                ${signs().map(s => `
                  <option value="${s.slug}" ${selectedSign === s.slug ? 'selected' : ''}>${s.symbol} ${escapeHtml(s.name)}</option>
                `).join('')}
              </select>
            </div>

            <button type="submit" class="btn btn-primary btn-sm">${t("Filter Library")}</button>
            ${(query || selectedSign) ? `<a href="/library" class="btn btn-outline btn-sm">${t("Reset")}</a>` : ''}
          </form>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1.5rem;">
          <div style="font-size:0.9rem;color:var(--muted);">
            ${t("Showing {a} of {b} readings (Page {p} of {n})", { a: slice.length, b: filtered.length, p, n: totalPages })}
          </div>
          <div>
            ${userTier === 0 ? `
              <span class="badge badge-gold">🔒 ${t("Free preview mode")} — <a href="${joinHref("devoted")}" style="text-decoration:underline;">${t("Subscribe to unlock")}</a></span>
            ` : userTier === 1 ? `
              <span class="badge badge-gold">✦ ${t("Pilgrim: 120 foundational readings unlocked")}</span>
            ` : `
              <span class="badge badge-gold">✦ ${t("All 1,560 readings unlocked")}</span>
            `}
          </div>
        </div>

        <!-- Readings Grid -->
        <div class="grid-3">
          ${slice.map(r => {
            const isUnlocked = userTier >= r.tier;
            return `
              <div class="card" style="display:flex;flex-direction:column;justify-content:space-between;">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
                    <span class="badge ${isUnlocked ? 'badge-gold' : 'badge-navy'}" style="font-size:0.7rem;">
                      ${isUnlocked ? '✓ ' + t('Unlocked') : r.tier === 1 ? '🔒 ' + t('Pilgrim') + ' ($10)' : '🔒 ' + t('Devoted') + ' ($20)'}
                    </span>
                    <span style="font-size:0.75rem;text-transform:uppercase;font-weight:700;color:var(--gold-dim);">
                      ${escapeHtml(signLabel(r.sign))}
                    </span>
                  </div>

                  <h3 style="font-size:1.15rem;margin-bottom:0.75rem;line-height:1.3;">
                    ${escapeHtml(r.title)}
                  </h3>

                  <p style="font-size:0.85rem;color:var(--muted);line-height:1.6;margin-bottom:1.5rem;">
                    ${escapeHtml(r.excerpt)}
                  </p>
                </div>

                <a href="/library/${r.slug}" class="btn ${isUnlocked ? 'btn-outline' : 'btn-primary'} btn-sm">
                  ${isUnlocked ? t('Read Full Study') + ' →' : t('Unlock Reading') + ' 🔒'}
                </a>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Pagination -->
        ${totalPages > 1 ? `
          <div style="display:flex;justify-content:center;gap:0.5rem;flex-wrap:wrap;margin-top:3rem;">
            ${p > 1 ? `<a href="/library?page=${p - 1}&sign=${encodeURIComponent(selectedSign)}&q=${encodeURIComponent(query)}" class="btn btn-outline btn-sm">← ${t("Previous")}</a>` : ''}
            <span style="display:inline-flex;align-items:center;padding:0 1rem;font-size:0.85rem;color:var(--muted);">${t("Page {p} of {n}", { p, n: totalPages })}</span>
            ${p < totalPages ? `<a href="/library?page=${p + 1}&sign=${encodeURIComponent(selectedSign)}&q=${encodeURIComponent(query)}" class="btn btn-outline btn-sm">${t("Next")} →</a>` : ''}
          </div>
        ` : ''}
      </div>
    </section>
  `;

  return layout({
    title: t("Biblical Reading Library"),
    description: t("Browse 1,560 biblically grounded astrological readings across all 12 signs and houses."),
    user,
    currentPath: "/library",
    body,
  });
}

export function readingDetailView({ reading, user = null } = {}) {
  const userTier = tierOf(user);
  const isUnlocked = userTier >= reading.tier;

  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4.5rem 0 3.5rem;border-bottom:1px solid var(--border-dark);">
      <div class="container text-center" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${escapeHtml(signLabel(reading.sign).toUpperCase())}</span>
        <h1 style="color:var(--white);margin-bottom:1rem;max-width:850px;margin-left:auto;margin-right:auto;">
          ${escapeHtml(reading.title)}
        </h1>
        <p style="font-size:1.1rem;color:#b9c9de;max-width:680px;margin:0 auto;line-height:1.6;">
          ${escapeHtml(reading.excerpt)}
        </p>
      </div>
    </div>

    <section class="section">
      <div class="container" style="max-width:760px;">
        ${isUnlocked ? `
          <article class="card" style="padding:clamp(2rem, 5vw, 3.5rem);font-size:1.12rem;line-height:1.85;color:var(--ink);">
            <div style="margin-bottom:2rem;padding-bottom:1rem;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;">
              <span class="badge badge-gold">${t("Full Text Unlocked")}</span>
              <a href="/library?sign=${encodeURIComponent(reading.sign)}" style="font-size:0.85rem;color:var(--gold-dim);font-weight:600;">
                ${t("More {sign} readings", { sign: escapeHtml(signLabel(reading.sign)) })} →
              </a>
            </div>

            ${getLocale() !== "en" && !reading.translated ? `<p class="alert alert-info" style="font-size:0.88rem;margin-bottom:1.5rem;">${t("This reading is currently available in English only.")}</p>` : ""}
            <div class="reading-body" lang="${reading.translated || getLocale() === "en" ? LOCALE_TAGS[getLocale()] : "en"}" style="font-family:'Playfair Display', serif;color:var(--ink);font-size:1.15rem;">
              ${reading.body}
            </div>

            <div style="margin-top:3rem;padding-top:2rem;border-top:1px solid var(--border);text-align:center;">
              <p style="font-size:0.9rem;color:var(--muted);margin-bottom:1rem;">
                ${t("May this reflection bring peace, clarity, and discernment to your daily walk with the Lord.")}
              </p>
              <a href="/board" class="btn btn-outline btn-sm">${t("Discuss this placement on the Message Board")} →</a>
            </div>
          </article>
        ` : `
          <!-- Paywall Gating Card -->
          <div class="card" style="padding:3rem 2rem;text-align:center;background:linear-gradient(135deg, #ffffff 0%, #faf6ee 100%);border-color:var(--gold);box-shadow:var(--shadow-md);">
            <span style="font-size:3.5rem;color:var(--gold);line-height:1;display:block;margin-bottom:1rem;">🔒</span>
            <span class="eyebrow">${t("Membership Deliverable")}</span>
            <h2 style="margin-bottom:1rem;">${t("This reading is reserved for {plan} members", { plan: t(reading.tier === 1 ? "Pilgrim" : "Devoted") })}</h2>
            <p style="color:var(--muted);max-width:520px;margin:0 auto 2rem;font-size:1rem;line-height:1.6;">
              ${reading.tier === 1
                ? t("Join Pilgrim ($10/mo) to unlock all 120 foundational planet-in-sign readings, the Sunday Letter, and daily reflections.")
                : t("Join Devoted ($20/mo — $15 first month) for full access to all 1,560 house placement readings, the Community Message Board, and PDF study guides.")}
            </p>

            <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
              <a href="${joinHref(reading.tier)}" class="btn btn-gold">${t("Unlock with {plan}", { plan: t(reading.tier === 1 ? "Pilgrim" : "Devoted") })}</a>
              ${!user ? `<a href="/login?next=/library/${reading.slug}" class="btn btn-outline">${t("Already a member? Sign In")}</a>` : ''}
            </div>
          </div>
        `}
      </div>
    </section>
  `;

  return layout({
    title: reading.title,
    description: reading.excerpt,
    user,
    currentPath: `/library/${reading.slug}`,
    body,
  });
}
