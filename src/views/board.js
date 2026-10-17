import { escapeHtml, layout } from "./layout.js";
import { tierOf, rankOf, joinHref } from "../plans.js";
import { t, fmtDate } from "../i18n.js";

// Category names/descriptions live in the DB in English; translate on display.
const catName = (c) => t(c.name);
const catDesc = (c) => t(c.description);

export function boardCategoriesView({ categories = [], user = null } = {}) {
  const userTier = tierOf(user);
  const canPost = userTier >= 2;
  const canRead = userTier >= 1;

  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0 3.5rem;border-bottom:1px solid var(--border-dark);">
      <div class="container">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1.5rem;">
          <div>
            <span class="eyebrow" style="color:var(--gold-light);">${t("Devoted & Saint Fellowship")}</span>
            <h1 style="color:var(--white);margin-bottom:0.5rem;">${t("Community Message Board")}</h1>
            <p style="color:#b9c9de;font-size:1.05rem;">
              ${t("A reverent gathering space to share reflections, post prayer requests, and study cosmic signs in communion.")}
            </p>
          </div>

          <div>
            ${canPost ? `
              <span class="badge badge-gold" style="font-size:0.85rem;padding:0.4rem 1rem;">
                ✦ ${escapeHtml(t(rankOf(user)))}
              </span>
            ` : canRead ? `
              <span class="badge badge-navy" style="font-size:0.85rem;padding:0.4rem 1rem;">
                🔒 ${t("Read-only (Devoted+ required to post)")}
              </span>
            ` : `
              <span class="badge badge-navy" style="font-size:0.85rem;padding:0.4rem 1rem;">🔒 ${t("Members only")}</span>
            `}
          </div>
        </div>
      </div>
    </div>

    <section class="section">
      <div class="container">
        ${!canRead ? membersOnlyNote() : !canPost ? `
          <div class="alert alert-info" style="margin-bottom:2rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
            <div>
              <strong>${t("Posting is reserved for Devoted ($20/mo) and Saint ($30/mo) members.")}</strong>
              ${t("Join the conversation to share your chart, prayer requests, and reflections.")}
            </div>
            <a href="${joinHref("devoted")}" class="btn btn-gold btn-sm">${t("Become Devoted")}</a>
          </div>
        ` : ''}

        <div style="display:grid;gap:1.5rem;">
          ${categories.map(c => `
            <div class="card" style="padding:1.75rem;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
                <div>
                  <h3 style="font-size:1.3rem;margin-bottom:0.35rem;">
                    <a href="/board/${c.slug}" style="color:var(--navy);">${escapeHtml(catName(c))}</a>
                  </h3>
                  <p style="color:var(--muted);font-size:0.92rem;line-height:1.5;margin-bottom:1rem;">
                    ${escapeHtml(catDesc(c))}
                  </p>
                  <span style="font-size:0.8rem;color:var(--gold-dim);font-weight:600;">
                    ${t("{a} discussions · {b} posts", { a: c.thread_count || 0, b: c.post_count || 0 })}
                  </span>
                </div>

                <a href="/board/${c.slug}" class="btn btn-outline btn-sm">${t("View Topics")} →</a>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;

  return layout({
    title: t("Community Message Board"),
    description: t("Christian fellowship message board discussing biblical cosmology, prayer requests, and astrology."),
    user,
    currentPath: "/board",
    body,
  });
}

/** The board is a paid deliverable: Pilgrim reads, Devoted and Saint post. */
function membersOnlyNote() {
  return `
    <div class="alert alert-info" style="margin-bottom:2rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
      <div>
        <strong>${t("The message board is for members.")}</strong>
        ${t("Pilgrim ($10/mo) to read every discussion. Devoted ($20/mo) to post, reply, and share prayer requests.")}
      </div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <a href="${joinHref("pilgrim")}" class="btn btn-outline btn-sm">${t("Join Pilgrim")}</a>
        <a href="${joinHref("devoted")}" class="btn btn-gold btn-sm">${t("Become Devoted")}</a>
      </div>
    </div>`;
}

export function boardLockedView({ user = null, title = "" } = {}) {
  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0 3rem;border-bottom:1px solid var(--border-dark);">
      <div class="container" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${t("Community Message Board")}</span>
        <h1 style="color:var(--white);">${title ? escapeHtml(title) : t("Members only")}</h1>
      </div>
    </div>
    <section class="section">
      <div class="container" style="max-width:760px;">
        <div class="card" style="text-align:center;padding:3rem 2rem;">
          <span style="font-size:3rem;display:block;margin-bottom:1rem;">🔒</span>
          <h2 style="margin-bottom:0.75rem;">${t("The message board is for members.")}</h2>
          <p style="color:var(--muted);max-width:520px;margin:0 auto 1.75rem;">${t("Pilgrim ($10/mo) to read every discussion. Devoted ($20/mo) to post, reply, and share prayer requests.")}</p>
          <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;">
            <a href="${joinHref("pilgrim")}" class="btn btn-outline">${t("Join Pilgrim")}</a>
            <a href="${joinHref("devoted")}" class="btn btn-gold">${t("Become Devoted")}</a>
          </div>
          ${user ? "" : `<p style="margin-top:1.5rem;font-size:0.9rem;"><a href="/login" style="color:var(--gold-dim);font-weight:600;">${t("Already a member? Sign In")}</a></p>`}
        </div>
      </div>
    </section>`;
  return layout({ title: t("Community Message Board"), user, currentPath: "/board", noindex: true, body });
}

export function boardCategoryDetailView({ category, threads = [], user = null } = {}) {
  const userTier = tierOf(user);
  const canPost = userTier >= 2;

  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:3.5rem 0;border-bottom:1px solid var(--border-dark);">
      <div class="container">
        <div style="font-size:0.85rem;color:var(--gold-light);margin-bottom:0.5rem;">
          <a href="/board">← ${t("All categories")}</a>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
          <div>
            <h1 style="color:var(--white);font-size:2.2rem;margin-bottom:0.35rem;">${escapeHtml(catName(category))}</h1>
            <p style="color:#b9c9de;font-size:0.95rem;">${escapeHtml(catDesc(category))}</p>
          </div>

          ${canPost ? `
            <a href="/board/${category.slug}/new" class="btn btn-gold btn-sm">+ ${t("New Thread")}</a>
          ` : `
            <a href="${joinHref("devoted")}" class="btn btn-outline-gold btn-sm">${t("Unlock Posting")} ($20/mo)</a>
          `}
        </div>
      </div>
    </div>

    <section class="section">
      <div class="container">
        ${threads.length === 0 ? `
          <div class="card" style="text-align:center;padding:4rem 2rem;">
            <span style="font-size:3rem;display:block;margin-bottom:1rem;color:var(--gold);">✦</span>
            <h3>${t("No discussions in this category yet.")}</h3>
            <p style="color:var(--muted);margin-bottom:1.5rem;font-size:0.95rem;">${t("Be the first member of the fellowship to begin a topic.")}</p>
            ${canPost ? `<a href="/board/${category.slug}/new" class="btn btn-gold btn-sm">+ ${t("Start a Discussion")}</a>` : ''}
          </div>
        ` : `
          <div style="display:grid;gap:0.75rem;">
            ${threads.map(th => `
              <div class="thread-row">
                <div class="thread-info">
                  <h4>
                    ${th.pinned ? '<span style="color:var(--gold);margin-right:4px;">📌</span>' : ''}${th.locked ? '<span style="margin-right:4px;" title="${t("Locked")}">🔒</span>' : ''}
                    <a href="/board/thread/${th.id}">${escapeHtml(th.title)}</a>
                  </h4>
                  <div class="thread-meta">
                    <span>${t("Started by {name}", { name: `<strong>${escapeHtml(th.author_name)}</strong>` })} (${escapeHtml(t(th.author_rank || "Member"))})</span>
                    <span>·</span>
                    <span>${t("Last activity {date}", { date: fmtDate(th.last_post_at) })}</span>
                  </div>
                </div>

                <div style="text-align:right;">
                  <span class="badge badge-gold" style="font-size:0.75rem;">${t("{n} replies", { n: th.reply_count || 0 })}</span>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </section>
  `;

  return layout({
    title: `${catName(category)} — ${t("Message Board")}`,
    description: catDesc(category),
    user,
    currentPath: `/board/${category.slug}`,
    body,
  });
}

export function boardThreadView({ thread, posts = [], category, categories = [], user = null } = {}) {
  const userTier = tierOf(user);
  const isAdmin = Boolean(user?.is_admin);
  const canPost = userTier >= 2 && (!thread.locked || isAdmin);

  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:3.5rem 0;border-bottom:1px solid var(--border-dark);">
      <div class="container">
        <div style="font-size:0.85rem;color:var(--gold-light);margin-bottom:0.5rem;">
          <a href="/board/${category.slug}">← ${escapeHtml(catName(category))}</a>
        </div>
        <h1 style="color:var(--white);font-size:2.2rem;margin-bottom:0.5rem;">${escapeHtml(thread.title)}</h1>
        <div style="color:#b9c9de;font-size:0.85rem;">
          ${thread.pinned ? '📌 ' + t('Pinned') + ' · ' : ''}${thread.locked ? '🔒 ' + t('Locked') + ' · ' : ''}<strong>${escapeHtml(catName(category))}</strong> · ${t('{n} messages', { n: posts.length })}
        </div>
        ${isAdmin ? `
          <div class="mod-bar">
            <form method="POST" action="/board/thread/${thread.id}/mod"><input type="hidden" name="action" value="pin"><button class="btn btn-outline btn-sm">${thread.pinned ? t('Unpin') : t('Pin')}</button></form>
            <form method="POST" action="/board/thread/${thread.id}/mod"><input type="hidden" name="action" value="lock"><button class="btn btn-outline btn-sm">${thread.locked ? t('Unlock') : t('Lock')}</button></form>
            <form method="POST" action="/board/thread/${thread.id}/mod" style="display:flex;gap:0.35rem;">
              <input type="hidden" name="action" value="move">
              <select name="category" class="form-control">${categories.map(c => `<option value="${c.slug}" ${c.id === category.id ? 'selected' : ''}>${escapeHtml(catName(c))}</option>`).join('')}</select>
              <button class="btn btn-outline btn-sm">${t("Move")}</button>
            </form>
          </div>` : ''}
      </div>
    </div>

    <section class="section">
      <div class="container" style="max-width:850px;">
        <div style="display:grid;gap:1.5rem;margin-bottom:3rem;">
          ${posts.map((p, idx) => `
            <div class="card" id="post-${p.id}" style="padding:1.75rem;border-color:${idx === 0 ? 'var(--gold)' : 'var(--border)'};scroll-margin-top:100px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;padding-bottom:0.75rem;border-bottom:1px solid var(--border);">
                <div>
                  <strong>${escapeHtml(p.author_name)}</strong>
                  <span class="badge badge-gold" style="margin-left:0.5rem;font-size:0.7rem;">${escapeHtml(t(p.author_rank || 'Member'))}</span>
                  ${idx === 0 && category.slug === 'prayer' && p.author_tier >= 3 ? `<span class="status-pill warn" style="margin-left:0.35rem;">🙏 ${t("Priority prayer")}</span>` : ''}
                </div>
                <span style="font-size:0.78rem;color:var(--muted);">${fmtDate(p.created_at, { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>

              <div style="font-size:0.98rem;line-height:1.75;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;">${escapeHtml(p.body)}</div>
              ${p.edited_at ? `<div style="font-size:0.75rem;color:var(--muted);margin-top:0.5rem;">${t("edited")}</div>` : ''}
              ${user && (user.id === p.user_id || isAdmin) ? `
                <div class="post-tools">
                  <details>
                    <summary>${t("Edit")}</summary>
                    <form method="POST" action="/board/post/${p.id}/edit">
                      <textarea name="body" class="form-control" maxlength="10000" required>${escapeHtml(p.body)}</textarea>
                      <button class="btn btn-gold btn-sm">${t("Save")}</button>
                    </form>
                  </details>
                  <form method="POST" action="/board/post/${p.id}/delete" onsubmit="return confirm('${idx === 0 ? t('Delete this whole thread?') : t('Delete this post?')}')">
                    <button type="submit">${idx === 0 ? t('Delete thread') : t('Delete')}</button>
                  </form>
                </div>` : ''}
            </div>
          `).join('')}
        </div>

        ${thread.locked && !isAdmin ? `<div class="locked-note">🔒 ${t("This discussion has been locked by a minister. No new replies.")}</div>` : canPost ? `
          <div class="card" style="padding:2rem;">
            <h3 style="margin-bottom:1rem;">${t("Post a Reply")}</h3>
            <form method="POST" action="/board/thread/${thread.id}/reply">
              <div class="form-group">
                <textarea name="body" required maxlength="10000" class="form-control" placeholder="${t("Share your prayer, biblical thought, or reflection with kindness and discernment...")}" style="min-height:120px;"></textarea>
              </div>
              <button type="submit" class="btn btn-gold btn-sm">${t("Post Reply")}</button>
            </form>
          </div>
        ` : `
          <div class="alert alert-info text-center" style="text-align:center;padding:2rem;">
            <h4 style="margin-bottom:0.5rem;">${t("Join Devoted or Saint to Reply")}</h4>
            <p style="font-size:0.9rem;margin-bottom:1rem;">${t("Only Devoted and Saint members can post and reply.")}</p>
            <a href="${joinHref("devoted")}" class="btn btn-gold btn-sm">${t("Become Devoted")}</a>
          </div>
        `}
      </div>
    </section>
  `;

  return layout({
    title: `${thread.title} — ${t("Message Board")}`,
    description: catName(category),
    user,
    currentPath: `/board/thread/${thread.id}`,
    body,
  });
}

export function boardNewThreadView({ category, user = null, error = "" } = {}) {
  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:3rem 0;border-bottom:1px solid var(--border-dark);">
      <div class="container">
        <div style="font-size:0.85rem;color:var(--gold-light);margin-bottom:0.5rem;">
          <a href="/board/${category.slug}">← ${t("Cancel")}</a>
        </div>
        <h1 style="color:var(--white);font-size:2rem;">${t("Start a New Discussion")}</h1>
      </div>
    </div>

    <section class="section">
      <div class="container" style="max-width:700px;">
        <div class="card" style="padding:2.5rem;">
          ${error ? `<div class="alert alert-error">${escapeHtml(t(error))}</div>` : ''}

          <form method="POST" action="/board/${category.slug}/new">
            <div class="form-group">
              <label class="form-label">${t("Title")} *</label>
              <input type="text" name="title" required maxlength="140" placeholder="${t("e.g. Question on Psalm 19 & Mars Transit this week")}" class="form-control">
            </div>

            <div class="form-group">
              <label class="form-label">${t("Your message")} *</label>
              <textarea name="body" required class="form-control" placeholder="${t("Write with grace and reverence...")}" style="min-height:160px;"></textarea>
            </div>

            <button type="submit" class="btn btn-gold" style="width:100%;">${t("Post New Thread")} ✦</button>
          </form>
        </div>
      </div>
    </section>
  `;

  return layout({
    title: `${t("New Thread")} — ${catName(category)}`,
    user,
    currentPath: `/board/${category.slug}/new`,
    body,
  });
}
