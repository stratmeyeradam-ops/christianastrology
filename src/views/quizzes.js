import { escapeHtml, layout } from "./layout.js";
import { quizzes } from "../content.js";
import { tierOf, PLANS, joinHref } from "../plans.js";
import { t } from "../i18n.js";

const planName = (tier) => t(PLANS[tier - 1]?.name || "Member");

export function quizzesIndexView({ user = null } = {}) {
  const userTier = tierOf(user);

  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0;border-bottom:1px solid var(--border-dark);">
      <div class="container text-center" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${t("Contemplative Self-Assessments")}</span>
        <h1 style="color:var(--white);margin-bottom:1rem;">${t("Spiritual Discernment Quizzes")}</h1>
        <p style="max-width:640px;margin:0 auto;color:#b9c9de;font-size:1.05rem;">
          ${t("Quiet your heart and reflect upon your seasons of patience, prayer life, and where your spiritual treasures rest.")}
        </p>
      </div>
    </div>

    <section class="section">
      <div class="container">
        <div class="grid-3">
          ${quizzes().map(q => {
            const isUnlocked = userTier >= q.tier;
            return `
              <div class="card" style="display:flex;flex-direction:column;justify-content:space-between;">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                    <span class="badge ${isUnlocked ? 'badge-gold' : 'badge-navy'}">
                      ${isUnlocked ? '✓ ' + t('Unlocked') : '🔒 ' + t('{plan} required', { plan: planName(q.tier) })}
                    </span>
                    <span style="font-size:0.8rem;color:var(--muted);">${t("{n} Questions", { n: q.questions.length })}</span>
                  </div>
                  <h3 style="margin-bottom:0.75rem;">${escapeHtml(q.title)}</h3>
                  <p style="font-size:0.9rem;color:var(--muted);line-height:1.6;margin-bottom:1.5rem;">
                    ${escapeHtml(q.intro)}
                  </p>
                </div>
                <a href="/quizzes/${q.slug}" class="btn ${isUnlocked ? 'btn-outline' : 'btn-primary'} btn-sm">
                  ${isUnlocked ? t('Take Quiz') + ' →' : t('Unlock with Membership') + ' 🔒'}
                </a>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </section>
  `;

  return layout({
    title: t("Spiritual Discernment Quizzes"),
    description: t("Biblical spiritual quizzes designed to illuminate your prayer language and walk of faith."),
    user,
    currentPath: "/quizzes",
    body,
  });
}

export function quizDetailView({ quiz, user = null, result = null, answers = {} } = {}) {
  const userTier = tierOf(user);
  const isUnlocked = userTier >= quiz.tier;

  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0 3rem;border-bottom:1px solid var(--border-dark);">
      <div class="container text-center" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${t("Included with {plan}", { plan: planName(quiz.tier) })}</span>
        <h1 style="color:var(--white);margin-bottom:1rem;max-width:700px;margin-left:auto;margin-right:auto;">
          ${escapeHtml(quiz.title)}
        </h1>
        <p style="max-width:600px;margin:0 auto;color:#b9c9de;font-size:1.05rem;">
          ${escapeHtml(quiz.intro)}
        </p>
      </div>
    </div>

    <section class="section">
      <div class="container" style="max-width:740px;">
        ${!isUnlocked ? `
          <div class="card" style="padding:3rem 2rem;text-align:center;background:var(--paper);border-color:var(--gold);">
            <span style="font-size:3.5rem;display:block;margin-bottom:1rem;">🔒</span>
            <h2>${t("This quiz is reserved for {plan} members", { plan: planName(quiz.tier) })}</h2>
            <p style="color:var(--muted);max-width:480px;margin:0 auto 1.5rem;font-size:0.95rem;">
              ${t("Unlock full access to our complete interactive quiz and spiritual diagnostic suite with your membership.")}
            </p>
            <a href="${joinHref(quiz.tier)}" class="btn btn-gold">${t("Unlock with {plan}", { plan: planName(quiz.tier) })}</a>
          </div>
        ` : result ? `
          <!-- Quiz Result Display -->
          <div class="card" style="padding:3rem 2.5rem;background:linear-gradient(145deg, #ffffff 0%, #faf6ee 100%);border-color:var(--gold);box-shadow:var(--shadow-md);">
            <div style="text-align:center;margin-bottom:2rem;">
              <span class="badge badge-gold" style="margin-bottom:0.75rem;">${t("Your Discernment Result")}</span>
              <h2 style="color:var(--navy);">${escapeHtml(result.title)}</h2>
            </div>

            <div style="font-family:'Playfair Display', serif;font-size:1.18rem;line-height:1.85;color:var(--ink);margin-bottom:2.5rem;">
              <p>${escapeHtml(result.body)}</p>
            </div>

            <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;padding-top:1.5rem;border-top:1px solid var(--border);">
              <a href="/quizzes/${quiz.slug}" class="btn btn-outline btn-sm">${t("Retake Quiz")}</a>
              <a href="/board" class="btn btn-primary btn-sm">${t("Share on the Message Board")} →</a>
            </div>
          </div>
        ` : `
          <!-- Quiz Questions Form -->
          <form method="POST" action="/quizzes/${quiz.slug}" class="card" style="padding:2.5rem;">
            ${quiz.questions.map((q, qIndex) => `
              <div style="margin-bottom:2.5rem;padding-bottom:2rem;border-bottom:1px solid var(--border);">
                <div style="font-size:0.8rem;font-weight:700;color:var(--gold-dim);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.5rem;">
                  ${t("Question {n} of {total}", { n: qIndex + 1, total: quiz.questions.length })}
                </div>
                <h3 style="font-size:1.15rem;margin-bottom:1.25rem;">${escapeHtml(q.prompt)}</h3>

                <div style="display:flex;flex-direction:column;gap:0.75rem;">
                  ${q.options.map(opt => `
                    <label style="display:flex;align-items:center;gap:0.75rem;padding:0.9rem 1.25rem;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;background:#fff;transition:border-color 0.2s;">
                      <input type="radio" name="q_${qIndex}" value="${opt.key}" required style="accent-color:var(--gold);">
                      <span style="font-size:0.95rem;">${escapeHtml(opt.text)}</span>
                    </label>
                  `).join('')}
                </div>
              </div>
            `).join('')}

            <div style="text-align:center;">
              <button type="submit" class="btn btn-gold" style="padding:0.8rem 2.5rem;">${t("View Discernment Result")} ✦</button>
            </div>
          </form>
        `}
      </div>
    </section>
  `;

  return layout({
    title: quiz.title,
    description: quiz.intro,
    user,
    currentPath: `/quizzes/${quiz.slug}`,
    body,
  });
}
