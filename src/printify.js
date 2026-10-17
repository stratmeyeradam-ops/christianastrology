// Printify integration: catalog (read) + order submission (write).
// Docs: https://developers.printify.com/  — Bearer token + User-Agent required.
import { createHmac, timingSafeEqual } from "node:crypto";
import { config, printifyEnabled } from "./config.js";

// PRINTIFY_API_BASE is only for the offline payment-flow tests (scripts/payments-test.js).
const BASE = process.env.PRINTIFY_API_BASE || "https://api.printify.com/v1";
const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, products: [], error: null };

async function pf(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.printify.token}`,
      "User-Agent": "ChristianAstrology/1.0 (Node.js)",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || res.statusText;
    throw new Error(`Printify ${method} ${path} → ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return json;
}

// Printify descriptions are HTML. Keep a small safe subset, drop all attributes.
const ALLOWED = new Set(["p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "h3", "h4"]);
export function sanitizeHtml(html = "") {
  return String(html)
    .replace(/<(script|style|iframe|object)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?([a-z0-9]+)[^>]*>/gi, (m, tag) => {
      tag = tag.toLowerCase();
      if (!ALLOWED.has(tag)) return "";
      return m.startsWith("</") ? `</${tag}>` : `<${tag}>`;
    });
}

function normalize(p, demo = false) {
  const variants = (p.variants || [])
    .filter((v) => v.is_enabled !== false && v.is_available !== false)
    .map((v) => ({ id: v.id, title: v.title, price: v.price, options: v.options || [], sku: v.sku }));
  // Printify includes mockups for every color of the blank; only show the ones for variants we actually sell.
  const sold = new Set(variants.map((v) => v.id));
  const images = (p.images || [])
    .filter((i) => !i.variant_ids?.length || i.variant_ids.some((id) => sold.has(id)))
    .map((i) => ({ src: i.src, variant_ids: (i.variant_ids || []).filter((id) => sold.has(id)), is_default: !!i.is_default }))
    .filter((i, n, all) => all.findIndex((x) => x.src === i.src) === n)
    .sort((a, b) => b.is_default - a.is_default)
    .slice(0, 8); // Printify shoots dozens of angles; a handful is plenty for shoppers
  const defaultImage = (images.find((i) => i.is_default) || images[0])?.src || "/img/zodiac-virtues.webp";
  return {
    id: String(p.id),
    title: p.title,
    description: sanitizeHtml(p.description),
    tags: p.tags || [],
    options: (p.options || []).map((o) => ({ name: o.name, type: o.type, values: o.values || [] })),
    variants,
    images,
    image: defaultImage,
    minPrice: variants.length ? Math.min(...variants.map((v) => v.price)) : 0,
    demo,
  };
}

/** All purchasable products. Falls back to the demo catalog when Printify isn't configured. */
export async function getProducts({ force = false } = {}) {
  if (!printifyEnabled()) return DEMO_PRODUCTS;
  if (!force && cache.products.length && Date.now() - cache.at < TTL_MS) return cache.products;
  try {
    const out = [];
    let page = 1;
    for (;;) {
      const j = await pf(`/shops/${config.printify.shopId}/products.json?limit=50&page=${page}`);
      for (const p of j.data || []) {
        if (p.visible === false) continue; // hidden in Printify → hidden here
        if (!isOurs(p)) continue; // another site's product in a shared shop
        const n = normalize(p);
        if (n.variants.length) out.push(n);
      }
      if (!j.last_page || page >= j.last_page) break;
      page++;
    }
    // No tagged products yet → show the preview catalog. It stays flagged demo, so it can't be bought.
    const products = out.length ? out : DEMO_PRODUCTS;
    cache = { at: Date.now(), products, error: null };
  } catch (e) {
    console.error("[printify] catalog fetch failed:", e.message);
    cache.error = e.message;
    cache.at = Date.now() - TTL_MS + 60_000; // retry in a minute
  }
  return cache.products;
}

export const catalogError = () => (printifyEnabled() ? cache.error : null);

export async function getProduct(id) {
  return (await getProducts()).find((p) => p.id === String(id));
}

export async function listShops() {
  return pf("/shops.json");
}

/** Submit a paid order. Returns Printify order id. */
export async function createOrder({ externalId, label, items, shipping, email, phone }) {
  const [first, ...rest] = String(shipping.name || "Customer").trim().split(/\s+/);
  const a = shipping.address || {};
  const body = {
    external_id: externalId,
    label,
    line_items: items.map((i) => ({ product_id: i.productId, variant_id: Number(i.variantId), quantity: i.qty })),
    shipping_method: 1,
    is_printify_express: false,
    is_economy_shipping: false,
    send_shipping_notification: true,
    address_to: {
      first_name: first,
      last_name: rest.join(" ") || first,
      email: email || "",
      phone: phone || "",
      country: a.country || "",
      region: a.state || "",
      address1: a.line1 || "",
      address2: a.line2 || "",
      city: a.city || "",
      zip: a.postal_code || "",
    },
  };
  const r = await pf(`/shops/${config.printify.shopId}/orders.json`, { method: "POST", body });
  return r.id;
}

/** Reconcile a previous submission before retrying after a timeout or process restart. */
export async function findOrderByExternalId(externalId) {
  for (let page = 1; ; page++) {
    const result = await pf(`/shops/${config.printify.shopId}/orders.json?limit=100&page=${page}`);
    const match = (result.data || []).find((o) => o.external_id === externalId);
    if (match) return match;
    if (!result.last_page || page >= result.last_page) return null;
  }
}

export async function getOrder(orderId) {
  return pf(`/shops/${config.printify.shopId}/orders/${orderId}.json`);
}

export async function cancelOrder(orderId) {
  return pf(`/shops/${config.printify.shopId}/orders/${orderId}/cancel.json`, { method: "POST" });
}

/** In a shop shared with another site, only products carrying our tag are ours to sell or act on. */
export const isOurs = (p) => !config.printify.productTag || (p?.tags || []).some((t) => String(t).toLowerCase() === config.printify.productTag);

// --- Publishing ----------------------------------------------------------
// Printify "API" shops leave a product locked in "Publishing…" until the sales
// channel (this site) confirms it. We confirm with the product's URL here.
export async function markPublished(productId) {
  if (config.printify.productTag && !isOurs(await pf(`/shops/${config.printify.shopId}/products/${productId}.json`))) return false; // another site's product
  await pf(`/shops/${config.printify.shopId}/products/${productId}/publishing_succeeded.json`, {
    method: "POST",
    body: { external: { id: String(productId), handle: `${config.appUrl}/store/${productId}` } },
  });
  bustCache();
}

export async function markPublishFailed(productId, reason) {
  await pf(`/shops/${config.printify.shopId}/products/${productId}/publishing_failed.json`, {
    method: "POST",
    body: { reason: String(reason || "Rejected by storefront").slice(0, 250) },
  });
}

/** Confirm every product currently stuck in "Publishing…" (admin button / CLI). */
export async function confirmAllPublishing() {
  const done = [];
  let page = 1;
  for (;;) {
    const j = await pf(`/shops/${config.printify.shopId}/products.json?limit=50&page=${page}`);
    for (const p of j.data || []) {
      if (p.is_locked && isOurs(p)) {
        await markPublished(p.id);
        done.push(p.id);
      }
    }
    if (!j.last_page || page >= j.last_page) break;
    page++;
  }
  bustCache();
  return done;
}

export const bustCache = () => {
  cache.at = 0;
};

// --- Webhooks ------------------------------------------------------------
export const WEBHOOK_TOPICS = [
  "product:publish:started",
  "product:updated",
  "product:deleted",
  "order:updated",
  "order:sent-to-production",
  "order:shipment:created",
  "order:shipment:delivered",
];

/** Register (or re-point) all webhooks this site needs. Idempotent. */
export async function registerWebhooks() {
  if (!config.printify.webhookSecret) throw new Error("Set PRINTIFY_WEBHOOK_SECRET first (any long random string), then restart.");
  const url = `${config.appUrl}/webhook/printify`;
  const existing = await pf(`/shops/${config.printify.shopId}/webhooks.json`);
  const list = Array.isArray(existing) ? existing : existing.data || [];
  const out = [];
  for (const topic of WEBHOOK_TOPICS) {
    // Only touch hooks pointing at this site; leave other integrations alone.
    const mine = list.filter((w) => w.topic === topic && w.url === url);
    for (const w of mine) {
      await pf(`/shops/${config.printify.shopId}/webhooks/${w.id}.json?host=${encodeURIComponent(new URL(w.url).host)}`, { method: "DELETE" }).catch(() => {});
    }
    const body = { topic, url, ...(config.printify.webhookSecret ? { secret: config.printify.webhookSecret } : {}) };
    const w = await pf(`/shops/${config.printify.shopId}/webhooks.json`, { method: "POST", body });
    out.push({ topic, id: w.id });
  }
  return out;
}

/** X-Pfy-Signature: sha256=<hex hmac of raw body>. */
export function verifyWebhook(rawBody, header) {
  if (!config.printify.webhookSecret) return false; // unsigned webhooks are never trusted
  const m = /^sha256=([a-f0-9]{64})$/i.exec(String(header || ""));
  if (!m) return false;
  const expected = createHmac("sha256", config.printify.webhookSecret).update(rawBody).digest();
  const given = Buffer.from(m[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function sendToProduction(orderId) {
  return pf(`/shops/${config.printify.shopId}/orders/${orderId}/send_to_production.json`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Demo catalog (Printify-shaped). Shown only until PRINTIFY_API_TOKEN + PRINTIFY_SHOP_ID
// are set. Checkout is disabled for demo items so nothing unfulfillable is ever sold.
const sizes = (base, list, price) =>
  list.map((t, i) => ({ id: base + i, title: t, price: price + (i >= 4 ? 200 : 0), options: [base + i], is_enabled: true }));
const demo = [
  {
    id: "demo-tee",
    title: "He Counts the Stars — Unisex Tee",
    description: "<p>Soft ring-spun cotton tee with gold constellation type inspired by Psalm 147:4.</p><ul><li>100% combed cotton</li><li>Relaxed unisex fit</li></ul>",
    tags: ["Apparel"],
    options: [{ name: "Size", type: "size", values: ["S", "M", "L", "XL", "2XL"].map((t, i) => ({ id: 1000 + i, title: t })) }],
    variants: sizes(1000, ["S", "M", "L", "XL", "2XL"], 2800),
    images: [{ src: "/img/zodiac-virtues.webp", is_default: true }],
  },
  {
    id: "demo-hoodie",
    title: "Pleiades (Job 38:31) — Heavyweight Hoodie",
    description: "<p>“Canst thou bind the sweet influences of Pleiades?” Cozy fleece hoodie for cold-night stargazing.</p>",
    tags: ["Apparel"],
    options: [{ name: "Size", type: "size", values: ["S", "M", "L", "XL", "2XL"].map((t, i) => ({ id: 2000 + i, title: t })) }],
    variants: sizes(2000, ["S", "M", "L", "XL", "2XL"], 4800),
    images: [{ src: "/img/hero-celestial.webp", is_default: true }],
  },
  {
    id: "demo-mug",
    title: "The Heavens Declare — Ceramic Mug",
    description: "<p>Glossy ceramic mug with Psalm 19:1 wrapped in gold stars. Dishwasher and microwave safe.</p>",
    tags: ["Home"],
    options: [{ name: "Size", type: "size", values: [{ id: 3000, title: "11oz" }, { id: 3001, title: "15oz" }] }],
    variants: [
      { id: 3000, title: "11oz", price: 1600, options: [3000] },
      { id: 3001, title: "15oz", price: 1900, options: [3001] },
    ],
    images: [{ src: "/img/cross.webp", is_default: true }],
  },
  {
    id: "demo-poster",
    title: "Mazzaroth Virtues Wheel — Matte Poster",
    description: "<p>The twelve signs paired with twelve Christian virtues around the Cross. Museum-grade matte paper.</p>",
    tags: ["Art"],
    options: [{ name: "Size", type: "size", values: [{ id: 4000, title: '12″ × 18″' }, { id: 4001, title: '18″ × 24″' }] }],
    variants: [
      { id: 4000, title: '12″ × 18″', price: 2200, options: [4000] },
      { id: 4001, title: '18″ × 24″', price: 3000, options: [4001] },
    ],
    images: [{ src: "/img/zodiac-virtues.webp", is_default: true }],
  },
  {
    id: "demo-tote",
    title: "Guiding Faith, Aligning Stars — Canvas Tote",
    description: "<p>Sturdy cotton canvas tote — room for a study Bible, journal, and chart notes.</p>",
    tags: ["Accessories"],
    options: [],
    variants: [{ id: 5000, title: "One size", price: 2200, options: [] }],
    images: [{ src: "/img/brand-header.webp", is_default: true }],
  },
  {
    id: "demo-journal",
    title: "Discernment Journal — Hardcover",
    description: "<p>Hardcover lined journal for prayer, transit notes, and Scripture study.</p>",
    tags: ["Stationery"],
    options: [],
    variants: [{ id: 6000, title: "Hardcover", price: 2400, options: [] }],
    images: [{ src: "/img/bible.webp", is_default: true }],
  },
];
const DEMO_PRODUCTS = demo.map((p) => normalize(p, true));
