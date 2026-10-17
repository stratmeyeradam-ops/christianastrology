// Static and system pages. Every paragraph goes through t() so it can be translated.
import { escapeHtml } from "./layout.js";
import { staticPageView } from "./auth.js";
import { config } from "../config.js";
import { t } from "../i18n.js";

const h3 = (s) => `<h3 style="margin:1.75rem 0 0.75rem;">${t(s)}</h3>`;
const p = (s, vars) => `<p style="margin-bottom:1.25rem;">${t(s, vars)}</p>`;

export const aboutPage = (user) =>
  staticPageView({
    title: t("About Our Ministry"),
    eyebrow: t("Guiding Faith, Aligning Stars"),
    user,
    currentPath: "/about",
    contentHtml: [
      p("<strong>Christian Astrology</strong> is an ordained online pastoral ministry founded under the Universal Life Church. We provide a peaceful, discerning sanctuary for Christians of every tradition—Evangelical, Catholic, Orthodox, and Protestant—who delight in the wonder of God's celestial creation."),
      h3("Biblical Foundations"),
      p("We reject superstitious fatalism, divination, and any teaching that the stars hold sovereignty over human conscience or divine grace. We stand on Genesis 1:14 (“let them be for signs, and for seasons”), Job 38:31-33 (the Mazzaroth brought forth in its season), and Psalm 19:1 (“The heavens declare the glory of God”)."),
      h3("Ecumenical Fellowship"),
      p("Whether you seek solace in daily prayer, a language for your God-given temperament, or warm Christian community, you are welcome here."),
    ].join(""),
  });

export const contactPage = (user) =>
  staticPageView({
    title: t("Contact & Fellowship"),
    eyebrow: t("Reach Out"),
    user,
    currentPath: "/contact",
    contentHtml: `
      ${p("Questions about memberships, store orders, or study materials? We would love to hear from you.")}
      <div class="card" style="padding:1.5rem;background:var(--paper);margin-bottom:2rem;">
        <strong>${t("Ministry email")}:</strong> <a href="mailto:${escapeHtml(config.contactEmail)}" style="color:var(--gold-dim);">${escapeHtml(config.contactEmail)}</a><br>
        <strong>${t("Fellowship board")}:</strong> <a href="/board" style="color:var(--gold-dim);">${t("Community discussions")}</a>
      </div>
      <p style="font-size:0.9rem;color:var(--muted);">${t("For an order, include your order number (CA-00000). Saint members receive priority prayer responses.")}</p>`,
  });

export const privacyPage = (user) =>
  staticPageView({
    title: t("Privacy Policy"),
    user,
    currentPath: "/privacy",
    contentHtml: [
      p("We treat your personal data with sacred trust. We never sell, rent, or trade your personal information."),
      h3("What we collect"),
      p("Your email, display name, and a securely hashed password to run your account; the posts you choose to publish on the message board; and, for store orders, the name, shipping address, phone, and email you enter at checkout."),
      h3("Payments"),
      p("Payments are processed by Stripe. Card details go directly to Stripe and never touch our servers."),
      h3("Order fulfilment"),
      p("Store items are printed and shipped by Printify and its print partners. Only what is needed to deliver your order—name, address, phone, email, and the items—is shared with them."),
      h3("Cookies"),
      p("We use one cookie to keep you signed in and one to remember your language. Your cart is kept in your own browser."),
      h3("Advertising"),
      p("Visitors who are not members may see ads served by Google AdSense. Google and its partners may use cookies to show ads based on your visits to this and other sites. You can manage this at <a href=\"https://adssettings.google.com\" rel=\"noopener\" style=\"text-decoration:underline;\">Google Ad Settings</a> and learn more in <a href=\"https://policies.google.com/technologies/partner-sites\" rel=\"noopener\" style=\"text-decoration:underline;\">How Google uses information from sites that use its services</a>. Members never see ads."),
      h3("Your choices"),
      p("You can change your name or password from your account at any time. To delete your account and posts, email {email}.", { email: escapeHtml(config.contactEmail) }),
    ].join(""),
  });

export const termsPage = (user) =>
  staticPageView({
    title: t("Terms of Service & Refunds"),
    user,
    currentPath: "/terms",
    contentHtml: [
      p("By using Christian Astrology you agree to our principles of grace, respect, and reverence in every interaction."),
      h3("Memberships"),
      p("Memberships renew monthly through Stripe until canceled. Cancel any time from your account; you keep access until the end of the period you paid for. Introductory prices apply to the first month only."),
      h3("Community conduct"),
      p("Be kind. Harassment, spam, explicit content, and sales pitches are removed, and accounts may be suspended. Ministers may lock or move discussions to keep the board peaceful."),
      h3("Store orders"),
      p("Every item is printed to order. If something arrives damaged or misprinted, email us within 30 days with a photo and we will replace or refund it. Because items are made for you, we cannot accept returns for change of mind or sizing—please check the size chart before ordering."),
      h3("Reflective purpose"),
      p("Readings and charts are offered for prayer, contemplation, and spiritual formation. They are not predictions and are not financial, medical, or legal advice."),
    ].join(""),
  });

export const newsletterThanks = (user) =>
  staticPageView({
    title: t("You're on the list ✦"),
    user,
    contentHtml: `
      <div style="text-align:center;padding:1rem 0;">
        <h2>${t("Thank you for joining our pastoral circle!")}</h2>
        <p style="color:var(--muted);margin:1rem auto 1rem;max-width:500px;">${t("We'll email you new articles and site news. Every email includes a one-click unsubscribe link.")}</p>
        <p style="color:var(--muted);margin:0 auto 2rem;max-width:500px;">${t("The Sunday Letter, our weekly pastoral email, is included with every membership.")}</p>
        <a href="/" class="btn btn-primary btn-sm">${t("Return Home")}</a>
      </div>`,
  });

export const unsubscribed = () =>
  staticPageView({ title: t("Unsubscribed"), contentHtml: p("You won't receive the newsletter anymore. God bless you.") });

export const subscribedGuest = (next = "") =>
  staticPageView({
    title: t("Thank you for subscribing"),
    contentHtml:
      p("Your membership is active. Sign in with the email you used at checkout to unlock it.") +
      p("New here? We've emailed you a link to set your password.") +
      `<div style="text-align:center;"><a href="/login${next ? `?next=${encodeURIComponent(next)}` : ""}" class="btn btn-primary btn-sm" style="display:inline-block;width:auto;">${t("Sign In")}</a></div>`,
  });

export const choosePassword = ({ sessionId, email, next = "", error = "" }) =>
  staticPageView({
    title: t("Welcome! One last step"),
    contentHtml: `
      ${error ? `<div class="alert alert-error">${escapeHtml(t(error))}</div>` : ""}
      ${p("Your payment went through and your membership is active. Choose a password so you can sign in from any device.")}
      <form method="POST" action="/checkout/welcome" data-auth-form data-show="${escapeHtml(t("Show"))}" data-hide="${escapeHtml(t("Hide"))}" data-caps="${escapeHtml(t("Caps Lock is on"))}" data-typo="" style="max-width:420px;margin:0 auto;">
        <input type="hidden" name="session_id" value="${escapeHtml(sessionId)}">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <input type="email" name="email" value="${escapeHtml(email)}" autocomplete="username" hidden readonly>
        <div class="form-group">
          <label class="form-label">${t("Your account email")}</label>
          <div style="font-weight:600;">${escapeHtml(email)}</div>
        </div>
        <div class="form-group">
          <label class="form-label">${t("Create Password (min. 8 characters)")}</label>
          <input type="password" name="password" required minlength="8" autocomplete="new-password" class="form-control" autofocus>
        </div>
        <button type="submit" class="btn btn-gold" style="width:100%;padding:0.85rem;">${t("Save Password & Sign In")}</button>
      </form>
      <p style="font-size:0.85rem;color:var(--muted);text-align:center;margin-top:1.25rem;">${t("We also emailed you a link to set it later, if you'd rather.")}</p>`,
  });

export const orderThanks = (user, ref) =>
  staticPageView({
    title: t("Order Confirmed ✦"),
    eyebrow: t("Sanctuary Store"),
    user,
    currentPath: "/store/thanks",
    contentHtml: `
      <div style="text-align:center;padding:2rem 0;">
        <span style="font-size:3.5rem;display:block;margin-bottom:1rem;color:var(--gold);">✦</span>
        <h2>${ref ? t("Thank you for your order {ref}!", { ref: `<span style="white-space:nowrap">${escapeHtml(ref)}</span>` }) : t("Thank you for your order!")}</h2>
        <p style="color:var(--muted);max-width:550px;margin:1rem auto 2rem;font-size:1.05rem;">
          ${t("Stripe has emailed your receipt. Your items are now being printed to order — we'll email tracking as soon as they ship (usually 3–7 business days).")}
        </p>
        <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
          ${user ? `<a href="/account#orders" class="btn btn-outline btn-sm">${t("View My Orders")}</a>` : ""}
          <a href="/store" class="btn btn-primary btn-sm">${t("Continue Shopping")}</a>
        </div>
      </div>
      <script>try{localStorage.removeItem('ca_cart')}catch(e){}</script>`,
  });

export const notFound = (user) =>
  staticPageView({
    title: t("Page not found"),
    eyebrow: "404",
    user,
    contentHtml: `<p style="margin-bottom:1.5rem;">${t("We couldn't find that page. It may have moved.")}</p><a href="/" class="btn btn-primary btn-sm">${t("Return Home")}</a>`,
  });

export const serverError = (user) =>
  staticPageView({
    title: t("Something went wrong"),
    user,
    contentHtml: `<p style="margin-bottom:1.5rem;">${t("An unexpected error occurred. Please try again in a moment.")}</p><a href="/" class="btn btn-primary btn-sm">${t("Return Home")}</a>`,
  });

export const tooManyPage = (user) =>
  staticPageView({ title: t("Slow down a moment"), user, contentHtml: p("Too many attempts. Please wait a few minutes and try again.") });
