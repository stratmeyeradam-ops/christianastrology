import { escapeHtml, layout } from "./layout.js";
import { t, fmtDate } from "../i18n.js";
import { joinHref } from "../plans.js";

const paras = (text) => escapeHtml(text).split(/\n{2,}/).map((p) => `<p style="margin-bottom:1.25rem;">${p.replace(/\n/g, "<br>")}</p>`).join("");

export function lettersView({ user, letters = [], letter = null, locked = false }) {
  const head = `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0 3rem;border-bottom:1px solid var(--border-dark);">
      <div class="container" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${t("For Pilgrim, Devoted & Saint members")}</span>
        <h1 style="color:var(--white);">${letter ? escapeHtml(letter.subject) : t("The Sunday Letter")}</h1>
        ${letter ? `<p style="color:#b9c9de;">${fmtDate(letter.created_at)}</p>` : ""}
      </div>
    </div>`;
  let inner;
  if (locked) {
    inner = `<div class="card" style="text-align:center;padding:3rem 2rem;">
      <span style="font-size:3rem;display:block;margin-bottom:1rem;">✉️</span>
      <h2 style="margin-bottom:0.75rem;">${t("A weekly pastoral letter, every Lord's Day")}</h2>
      <p style="color:var(--muted);max-width:520px;margin:0 auto 1.5rem;">${t("Members receive the Sunday Letter by email and can read every past letter here.")}</p>
      <a href="${joinHref("pilgrim")}" class="btn btn-gold">${t("Become a member")}</a></div>`;
  } else if (letter) {
    inner = `<article class="card" style="padding:clamp(1.5rem, 5vw, 3rem);font-size:1.08rem;line-height:1.8;">${paras(letter.body)}
      <p style="margin-top:2rem;"><a href="/letters" style="color:var(--gold-dim);font-weight:600;">← ${t("All letters")}</a></p></article>`;
  } else {
    inner = letters.length
      ? `<div style="display:grid;gap:1rem;">${letters.map((l) => `
          <a href="/letters/${l.id}" class="card" style="padding:1.5rem;display:block;">
            <span style="font-size:0.8rem;color:var(--muted);">${fmtDate(l.created_at)}</span>
            <h3 style="margin-top:0.25rem;">${escapeHtml(l.subject)}</h3>
          </a>`).join("")}</div>`
      : `<div class="card" style="text-align:center;padding:3rem;color:var(--muted);">${t("The first letter is on its way.")}</div>`;
  }
  return layout({
    title: letter ? letter.subject : t("The Sunday Letter"),
    user,
    currentPath: letter ? `/letters/${letter.id}` : "/letters",
    body: `${head}<section class="section"><div class="container" style="max-width:760px;">${inner}</div></section>`,
  });
}
