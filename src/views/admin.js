import { escapeHtml, layout } from "./layout.js";
import { PLANS, rankOf } from "../plans.js";

const date = (t) => (t ? new Date(t * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—");
const money = (c) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);
const ref = (id) => `CA-${String(id).padStart(5, "0")}`;

function shell({ user, title, active, flash = "", body }) {
  const tab = (href, label) =>
    `<a href="${href}" class="btn btn-sm ${active === href ? "btn-primary" : "btn-outline"}">${label}</a>`;
  return layout({
    title: `Admin · ${title}`,
    user,
    currentPath: active,
    body: `
    <section class="section" style="padding-top:2.5rem;">
      <div class="container">
        <span class="eyebrow">Admin</span>
        <h1 style="font-size:2rem;margin-bottom:1.25rem;">${escapeHtml(title)}</h1>
        <nav class="admin-nav">
          ${tab("/admin", "Overview")}${tab("/admin/users", "Members")}${tab("/admin/orders", "Store orders")}${tab("/admin/letters", "Sunday Letter")}
          <a href="/board" class="btn btn-sm btn-outline">Message board ↗</a>
        </nav>
        ${flash ? `<div class="alert alert-info" style="word-break:break-all;">${escapeHtml(flash)}</div>` : ""}
        ${body}
      </div>
    </section>`,
  });
}

export function dashboardView({ user, stats, flash, stripe, printify }) {
  const members = Object.fromEntries(stats.members.map((m) => [m.plan, m.c]));
  const orders = Object.fromEntries(stats.orders.map((o) => [o.status, o.c]));
  const mrr = PLANS.reduce((sum, p) => sum + (members[p.id] || 0) * p.price, 0);
  const stat = (n, label) => `<div class="admin-stat"><b>${n}</b><span>${label}</span></div>`;
  const btn = (action, label, note = "") =>
    `<form method="POST" action="/admin/integrations" style="display:inline-block;margin:0 0.5rem 0.5rem 0;">
       <input type="hidden" name="action" value="${action}"><button class="btn btn-outline btn-sm" ${note ? `title="${escapeHtml(note)}"` : ""}>${label}</button></form>`;
  return shell({
    user,
    title: "Overview",
    active: "/admin",
    flash,
    body: `
      <div class="admin-stats">
        ${stat(stats.users, "Accounts")}
        ${PLANS.map((p) => stat(members[p.id] || 0, `${p.name} members`)).join("")}
        ${stat(`$${mrr}`, "Est. monthly (list)")}
        ${stat(stats.pastDue, "Past due")}
        ${stat(stats.threads, "Board threads")}
        ${stat(stats.posts, "Board posts")}
        ${stat(stats.newsletter, `Newsletter · <a href="/admin/newsletter.csv" style="text-decoration:underline;">CSV</a>`)}
        ${stat((orders.paid || 0) + (orders.submitted || 0) + (orders.in_production || 0), "Open orders")}
        ${stat(stats.orderErrors, stats.orderErrors ? `<a href="/admin/orders" style="color:#9b1c1c;text-decoration:underline;">Orders failing</a>` : "Orders failing")}
      </div>

      <div class="card" style="padding:1.75rem;margin-bottom:1.5rem;">
        <h3 style="margin-bottom:0.75rem;">Stripe ${stripe ? '<span class="status-pill ok">connected</span>' : '<span class="status-pill bad">not configured</span>'}</h3>
        <p style="color:var(--muted);font-size:0.9rem;margin-bottom:1rem;">Membership products/prices are created automatically on first checkout. Use this to create them now and confirm the key works.</p>
        ${stripe ? btn("stripe-prices", "Create / verify membership prices") : "<p>Set <code>STRIPE_SECRET_KEY</code> and <code>STRIPE_WEBHOOK_SECRET</code> in <code>.env</code>.</p>"}
      </div>

      <div class="card" style="padding:1.75rem;">
        <h3 style="margin-bottom:0.75rem;">Printify ${printify ? '<span class="status-pill ok">connected</span>' : '<span class="status-pill bad">not configured — showing preview catalog</span>'}</h3>
        <p style="color:var(--muted);font-size:0.9rem;margin-bottom:1rem;">
          Run <strong>Register webhooks</strong> once after the site is live on its real domain. After that, clicking “Publish” in Printify
          puts the product on this store automatically, and shipping/tracking updates flow back to orders.
        </p>
        ${printify
          ? btn("printify-webhooks", "Register webhooks") + btn("printify-publish", "Confirm products stuck in “Publishing”") + btn("printify-refresh", "Refresh store catalog")
          : "<p>Set <code>PRINTIFY_API_TOKEN</code> and <code>PRINTIFY_SHOP_ID</code> in <code>.env</code>.</p>"}
      </div>`,
  });
}

export function usersView({ user, users, q, flash }) {
  return shell({
    user,
    title: "Members",
    active: "/admin/users",
    flash,
    body: `
      <form method="GET" action="/admin/users" style="display:flex;gap:0.5rem;margin-bottom:1.25rem;max-width:480px;">
        <input class="form-control" name="q" value="${escapeHtml(q)}" placeholder="Search email or name">
        <button class="btn btn-primary btn-sm">Search</button>
      </form>
      <div class="table-wrap"><table class="admin-table">
        <thead><tr><th>Member</th><th>Plan</th><th>Joined</th><th>Actions</th></tr></thead>
        <tbody>
        ${users.map((u) => `
          <tr>
            <td><strong>${escapeHtml(u.display_name)}</strong>${u.is_admin ? ' <span class="status-pill ok">admin</span>' : ""}${u.banned ? ' <span class="status-pill bad">banned</span>' : ""}<br>
              <span style="color:var(--muted);">${escapeHtml(u.email)}</span></td>
            <td>${u.plan ? `${escapeHtml(u.plan)} <span class="status-pill ${u.plan_status === "active" || u.plan_status === "comped" ? "ok" : "warn"}">${escapeHtml(u.plan_status || "")}</span>` : "Free"}<br>
              <span style="color:var(--muted);">${escapeHtml(rankOf(u))}</span>
              ${u.stripe_customer_id ? `<br><a href="https://dashboard.stripe.com/customers/${escapeHtml(u.stripe_customer_id)}" target="_blank" rel="noopener" style="text-decoration:underline;font-size:0.78rem;">Stripe ↗</a>` : ""}</td>
            <td>${date(u.created_at)}</td>
            <td>
              <form method="POST" action="/admin/users/${u.id}">
                <input type="hidden" name="action" value="comp">
                <select name="plan"><option value="">— no comp —</option>${PLANS.map((p) => `<option value="${p.id}" ${u.plan === p.id && u.plan_status === "comped" ? "selected" : ""}>${p.name} (free)</option>`).join("")}</select>
                <button class="btn btn-outline btn-sm">Set</button>
              </form>
              <form method="POST" action="/admin/users/${u.id}"><input type="hidden" name="action" value="reset"><button class="btn btn-outline btn-sm">Reset link</button></form>
              ${u.is_admin ? "" : `<form method="POST" action="/admin/users/${u.id}" onsubmit="return confirm('${u.banned ? "Unban" : "Ban"} this member?')"><input type="hidden" name="action" value="ban"><button class="btn btn-outline btn-sm" style="color:#9b1c1c;">${u.banned ? "Unban" : "Ban"}</button></form>`}
            </td>
          </tr>`).join("")}
        </tbody>
      </table></div>`,
  });
}

export function ordersView({ user, orders, flash, autoSend }) {
  const pill = (o) => {
    const cls = { shipped: "ok", delivered: "ok", canceled: "bad", refunded: "bad", abandoned: "bad", pending: "", paid: o.printify_error ? "bad" : "warn" }[o.status] ?? "warn";
    return `<span class="status-pill ${cls}">${escapeHtml(o.status)}</span>`;
  };
  const act = (o, action, label) =>
    `<form method="POST" action="/admin/orders/${o.id}"><input type="hidden" name="action" value="${action}"><button class="btn btn-outline btn-sm">${label}</button></form>`;
  return shell({
    user,
    title: "Store orders",
    active: "/admin/orders",
    flash,
    body: `
      <p style="color:var(--muted);font-size:0.9rem;margin-bottom:1rem;">
        ${autoSend
          ? "Auto-send is <strong>on</strong>: paid orders go straight to production in Printify."
          : "Auto-send is <strong>off</strong>: paid orders wait in Printify “On hold” until you click <em>Send to production</em> (here or in Printify). Set <code>PRINTIFY_AUTO_SEND=true</code> to skip this step."}
      </p>
      <div class="table-wrap"><table class="admin-table">
        <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
        ${orders.map((o) => {
          const items = JSON.parse(o.items_json || "[]");
          const ship = JSON.parse(o.shipping_json || "{}");
          const tracking = JSON.parse(o.tracking_json || "[]");
          return `
          <tr>
            <td><strong>${ref(o.id)}</strong><br><span style="color:var(--muted);">${date(o.created_at)}</span></td>
            <td>${escapeHtml(ship.name || "")}<br><span style="color:var(--muted);">${escapeHtml(o.email || o.user_email || "")}</span></td>
            <td>${items.map((i) => `${escapeHtml(i.title)} × ${i.qty}`).join("<br>")}</td>
            <td>${money(o.total_cents ?? o.subtotal_cents)}${o.discount_cents ? `<br><span style="color:var(--muted);">−${money(o.discount_cents)} member</span>` : ""}</td>
            <td>${pill(o)}${o.printify_status ? `<br><span style="color:var(--muted);">Printify: ${escapeHtml(o.printify_status)}</span>` : ""}
              ${o.printify_error && !o.printify_order_id ? `<br><span style="color:#9b1c1c;">${escapeHtml(o.printify_error.slice(0, 200))}</span>` : ""}
              ${tracking.map((t) => `<br>📦 ${escapeHtml(t.carrier)} ${escapeHtml(t.number)}`).join("")}</td>
            <td>
              ${o.status === "paid" && !o.printify_order_id ? act(o, "retry", "Retry Printify") : ""}
              ${o.printify_order_id && o.status === "submitted" ? act(o, "produce", "Send to production") : ""}
              ${o.printify_order_id ? act(o, "refresh", "Refresh status") : ""}
            </td>
          </tr>`;
        }).join("") || `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted);">No orders yet.</td></tr>`}
        </tbody>
      </table></div>`,
  });
}

export function lettersAdminView({ user, flash, letters, counts }) {
  return shell({
    user,
    title: "Sunday Letter",
    active: "/admin/letters",
    flash,
    body: `
      <form method="POST" action="/admin/letters" class="card" style="padding:1.75rem;margin-bottom:2rem;">
        <div class="form-group">
          <label class="form-label">Subject</label>
          <input class="form-control" name="subject" required maxlength="200" placeholder="The Sunday Letter — Week of …">
        </div>
        <div class="form-group">
          <label class="form-label">Letter (plain text; blank line = new paragraph)</label>
          <textarea class="form-control" name="body" required style="min-height:320px;"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Send to</label>
          <select class="form-control" name="audience" style="max-width:420px;">
            <option value="members">Members only (${counts.members})</option>
            <option value="all">Members + free updates list (${counts.all}) — announcements only; the Sunday Letter is a member perk</option>
          </select>
        </div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" name="test" value="1">Send test to me</button>
          <button class="btn btn-gold btn-sm" onclick="return confirm('Send this letter now?')">Publish &amp; send</button>
        </div>
        <p style="font-size:0.8rem;color:var(--muted);margin-top:1rem;">Uses Resend HTTPS or SMTP settings in .env. Failed messages are queued and retried automatically.</p>
      </form>
      <div class="table-wrap"><table class="admin-table">
        <thead><tr><th>Sent</th><th>Subject</th><th>Audience</th><th>Delivered</th></tr></thead>
        <tbody>${letters.map((l) => `<tr><td>${date(l.created_at)}</td><td><a href="/letters/${l.id}" style="text-decoration:underline;">${escapeHtml(l.subject)}</a></td><td>${l.audience}</td><td>${l.sent_count}</td></tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:1.5rem;">No letters yet.</td></tr>`}</tbody>
      </table></div>`,
  });
}
