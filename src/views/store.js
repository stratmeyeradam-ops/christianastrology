import { STORE_PAYMENT_LINKS } from "../plans.js";
import { escapeHtml, layout } from "./layout.js";
import { printifyEnabled } from "../config.js";
import { t } from "../i18n.js";

const money = (c) => `$${(c / 100).toFixed(2)}`;
const memberPrice = (c, pct) => Math.round((c * (100 - pct)) / 100);

function discountBanner(discount, user) {
  if (discount) return `<div class="alert alert-success" style="margin-bottom:2rem;">✦ ${t("Your membership reward is applied: <strong>{n}% off</strong> everything in the store.", { n: discount })}</div>`;
  return `<div class="alert alert-info" style="margin-bottom:2rem;display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;">
    <div><strong>${t("Members save 10–30% on every order.")}</strong> ${t("Pilgrim")} 10% · ${t("Devoted")} 20% · ${t("Saint")} 30%.</div>
    <a href="/pricing" class="btn btn-gold btn-sm">${t("See memberships")}</a></div>`;
}

export function storeIndexView({ products = [], user = null, discount = 0, error = null } = {}) {
  const isPrintifyActive = printifyEnabled();

  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:4rem 0 3.5rem;border-bottom:1px solid var(--border-dark);">
      <div class="container text-center" style="text-align:center;">
        <span class="eyebrow" style="color:var(--gold-light);">${t("Printed to order, just for you")}</span>
        <h1 style="color:var(--white);margin-bottom:1rem;">${t("The Sanctuary Store")}</h1>
        <p style="max-width:650px;margin:0 auto;color:#b9c9de;font-size:1.05rem;">
          ${t("Sacred art, devotions, study journals, and apparel crafted for prayerful study and quiet moments with God.")}
        </p>
      </div>
    </div>

    <section class="section">
      <div class="container">
        ${!isPrintifyActive ? `
          <div class="alert alert-info" style="margin-bottom:2.5rem;display:flex;align-items:center;gap:1rem;">
            <span style="font-size:1.5rem;">ℹ️</span>
            <div>
              <strong>${t("Preview catalog")}:</strong> ${t("Our full collection is arriving soon. Items below are a preview and can’t be purchased yet.")}
            </div>
          </div>
        ` : ''}

        ${discountBanner(discount, user)}
        ${error && !products.length ? `<div class="alert alert-error">${t("The store catalog is temporarily unavailable. Please check back shortly.")}</div>` : ''}
        ${isPrintifyActive && !error && !products.length ? `<div class="card" style="text-align:center;padding:3rem;"><h3>${t("New pieces are on the way.")}</h3><p style="color:var(--muted);">${t("Check back soon.")}</p></div>` : ''}

        <div class="store-grid">
          ${products.map(p => {
            return `
              <div class="product-card">
                <div class="product-img-wrap">
                  <a href="/store/${escapeHtml(p.id)}"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.title)}" loading="lazy"></a>
                  ${p.tags?.[0] ? `<span class="product-badge">${escapeHtml(p.tags[0])}</span>` : ''}
                </div>

                <div class="product-info">
                  <h3 class="product-title">${escapeHtml(p.title)}</h3>
                  <div class="product-price">${p.variants.length > 1 ? t('From') + ' ' : ''}${discount ? `<s style="color:var(--muted);font-weight:400;font-size:0.85em;">${money(p.minPrice)}</s> ${money(memberPrice(p.minPrice, discount))}` : money(p.minPrice)}</div>
                  <div class="product-desc line-clamp-2">${p.description}</div>

                  <div style="display:grid;gap:0.5rem;margin-top:auto;">${STORE_PAYMENT_LINKS[p.id] ? `<a href="${STORE_PAYMENT_LINKS[p.id]}" class="btn btn-gold btn-sm">${t("Buy Now")} — ${money(p.minPrice)} →</a>` : ""}<a href="/store/${escapeHtml(p.id)}" class="btn btn-outline btn-sm">
                    ${t("View Item & Options")} →
                  </a></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </section>
  `;

  return layout({
    title: t("Sanctuary Store"),
    description: t("Christian devotional art, apparel, mugs, and journals — printed to order."),
    user,
    currentPath: "/store",
    body,
  });
}

export function productDetailView({ product, user = null, discount = 0 } = {}) {
  const isPrintifyActive = printifyEnabled();

  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:3rem 0;border-bottom:1px solid var(--border-dark);">
      <div class="container">
        <div style="font-size:0.85rem;color:var(--gold-light);margin-bottom:0.5rem;">
          <a href="/store">← ${t("Sanctuary Store")}</a>
        </div>
        <h1 style="color:var(--white);font-size:2.2rem;">${escapeHtml(product.title)}</h1>
      </div>
    </div>

    <section class="section">
      <div class="container">
        <div class="product-layout">
          <!-- Product Gallery -->
          <div>
            <div class="card" style="padding:0;overflow:hidden;border-color:var(--border);border-radius:var(--radius-md);">
              <img id="main-product-img" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" style="width:100%;height:auto;aspect-ratio:1/1;object-fit:cover;">
            </div>

            ${product.images?.length > 1 ? `
              <div style="display:flex;gap:0.75rem;margin-top:1rem;overflow-x:auto;">
                ${product.images.map(img => `
                  <button type="button" data-src="${escapeHtml(img.src)}" class="thumb-btn" style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;width:70px;height:70px;padding:0;cursor:pointer;background:#fff;flex:0 0 auto;">
                    <img src="${escapeHtml(img.src)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;">
                  </button>
                `).join('')}
              </div>
            ` : ''}
          </div>

          <!-- Product Details & Add to Cart -->
          <div>
            <div style="font-size:1.75rem;font-weight:700;color:var(--gold-dim);margin-bottom:0.5rem;" id="variant-price-display"></div>
            ${discount ? `<div style="font-size:0.85rem;color:#27814e;font-weight:600;margin-bottom:1.5rem;">✦ ${t("Member price — {n}% off applied", { n: discount })}</div>` : `<div style="font-size:0.85rem;color:var(--muted);margin-bottom:1.5rem;"><a href="/pricing" style="color:var(--gold-dim);font-weight:600;">${t("Members save 10–30%")}</a></div>`}

            <div style="font-size:1rem;line-height:1.7;color:var(--ink);margin-bottom:2rem;">
              ${product.description}
            </div>

            <form id="add-to-cart-form" onsubmit="event.preventDefault(); window.handleAddToCart();" class="card" style="padding:2rem;background:var(--paper);">
              <input type="hidden" id="product-id" value="${escapeHtml(product.id)}">

              <div class="form-group">
                <label class="form-label" for="variant-select">${t("Option / Size")}</label>
                <select id="variant-select" class="form-control" onchange="window.handleVariantChange()" style="background:#fff;">
                  ${product.variants.map(v => `
                    <option value="${v.id}" data-price="${v.price}" data-member="${memberPrice(v.price, discount)}">
                      ${escapeHtml(v.title)} — ${money(memberPrice(v.price, discount))}
                    </option>
                  `).join('')}
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" for="qty-input">${t("Quantity")}</label>
                <input type="number" id="qty-input" value="1" min="1" max="10" class="form-control" style="background:#fff;width:120px;">
              </div>

              <div style="margin-top:1.5rem;">
                <button type="submit" class="btn btn-gold" style="width:100%;padding:0.9rem;">
                  ${t("Add to Cart")} ✦
                </button>
              </div>

              ${product.demo ? `
                <small style="display:block;margin-top:1rem;color:var(--muted);text-align:center;">
                  ${t("Preview item — not yet available to purchase.")}
                </small>
              ` : `
                <small style="display:block;margin-top:1rem;color:var(--muted);text-align:center;">
                  ${t("Printed to order and shipped in 5–12 business days.")}
                </small>
              `}
            </form>
          </div>
        </div>
      </div>
    </section>

    <script>
      (function () {
        var images = ${JSON.stringify(product.images.map(i => ({ src: i.src, v: i.variant_ids }))).replace(/</g, '\\u003c')};
        var main = document.getElementById('main-product-img');
        var fmt = function (c) { return '$' + (c / 100).toFixed(2); };
        document.querySelectorAll('.thumb-btn').forEach(function (b) {
          b.addEventListener('click', function () { main.src = b.dataset.src; });
        });
        window.handleVariantChange = function () {
          var sel = document.getElementById('variant-select');
          var opt = sel.options[sel.selectedIndex];
          var list = Number(opt.dataset.price), member = Number(opt.dataset.member);
          document.getElementById('variant-price-display').innerHTML = member < list
            ? '<s style="color:var(--muted);font-weight:400;font-size:0.7em;">' + fmt(list) + '</s> ' + fmt(member)
            : fmt(list);
          var img = images.find(function (i) { return i.v && i.v.indexOf(Number(sel.value)) !== -1; });
          if (img) main.src = img.src;
        };
        window.handleVariantChange();
      })();

      window.handleAddToCart = function() {
        const pId = document.getElementById('product-id').value;
        const vId = Number(document.getElementById('variant-select').value);
        const qty = Number(document.getElementById('qty-input').value) || 1;
        window.Cart.add(pId, vId, qty);
      };
    </script>
  `;

  return layout({
    title: `${product.title} — ${t("Sanctuary Store")}`,
    description: product.title,
    user,
    currentPath: `/store/${product.id}`,
    body,
  });
}

export function cartView({ user = null, discount = 0, error = "" } = {}) {
  const body = `
    <div style="background:var(--navy);color:var(--cream);padding:3.5rem 0;border-bottom:1px solid var(--border-dark);">
      <div class="container">
        <h1 style="color:var(--white);">${t("Your Cart")}</h1>
      </div>
    </div>

    <section class="section">
      <div class="container" style="max-width:850px;">
        ${error ? `<div class="alert alert-error">${escapeHtml(t(error))}</div>` : ''}
        ${discountBanner(discount, user)}
        <div id="cart-empty-view" style="display:none;text-align:center;padding:4rem 2rem;" class="card">
          <span style="font-size:3.5rem;display:block;margin-bottom:1rem;color:var(--gold);">🛒</span>
          <h2>${t("Your cart is empty.")}</h2>
          <p style="color:var(--muted);margin-bottom:1.5rem;">${t("Explore our store for sacred artwork, journals, and apparel.")}</p>
          <a href="/store" class="btn btn-gold btn-sm">${t("Browse the Store")} →</a>
        </div>

        <div id="cart-content-view">
          <div class="card" style="padding:2rem;margin-bottom:2rem;">
            <div id="cart-items-list" style="display:grid;gap:1rem;"></div>
          </div>

          <div class="card" style="padding:2rem;background:var(--paper);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1.5rem;">
            <div>
              <div style="font-size:0.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;">${t("Subtotal")}</div>
              <div style="font-size:2rem;font-weight:700;color:var(--navy);" id="cart-total-display">$0.00</div>
              <small style="color:var(--muted);" id="cart-ship-note">${t("Shipping is added at secure Stripe checkout.")}</small>
            </div>

            <form method="POST" action="/checkout/store" onsubmit="return window.submitCartCheckout(event);">
              <input type="hidden" name="cart_json" id="cart-json-input">
              <button type="submit" class="btn btn-gold" style="padding:0.9rem 2rem;">
                ${t("Secure Checkout")} →
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>

    <script>
      var L = ${JSON.stringify({
        loading: t("Loading cart…"),
        each: t("each"),
        remove: t("Remove"),
        freeShip: t("You qualify for free shipping ✦"),
        flat: t("Flat {amount} shipping"),
        freeOver: t("free over {amount}"),
        atCheckout: t("Added at secure Stripe checkout."),
        loadError: t("Unable to load cart pricing. Please try again."),
        empty: t("Your cart is empty."),
      }).replace(/</g, "\\u003c")};
      async function renderCart() {
        const items = window.Cart.get();
        const emptyView = document.getElementById('cart-empty-view');
        const contentView = document.getElementById('cart-content-view');
        const list = document.getElementById('cart-items-list');

        if (!items.length) {
          emptyView.style.display = 'block';
          contentView.style.display = 'none';
          return;
        }

        emptyView.style.display = 'none';
        contentView.style.display = 'block';
        list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);">' + L.loading + '</div>';

        try {
          const res = await fetch('/api/cart/details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
          });
          const data = await res.json();

          list.innerHTML = '';
          let subtotal = 0;

          // Drop anything no longer sold so indexes line up with what's shown.
          const valid = data.items.map(i => ({ productId: i.productId, variantId: i.variantId, qty: i.qty }));
          if (valid.length !== items.length) window.Cart.save(valid);
          const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
          if (!valid.length) return renderCart();

          data.items.forEach((item, idx) => {
            subtotal += item.price * item.qty;
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding-bottom:1rem;border-bottom:1px solid var(--border);gap:1rem;';
            row.innerHTML = \`
              <div style="display:flex;align-items:center;gap:1rem;">
                <img src="\${esc(item.image)}" alt="" style="width:64px;height:64px;border-radius:8px;object-fit:cover;">
                <div>
                  <strong>\${esc(item.title)}</strong>
                  <div style="font-size:0.85rem;color:var(--muted);">\${item.price < item.listPrice ? '<s>$' + (item.listPrice/100).toFixed(2) + '</s> ' : ''}$\${(item.price/100).toFixed(2)} \${L.each}</div>
                </div>
              </div>

              <div style="display:flex;align-items:center;gap:0.5rem;">
                <button type="button" class="btn btn-outline btn-sm" style="padding:0.2rem 0.6rem;" onclick="window.Cart.update(\${idx}, \${item.qty - 1}); renderCart();" aria-label="Decrease">−</button>
                <strong style="min-width:1.5rem;text-align:center;">\${item.qty}</strong>
                <button type="button" class="btn btn-outline btn-sm" style="padding:0.2rem 0.6rem;" onclick="window.Cart.update(\${idx}, \${Math.min(10, item.qty + 1)}); renderCart();" aria-label="Increase">+</button>
                <button type="button" onclick="window.Cart.remove(\${idx}); renderCart();" class="btn btn-outline btn-sm" style="padding:0.3rem 0.6rem;color:#9b1c1c;">\${L.remove}</button>
              </div>
            \`;
            list.appendChild(row);
          });

          document.getElementById('cart-total-display').textContent = '$' + (subtotal / 100).toFixed(2);
          document.getElementById('cart-json-input').value = JSON.stringify(valid);
          var free = data.freeShippingOverCents;
          document.getElementById('cart-ship-note').textContent = free && subtotal >= free
            ? L.freeShip
            : L.flat.replace('{amount}', '$' + (data.shippingCents / 100).toFixed(2)) + (free ? ' — ' + L.freeOver.replace('{amount}', '$' + (free / 100).toFixed(0)) : '') + '. ' + L.atCheckout;
        } catch (err) {
          list.innerHTML = '<div class="alert alert-error">' + L.loadError + '</div>';
        }
      }

      window.submitCartCheckout = function(e) {
        const items = window.Cart.get();
        if (!items.length) {
          alert(L.empty);
          return false;
        }
        document.getElementById('cart-json-input').value = JSON.stringify(items);
        return true;
      };

      document.addEventListener('DOMContentLoaded', renderCart);
    </script>
  `;

  return layout({
    title: t("Your Cart"),
    user,
    currentPath: "/cart",
    body,
  });
}
