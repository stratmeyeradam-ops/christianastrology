// Client-side interactions: cart management, mobile navigation, quiz scoring
(function() {
  // Mobile Nav Toggle
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  // Shopping Cart Helpers (stored in localStorage)
  window.Cart = {
    get() {
      try {
        return JSON.parse(localStorage.getItem('ca_cart') || '[]');
      } catch {
        return [];
      }
    },
    save(items) {
      try { localStorage.setItem('ca_cart', JSON.stringify(items)); } catch (e) {}
      this.updateBadge();
    },
    add(productId, variantId, qty = 1) {
      const items = this.get();
      const existing = items.find(i => i.productId === productId && i.variantId === variantId);
      if (existing) {
        existing.qty = Math.min(10, existing.qty + qty);
      } else {
        items.push({ productId, variantId, qty });
      }
      this.save(items);
      this.showToast(document.body.dataset.added || 'Added to your cart');
    },
    remove(index) {
      const items = this.get();
      items.splice(index, 1);
      this.save(items);
    },
    update(index, qty) {
      const items = this.get();
      if (items[index]) {
        items[index].qty = Math.max(1, qty);
        this.save(items);
      }
    },
    clear() {
      localStorage.removeItem('ca_cart');
      this.updateBadge();
    },
    count() {
      return this.get().reduce((acc, i) => acc + i.qty, 0);
    },
    updateBadge() {
      const el = document.querySelector('.cart-count-badge');
      if (el) {
        const c = this.count();
        el.textContent = c > 0 ? c : '';
        el.style.display = c > 0 ? 'inline-flex' : 'none';
      }
    },
    showToast(msg) {
      let toast = document.getElementById('ca-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'ca-toast';
        toast.style.cssText = `
          position: fixed; bottom: 24px; right: 24px; background: #081225; color: #faf6ee;
          border: 1px solid #c59b48; padding: 12px 20px; border-radius: 9999px; font-size: 0.88rem;
          font-weight: 600; box-shadow: 0 10px 25px rgba(0,0,0,0.2); z-index: 9999;
          transition: opacity 0.3s ease, transform 0.3s ease; opacity: 0; transform: translateY(10px);
        `;
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
      }, 3000);
    }
  };

  // Common email-domain typos → the domain they almost certainly meant.
  const DOMAIN_FIXES = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com',
    'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.con': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmail.om': 'gmail.com',
    'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com',
    'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com',
    'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outlook.con': 'outlook.com',
    'icloud.co': 'icloud.com', 'icoud.com': 'icloud.com', 'iclod.com': 'icloud.com',
    'aol.co': 'aol.com', 'aol.con': 'aol.com', 'comcast.com': 'comcast.net',
  };
  function suggestEmail(value) {
    const v = String(value || '').trim().toLowerCase();
    const at = v.lastIndexOf('@');
    if (at < 1) return '';
    const fix = DOMAIN_FIXES[v.slice(at + 1)];
    return fix ? v.slice(0, at + 1) + fix : '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.Cart.updateBadge();
    // Natal chart: preselect the visitor's own time zone the first time.
    document.querySelectorAll('.tz-select').forEach((sel) => {
      if (sel.dataset.chosen) return;
      try {
        const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if ([...sel.options].some((o) => o.value === z)) sel.value = z;
      } catch (e) {}
    });
    // Sign-in / sign-up helpers: show-password toggle, Caps Lock warning, email typo hints.
    document.querySelectorAll('form[data-auth-form]').forEach((form) => {
      const d = form.dataset;
      form.querySelectorAll('input[type="password"]').forEach((pw) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pw-toggle';
        btn.textContent = d.show;
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', () => {
          const show = pw.type === 'password';
          pw.type = show ? 'text' : 'password';
          btn.textContent = show ? d.hide : d.show;
          btn.setAttribute('aria-pressed', String(show));
          pw.focus();
        });
        const wrap = document.createElement('div');
        wrap.className = 'pw-wrap';
        pw.parentNode.insertBefore(wrap, pw);
        wrap.append(pw, btn);
        const caps = document.createElement('div');
        caps.className = 'field-hint';
        caps.hidden = true;
        caps.textContent = d.caps;
        wrap.after(caps);
        const check = (e) => { if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); };
        pw.addEventListener('keydown', check);
        pw.addEventListener('keyup', check);
        pw.addEventListener('blur', () => { caps.hidden = true; });
      });
      const email = form.querySelector('input[type="email"]');
      if (email) {
        const hint = document.createElement('div');
        hint.className = 'field-hint';
        hint.hidden = true;
        email.after(hint);
        email.addEventListener('blur', () => {
          const fix = suggestEmail(email.value);
          hint.hidden = !fix;
          if (!fix) return;
          const a = document.createElement('a');
          a.href = '#';
          a.textContent = fix;
          a.addEventListener('click', (e) => { e.preventDefault(); email.value = fix; hint.hidden = true; });
          const [before, after] = d.typo.split('{email}');
          hint.replaceChildren(before, a, after || '');
        });
      }
    });
    // Close the language menu when clicking elsewhere.
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.lang-menu[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
    });
  });
})();
