import { escapeHtml, layout } from "./layout.js";
import { GUIDES, PLANS, tierOf, joinHref } from "../plans.js";
import { t, fmtDate, fmtMoney } from "../i18n.js";

const tierName = (n) => t(PLANS[n - 1]?.name || "Member");

export function guidesView({ user = null, error = "" } = {}) {
  const tier = tierOf(user);
  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0 3.5rem;border-bottom:1px solid var(--border-dark);">
      <div class="container" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${t("Member Deliverables")}</span>
        <h1 style="color:var(--white);margin-bottom:1rem;">${t("Study Guides & Workbooks")}</h1>
        <p style="max-width:640px;margin:0 auto;color:#b9c9de;font-size:1.05rem;">
          ${t("Printable PDF companions for prayerful study — included with Devoted and Saint memberships.")}
        </p>
      </div>
    </div>
    <section class="section">
      <div class="container" style="max-width:900px;display:grid;gap:1.25rem;">
        ${error ? `<div class="alert alert-error">${escapeHtml(t(error))}</div>` : ""}
        ${GUIDES.map((g) => {
          const open = tier >= g.tier;
          return `
          <div class="card" style="padding:1.75rem;display:flex;justify-content:space-between;align-items:center;gap:1.5rem;flex-wrap:wrap;">
            <div style="flex:1 1 320px;">
              <span class="badge ${open ? "badge-gold" : "badge-navy"}" style="margin-bottom:0.5rem;">${open ? t("Included") : t("{plan} & up", { plan: tierName(g.tier) })}</span>
              <h3 style="margin-bottom:0.35rem;">${escapeHtml(t(g.title))}</h3>
              <p style="color:var(--muted);font-size:0.92rem;">${escapeHtml(t(g.desc))}</p>
            </div>
            ${open
              ? `<a href="/guides/download/${escapeHtml(g.file)}" class="btn btn-gold btn-sm">${t("Download PDF")}</a>`
              : user
                ? `<a href="${joinHref(g.tier)}" class="btn btn-outline btn-sm">${t("Unlock with {plan}", { plan: tierName(g.tier) })}</a>`
                : `<a href="${joinHref(g.tier)}" class="btn btn-outline btn-sm">${t("Join to unlock")}</a>`}
          </div>`;
        }).join("")}
      </div>
    </section>`;
  return layout({ title: t("Study Guides & Workbooks"), description: t("Printable Christian astrology study guides for members."), user, currentPath: "/guides", body });
}

const STATUS = {
  paid: ["Paid — preparing", "warn"], // labels are translated at render time
  submitted: ["Sent to printer", "warn"],
  in_production: ["In production", "warn"],
  shipped: ["Shipped", "ok"],
  delivered: ["Delivered", "ok"],
  canceled: ["Canceled", "bad"],
  refunded: ["Refunded", "bad"],
};

/** "My orders" block for the account page. */
export function ordersSection(orders = []) {
  if (!orders.length) return "";
  return `
    <div class="card" id="orders" style="padding:2.5rem;margin-bottom:2.5rem;">
      <h3 style="margin-bottom:1.5rem;">${t("Your Store Orders")}</h3>
      <div style="display:grid;gap:1rem;">
        ${orders.map((o) => {
          const items = JSON.parse(o.items_json || "[]");
          const tracking = JSON.parse(o.tracking_json || "[]");
          const [label, cls] = STATUS[o.status] || [o.status, ""];
          return `
          <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:1.25rem;background:#fff;">
            <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:0.5rem;">
              <strong>CA-${String(o.id).padStart(5, "0")}</strong>
              <span class="status-pill ${cls}">${escapeHtml(t(label))}</span>
            </div>
            <div style="font-size:0.85rem;color:var(--muted);margin-bottom:0.5rem;">
              ${fmtDate(o.created_at)} · ${fmtMoney(o.total_cents ?? o.subtotal_cents)}
              ${o.discount_cents ? ` · ${t("saved {amount} with membership", { amount: fmtMoney(o.discount_cents) })}` : ""}
            </div>
            <ul style="font-size:0.9rem;padding-left:1.1rem;">
              ${items.map((i) => `<li>${escapeHtml(i.title)} × ${i.qty}</li>`).join("")}
            </ul>
            ${tracking.map((t) => `<div style="margin-top:0.5rem;font-size:0.85rem;">📦 ${escapeHtml(String(t.carrier).toUpperCase())} ${
              /^https:\/\//.test(t.url || "") ? `<a href="${escapeHtml(t.url)}" target="_blank" rel="noopener" style="color:var(--gold-dim);font-weight:600;">${escapeHtml(t.number)}</a>` : escapeHtml(t.number)
            }</div>`).join("")}
          </div>`;
        }).join("")}
      </div>
    </div>`;
}
