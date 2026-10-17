import { escapeHtml, layout } from "./layout.js";
import { t } from "../i18n.js";
import { planById } from "../plans.js";

// Labels for the client-side helpers in main.js (show password, Caps Lock, email typo hints).
const helperAttrs = () =>
  `data-auth-form data-show="${escapeHtml(t("Show"))}" data-hide="${escapeHtml(t("Hide"))}" data-caps="${escapeHtml(t("Caps Lock is on"))}" data-typo="${escapeHtml(t("Did you mean {email}?"))}"`;

/** "Step 1 of 2" note when the visitor is on their way to a membership checkout. */
function checkoutNote(next) {
  const plan = planById(/^\/checkout\/subscribe\/([\w-]+)$/.exec(next || "")?.[1]);
  return plan
    ? `<div class="alert alert-info">${t("Step 1 of 2: create your account. Next, you'll pay securely with Stripe for {plan}.", { plan: escapeHtml(t(plan.name)) })}</div>`
    : "";
}

export function loginView({ error = "", message = "", next = "", email = "" } = {}) {
  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0 3rem;border-bottom:1px solid var(--border-dark);">
      <div class="container text-center" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${t("Welcome Back")}</span>
        <h1 style="color:var(--white);">${t("Sign In")}</h1>
      </div>
    </div>

    <section class="section">
      <div class="container" style="max-width:480px;">
        <div class="form-card">
          ${error ? `<div class="alert alert-error">${escapeHtml(t(error))}</div>` : ''}
          ${message ? `<div class="alert alert-success">${escapeHtml(t(message))}</div>` : ''}

          <form method="POST" action="/login" ${helperAttrs()}>
            <input type="hidden" name="next" value="${escapeHtml(next)}">

            <div class="form-group">
              <label class="form-label">${t("Email Address")}</label>
              <input type="email" name="email" required autocomplete="email" autocapitalize="off" spellcheck="false" class="form-control" placeholder="you@example.com" value="${escapeHtml(email)}" ${email ? "" : "autofocus"}>
            </div>

            <div class="form-group">
              <label class="form-label">${t("Password")}</label>
              <input type="password" name="password" required autocomplete="current-password" class="form-control" placeholder="••••••••" ${email ? "autofocus" : ""}>
            </div>

            <button type="submit" class="btn btn-gold" style="width:100%;margin-top:0.5rem;padding:0.85rem;">
              ${t("Sign In")} ✦
            </button>
          </form>

          <div style="text-align:center;margin-top:1rem;font-size:0.85rem;">
            <a href="/forgot" style="color:var(--muted);text-decoration:underline;">${t("Forgot your password?")}</a>
          </div>

          <div style="text-align:center;margin-top:1.5rem;font-size:0.88rem;color:var(--muted);">
            ${t("Not a member yet?")} <a href="/pricing${next ? `?next=${encodeURIComponent(next)}` : ''}" style="color:var(--gold-dim);font-weight:600;">${t("See memberships")}</a>
          </div>
        </div>
      </div>
    </section>
  `;

  return layout({
    title: t("Sign In"),
    noindex: true,
    currentPath: "/login",
    body,
  });
}

export function signupView({ error = "", next = "", email = "", displayName = "" } = {}) {
  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0 3rem;border-bottom:1px solid var(--border-dark);">
      <div class="container text-center" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${t("Join the Fellowship")}</span>
        <h1 style="color:var(--white);">${t("Create Your Free Account")}</h1>
      </div>
    </div>

    <section class="section">
      <div class="container" style="max-width:480px;">
        <div class="form-card">
          ${error ? `<div class="alert alert-error">${escapeHtml(t(error))}</div>` : checkoutNote(next)}

          <form method="POST" action="/signup" ${helperAttrs()}>
            <input type="hidden" name="next" value="${escapeHtml(next)}">
            <div class="hp-field" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>

            <div class="form-group">
              <label class="form-label">${t("Display name")}</label>
              <input type="text" name="displayName" required maxlength="60" autocomplete="nickname" class="form-control" placeholder="${t("e.g. Sister Mary or Jonathan")}" value="${escapeHtml(displayName)}">
            </div>

            <div class="form-group">
              <label class="form-label">${t("Email Address")}</label>
              <input type="email" name="email" required autocomplete="email" autocapitalize="off" spellcheck="false" class="form-control" placeholder="you@example.com" value="${escapeHtml(email)}">
            </div>

            <div class="form-group">
              <label class="form-label">${t("Create Password (min. 8 characters)")}</label>
              <input type="password" name="password" required minlength="8" autocomplete="new-password" class="form-control" placeholder="••••••••">
            </div>

            <button type="submit" class="btn btn-gold" style="width:100%;margin-top:0.5rem;padding:0.85rem;">
              ${t("Create Free Account")} ✦
            </button>
          </form>
          <p style="font-size:0.78rem;color:var(--muted);text-align:center;margin-top:1rem;">${t("By joining you agree to our <a href=\"/terms\" style=\"text-decoration:underline;\">Terms</a> and <a href=\"/privacy\" style=\"text-decoration:underline;\">Privacy Policy</a>.")}</p>

          <div style="text-align:center;margin-top:1.5rem;font-size:0.88rem;color:var(--muted);">
            ${t("Already have an account?")} <a href="/login${next ? `?next=${encodeURIComponent(next)}` : ''}" style="color:var(--gold-dim);font-weight:600;">${t("Sign In")}</a>
          </div>
        </div>
      </div>
    </section>
  `;

  return layout({
    title: t("Create Account"),
    noindex: true,
    currentPath: "/signup",
    body,
  });
}

export function staticPageView({ title, eyebrow = "", contentHtml = "", user = null, currentPath = "" } = {}) {
  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0 3rem;border-bottom:1px solid var(--border-dark);">
      <div class="container text-center" style="text-align:center;">
        ${eyebrow ? `<span class="eyebrow" style="color:var(--gold-light);">${escapeHtml(eyebrow)}</span>` : ''}
        <h1 style="color:var(--white);">${escapeHtml(title)}</h1>
      </div>
    </div>

    <section class="section">
      <div class="container" style="max-width:800px;">
        <div class="card" style="padding:clamp(2rem, 5vw, 3.5rem);line-height:1.8;font-size:1.02rem;">
          ${contentHtml}
        </div>
      </div>
    </section>
  `;

  return layout({
    title,
    user,
    currentPath,
    body,
  });
}

function authShell(heading, eyebrow, inner) {
  return layout({
    title: heading,
    currentPath: "/forgot",
    noindex: true,
    body: `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0 3rem;border-bottom:1px solid var(--border-dark);">
      <div class="container" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${escapeHtml(eyebrow)}</span>
        <h1 style="color:var(--white);">${escapeHtml(heading)}</h1>
      </div>
    </div>
    <section class="section">
      <div class="container" style="max-width:480px;"><div class="form-card">${inner}</div></div>
    </section>`,
  });
}

export function forgotView({ sent = false, error = "" } = {}) {
  return authShell(t("Reset Your Password"), t("Account Help"), sent
    ? `<div class="alert alert-success">${t("If an account exists for that email, a reset link is on its way. It expires in one hour.")}</div>
       <p style="text-align:center;"><a href="/login" style="color:var(--gold-dim);font-weight:600;">${t("Back to sign in")}</a></p>`
    : `${error ? `<div class="alert alert-error">${escapeHtml(t(error))}</div>` : ""}
       <form method="POST" action="/forgot" ${helperAttrs()}>
         <div class="form-group">
           <label class="form-label">${t("Email Address")}</label>
           <input type="email" name="email" required autocomplete="email" class="form-control" placeholder="you@example.com">
         </div>
         <button type="submit" class="btn btn-gold" style="width:100%;padding:0.85rem;">${t("Email Me a Reset Link")}</button>
       </form>`);
}

export function resetView({ token, error = "" } = {}) {
  return authShell(t("Choose a New Password"), t("Account Help"), `
    ${error ? `<div class="alert alert-error">${escapeHtml(t(error))}</div>` : ""}
    <form method="POST" action="/reset/${escapeHtml(token)}" ${helperAttrs()}>
      <div class="form-group">
        <label class="form-label">${t("New password (min. 8 characters)")}</label>
        <input type="password" name="password" required minlength="8" autocomplete="new-password" class="form-control">
      </div>
      <button type="submit" class="btn btn-gold" style="width:100%;padding:0.85rem;">${t("Save Password & Sign In")}</button>
    </form>`);
}
