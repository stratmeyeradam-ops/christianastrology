import { escapeHtml, layout } from "./layout.js";
import { PLANS, tierOf, planById, GUIDES, rankOf, storeDiscountOf, joinHref, PAYMENT_LINKS } from "../plans.js";
import { t, fmtDate } from "../i18n.js";

const LIVE = new Set(["active", "trialing", "past_due"]);

// Comparison rows: [feature, pilgrim, devoted, saint]. "✓" cells render green.
const ROWS = [
  ["The Sunday Letter (weekly email)", "✓", "✓", "✓"],
  ["Discernment quizzes", "✓", "✓", "✓"],
  ["Biblical reading library", "120 foundations", "✓ All 1,560", "✓ All 1,560"],
  ["Community Message Board", "Read only", "✓ Post & reply", "✓ Elder standing"],
  ["PDF study guides", "—", "✓ 2 guides", "✓ All 4 guides"],
  ["Full 10-planet natal chart", "—", "—", "✓"],
  ["Priority prayer requests", "—", "—", "✓"],
  ["Store discount", "10% off", "20% off", "30% off"],
];

export function pricingView({ user = null, error = "", canceled = false, next = "" } = {}) {
  const join = (id) => (!user ? joinHref(id) : `/checkout/subscribe/${id}${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  const userTier = tierOf(user);
  const subscribed = Boolean(user?.stripe_subscription_id && LIVE.has(user.plan_status));

  const cta = (p) => {
    if (userTier === p.tier && user?.plan === p.id)
      return `<button disabled class="btn btn-outline" style="opacity:0.7;cursor:default;">✓ ${t("Your current plan")}</button>`;
    if (!user) return `<div style="display:grid;gap:0.5rem;"><a href="/checkout/subscribe/${p.id}" class="btn ${p.featured ? "btn-gold" : "btn-primary"}">${t("Join as {plan}", { plan: escapeHtml(t(p.name)) })} — $${p.price}/mo</a><a href="${PAYMENT_LINKS[p.id]}" class="btn btn-outline btn-sm" style="font-size:0.8rem;">Direct Stripe Payment Link ($${p.price}/mo) →</a></div>`;
    const label = subscribed
      ? p.tier > userTier ? t("Upgrade to {plan}", { plan: escapeHtml(t(p.name)) }) : t("Switch to {plan}", { plan: escapeHtml(t(p.name)) })
      : t("Join as {plan}", { plan: escapeHtml(t(p.name)) });
    return `<a href="${join(p.id)}" class="btn ${p.featured ? "btn-gold" : "btn-primary"}">${label}</a>`;
  };

  const cell = (v, featured) =>
    `<td style="padding:1rem;text-align:center;${featured ? "background:rgba(197,155,72,0.05);" : ""}${v.startsWith("✓") ? "color:#27814e;font-weight:600;" : v === "—" ? "color:var(--muted);" : ""}">${v === "✓" ? "✓" : escapeHtml(t(v))}</td>`;

  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4.5rem 0 3.5rem;border-bottom:1px solid var(--border-dark);">
      <div class="container" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${t("Scripture-Rooted Spiritual Formation")}</span>
        <h1 style="color:var(--white);margin-bottom:1rem;">${t("Memberships")}</h1>
        <p style="max-width:680px;margin:0 auto;color:#b9c9de;font-size:1.1rem;line-height:1.6;">
          ${t("Reverent, biblically grounded resources to support your prayer life, study, and Christian fellowship. Billed monthly through Stripe. Cancel anytime.")}
        </p>
      </div>
    </div>

    <section class="section">
      <div class="container">
        ${error ? `<div class="alert alert-error" style="margin-bottom:2rem;">${escapeHtml(error)}</div>` : ""}
        ${canceled ? `<div class="alert alert-info" style="margin-bottom:2rem;">${t("Checkout was canceled — you have not been charged.")}</div>` : ""}
        <div class="pricing-grid">
          ${PLANS.map((p) => `
            <div class="pricing-card ${p.featured ? "featured" : ""}" id="plan-${p.id}">
              ${p.featured ? `<div class="pricing-ribbon">${t("Most Cherished")}</div>` : ""}
              <h3>${escapeHtml(t(p.name))}</h3>
              <div class="pricing-price">$${p.price}<span>/${t("month")}</span></div>
              ${p.introPrice && !subscribed ? `<div class="pricing-promo">${t("Special intro: ${price} your first month", { price: p.introPrice })}</div>` : ""}
              <p class="pricing-blurb">${escapeHtml(t(p.blurb))}</p>
              <ul class="pricing-points">
                ${p.points.map((pt) => `<li>${escapeHtml(t(pt))}</li>`).join("")}
              </ul>
              ${cta(p)}
            </div>
          `).join("")}
        </div>
        ${subscribed ? `<p style="text-align:center;margin-top:1.5rem;color:var(--muted);font-size:0.9rem;">${t("Plan changes are prorated automatically by Stripe.")}</p>` : ""}

        <div style="margin-top:5rem;">
          <h2 style="text-align:center;margin-bottom:2.5rem;">${t("Compare memberships")}</h2>
          <div class="card" style="padding:0;overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.95rem;text-align:left;min-width:560px;">
              <thead>
                <tr style="background:var(--paper);border-bottom:1px solid var(--border);">
                  <th style="padding:1.25rem 1.5rem;">${t("Included")}</th>
                  ${PLANS.map((p) => `<th style="padding:1.25rem 1rem;text-align:center;${p.featured ? "background:rgba(197,155,72,0.1);" : ""}">${escapeHtml(t(p.name))}<br><span style="font-weight:400;color:var(--muted);">$${p.price}/${t("month")}</span></th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${ROWS.map(([feature, ...vals]) => `
                  <tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:1rem 1.5rem;">${escapeHtml(t(feature))}</td>
                    ${vals.map((v, i) => cell(v, PLANS[i].featured)).join("")}
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  `;

  return layout({
    title: t("Memberships"),
    description: t("Compare our three membership tiers: Pilgrim ($10), Devoted ($20), and Saint ($30)."),
    user,
    currentPath: "/pricing",
    body,
  });
}

export function accountView({ user, error = "", message = "", ordersHtml = "" } = {}) {
  const userTier = tierOf(user);
  const currentPlan = tierOf(user) ? planById(user.plan) : null;
  const discount = storeDiscountOf(user);
  const statusClass = { active: "ok", trialing: "ok", comped: "ok", past_due: "warn" }[user.plan_status] || "bad";

  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:3.5rem 0;border-bottom:1px solid var(--border-dark);">
      <div class="container">
        <span class="eyebrow" style="color:var(--gold-light);">${t("Member Portal")}</span>
        <h1 style="color:var(--white);">${t("Welcome, {name}", { name: escapeHtml(user.display_name) })}</h1>
      </div>
    </div>

    <section class="section">
      <div class="container" style="max-width:850px;">
        ${error ? `<div class="alert alert-error">${escapeHtml(t(error))}</div>` : ""}
        ${message ? `<div class="alert alert-success">${escapeHtml(t(message))}</div>` : ""}
        ${!user.email_verified ? `<div class="alert alert-info" style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;">
          <span>${t("Please confirm your email address — we sent you a link.")}</span>
          <form method="POST" action="/account/verify-email"><button class="btn btn-outline btn-sm">${t("Resend link")}</button></form></div>` : ""}
        ${user.plan_status === "past_due" ? `<div class="alert alert-error">${t("Your last payment didn't go through. Update your card in billing to keep your membership.")}</div>` : ""}

        <div class="card" style="padding:clamp(1.5rem, 4vw, 2.5rem);margin-bottom:2.5rem;background:var(--paper);border-color:var(--gold);">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1.5rem;">
            <div>
              <span class="eyebrow">${t("Your Membership")}</span>
              <h2 style="margin-bottom:0.5rem;">${currentPlan ? escapeHtml(t(currentPlan.name)) : t("Free account")}</h2>
              <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-top:0.5rem;">
                <span class="badge badge-gold">${t("Rank")}: ${escapeHtml(t(rankOf(user)))}</span>
                ${user.plan_status ? `<span class="status-pill ${statusClass}">${escapeHtml(t(user.plan_status))}</span>` : ""}
                ${discount ? `<span class="status-pill ok">${t("{n}% off in the store", { n: discount })}</span>` : ""}
              </div>
              ${user.current_period_end && currentPlan && user.plan_status !== "comped" ? `<p style="font-size:0.85rem;color:var(--muted);margin-top:0.75rem;">${user.cancel_at_period_end ? t("Canceled — access ends on {date}", { date: fmtDate(user.current_period_end) }) : t("Renews on {date}", { date: fmtDate(user.current_period_end) })}</p>` : ""}
            </div>

            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
              ${user.stripe_customer_id ? `
                <form method="POST" action="/billing/portal">
                  <button type="submit" class="btn btn-outline btn-sm">${t("Manage billing")} ↗</button>
                </form>` : ""}
              <a href="/pricing" class="btn btn-gold btn-sm">${currentPlan ? t("Change plan") : t("Become a member")}</a>
            </div>
          </div>
        </div>

        <div class="card" id="guides" style="padding:clamp(1.5rem, 4vw, 2.5rem);margin-bottom:2.5rem;">
          <h3 style="margin-bottom:1.5rem;">${t("Your Study Guides")}</h3>
          <div style="display:grid;gap:1rem;">
            ${GUIDES.map((g) => {
              const unlocked = userTier >= g.tier;
              return `
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;padding:1.25rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:#fff;gap:1rem;">
                  <div style="flex:1 1 260px;">
                    <strong>${escapeHtml(t(g.title))}</strong>
                    <p style="font-size:0.85rem;color:var(--muted);margin-top:0.25rem;">${escapeHtml(t(g.desc))}</p>
                  </div>
                  ${unlocked
                    ? `<a href="/guides/download/${g.file}" class="btn btn-gold btn-sm">${t("Download PDF")}</a>`
                    : `<span class="badge badge-navy">🔒 ${escapeHtml(t(PLANS[g.tier - 1].name))}</span>`}
                </div>`;
            }).join("")}
          </div>
        </div>

        ${ordersHtml}

        <div class="card" style="padding:clamp(1.5rem, 4vw, 2.5rem);margin-bottom:2.5rem;">
          <h3 style="margin-bottom:1.5rem;">${t("Profile & Security")}</h3>
          <div class="grid-2" style="gap:2rem;">
            <form method="POST" action="/account/profile">
              <div class="form-group">
                <label class="form-label">${t("Display name on the board")}</label>
                <input type="text" name="displayName" maxlength="60" required value="${escapeHtml(user.display_name)}" class="form-control">
              </div>
              <p style="font-size:0.8rem;color:var(--muted);margin-bottom:1rem;">${t("Email")}: ${escapeHtml(user.email)}</p>
              <button class="btn btn-outline btn-sm">${t("Save")}</button>
            </form>
            <form method="POST" action="/account/password">
              <div class="form-group">
                <label class="form-label">${t("Current password")}</label>
                <input type="password" name="current" required autocomplete="current-password" class="form-control">
              </div>
              <div class="form-group">
                <label class="form-label">${t("New password (min. 8 characters)")}</label>
                <input type="password" name="next" required minlength="8" autocomplete="new-password" class="form-control">
              </div>
              <button class="btn btn-outline btn-sm">${t("Change password")}</button>
            </form>
          </div>
        </div>

        <div class="card" id="notifications" style="padding:clamp(1.5rem, 4vw, 2.5rem);margin-bottom:2.5rem;">
          <h3 style="margin-bottom:1rem;">${t("Email notifications")}</h3>
          <form method="POST" action="/account/notifications" style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
            <label style="display:flex;gap:0.6rem;align-items:center;cursor:pointer;">
              <input type="checkbox" name="notify_replies" value="1" ${user.notify_replies ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--gold);">
              <span>${t("Email me when someone replies to a discussion I'm part of")}</span>
            </label>
            <button class="btn btn-outline btn-sm">${t("Save")}</button>
          </form>
        </div>

        <div style="text-align:right;">
          <form method="POST" action="/logout">
            <button type="submit" class="btn btn-outline btn-sm" style="color:#9b1c1c;border-color:#f8b4b4;">${t("Sign out")}</button>
          </form>
        </div>
      </div>
    </section>
  `;

  return layout({ title: t("Your Account"), user, currentPath: "/account", body, noindex: true });
}
