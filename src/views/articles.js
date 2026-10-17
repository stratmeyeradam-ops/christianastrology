import { escapeHtml, layout } from "./layout.js";
import { articles } from "../content.js";
import { t } from "../i18n.js";

export function articlesIndexView({ user = null } = {}) {
  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0 3.5rem;border-bottom:1px solid var(--border-dark);">
      <div class="container text-center" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${t("Pastoral Essays & Biblical Cosmology")}</span>
        <h1 style="color:var(--white);margin-bottom:1rem;">${t("Theological Journal")}</h1>
        <p style="max-width:650px;margin:0 auto;color:#b9c9de;font-size:1.05rem;">
          ${t("Explorations of scripture, faith, and cosmic wonder by our ordained ministry team.")}
        </p>
      </div>
    </div>

    <section class="section">
      <div class="container">
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
                  <h3 style="font-size:1.2rem;margin-bottom:0.5rem;">${escapeHtml(a.title)}</h3>
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
    title: t("Theological Journal"),
    description: t("Read biblical essays exploring the sacred harmony between Christian faith and the study of the heavens."),
    user,
    currentPath: "/articles",
    body,
  });
}

export function articleDetailView({ article, user = null } = {}) {
  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4.5rem 0 3.5rem;border-bottom:1px solid var(--border-dark);">
      <div class="container text-center" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${escapeHtml(article.category)} · ${escapeHtml(article.readTime)}</span>
        <h1 style="color:var(--white);margin-bottom:1rem;max-width:850px;margin-left:auto;margin-right:auto;">
          ${escapeHtml(article.title)}
        </h1>
        <p style="font-size:1.15rem;color:#b9c9de;max-width:680px;margin:0 auto;line-height:1.6;">
          ${escapeHtml(article.dek)}
        </p>
        <div style="font-size:0.85rem;color:var(--gold-light);margin-top:1rem;">
          ${t("By {author}", { author: escapeHtml(article.author) })} · ${escapeHtml(article.date)}
        </div>
      </div>
    </div>

    <section class="section">
      <div class="container" style="max-width:760px;">
        <article class="card" style="padding:clamp(2rem, 5vw, 3.5rem);font-size:1.1rem;line-height:1.85;">
          ${article.content.map(p => `
            <p style="margin-bottom:1.5rem;color:var(--ink);">${escapeHtml(p)}</p>
          `).join('')}

          <div style="margin-top:3rem;padding-top:2rem;border-top:1px solid var(--border);text-align:center;">
            <p style="font-size:0.9rem;color:var(--muted);margin-bottom:1rem;">
              ${t("Have thoughts or biblical insights on this essay? Join our fellowship on the message board.")}
            </p>
            <a href="/board" class="btn btn-outline btn-sm">${t("Join the Conversation on the Board")} →</a>
          </div>
        </article>
      </div>
    </section>
  `;

  return layout({
    title: article.title,
    description: article.dek,
    user,
    currentPath: `/articles/${article.slug}`,
    body,
  });
}
