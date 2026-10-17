// Builds the store's products in the Christian Astrology Printify shop from the artwork in private/print-art/.
//   node --env-file=.env scripts/printify-products.js            → dry run: checks everything, changes nothing
//   node --env-file=.env scripts/printify-products.js --create   → uploads artwork, creates + publishes the products
// Safe to re-run: products whose title already exists in the shop are skipped.
// The shop is shared with cheatingpsychology, so every product here carries PRINTIFY_PRODUCT_TAG (the site only
// sells tagged products) and the script only ever looks at, skips or creates products with that tag.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.printify.com/v1";
const TOKEN = process.env.PRINTIFY_API_TOKEN;
const SHOP = process.env.PRINTIFY_SHOP_ID;
const SITE = (process.env.APP_URL || "").startsWith("https://") ? process.env.APP_URL : "https://christianastrology.org";
const CREATE = process.argv.includes("--create");
const TAG = (process.env.PRINTIFY_PRODUCT_TAG || "").trim().toLowerCase();
const ART = new URL("../private/print-art/", import.meta.url).pathname;

async function pf(path, { method = "GET", body } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "christianastrology-products" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

const SIZES = ["S", "M", "L", "XL", "2XL"];
const PRODUCTS = [
  {
    title: "He Counts the Stars — Unisex Tee",
    blueprint: 12, provider: 29, art: "tee-he-counts-the-stars.png", position: "front",
    pick: (v) => v.options?.color === "Navy" && SIZES.includes(v.options?.size), price: () => 2800,
    tags: ["Apparel"],
    description: "<p>“He telleth the number of the stars; he calleth them all by their names.” — Psalm 147:4</p><p>Soft, lightweight Bella+Canvas 3001 in navy, printed with gold lettering and a sweep of stars.</p><ul><li>100% Airlume combed and ring-spun cotton (heather colors contain polyester)</li><li>Relaxed unisex fit, true to size</li><li>Printed to order in the USA</li></ul>",
  },
  {
    title: "Pleiades (Job 38:31) — Heavyweight Hoodie",
    blueprint: 77, provider: 29, art: "hoodie-pleiades.png", position: "front",
    pick: (v) => v.options?.color === "Navy" && SIZES.includes(v.options?.size), price: (v) => (v.options.size === "2XL" ? 5200 : 4800),
    tags: ["Apparel"],
    description: "<p>“Canst thou bind the sweet influences of Pleiades?” — Job 38:31</p><p>The Seven Sisters, drawn from their true positions in the sky, on a cozy Gildan 18500 hoodie for cold-night stargazing.</p><ul><li>50% cotton, 50% polyester medium-heavy fleece</li><li>Double-lined hood, front pouch pocket</li><li>Printed to order in the USA</li></ul>",
  },
  {
    title: "The Heavens Declare — Ceramic Mug",
    blueprint: 478, provider: 39, art: "mug-heavens-declare.png", position: "front",
    pick: () => true, price: (v) => (/15/.test(v.title) ? 1900 : 1600),
    tags: ["Home"],
    description: "<p>“The heavens declare the glory of God; and the firmament sheweth his handywork.” — Psalm 19:1</p><p>A full wrap of midnight sky and gold lettering on both sides.</p><ul><li>Glossy white ceramic, 11oz or 15oz</li><li>Dishwasher and microwave safe</li><li>Printed to order in the USA</li></ul>",
  },
  {
    title: "The Heavens Declare — Mazzaroth Poster",
    blueprint: 282, provider: 99, art: "poster-heavens-declare.png", position: "front",
    pick: (v) => [43138, 101113, 43150].includes(v.id), price: (v) => ({ 43138: 2200, 101113: 3000, 43150: 4200 })[v.id],
    tags: ["Art"],
    description: "<p>The twelve signs of the Mazzaroth circling the Cross, under Psalm 19:1.</p><ul><li>Museum-grade matte paper, 175 gsm</li><li>12″ × 18″, 16″ × 24″ or 24″ × 36″</li><li>Frame not included · printed to order in the USA</li></ul>",
  },
  {
    title: "Guiding Faith, Aligning Stars — Canvas Tote",
    blueprint: 609, provider: 99, art: "tote-guiding-faith.png", position: "front",
    pick: (v) => v.id === 71926, price: () => 3400, // organic tote costs ~$20.69; $34 keeps Saint 30% off above cost
    tags: ["Accessories"],
    description: "<p>“Let them be for signs, and for seasons, and for days, and years.” — Genesis 1:14</p><p>A sturdy organic canvas tote with room for a study Bible, journal and chart notes.</p><ul><li>100% organic cotton canvas, natural color</li><li>Printed to order in the USA</li></ul>",
  },
  {
    title: "Discernment Journal — Hardcover",
    blueprint: 485, provider: 28, art: "journal-discernment.png", position: "front",
    pick: () => true, price: () => 2600,
    tags: ["Stationery"],
    description: "<p>“Prove all things; hold fast that which is good.” — 1 Thessalonians 5:21</p><p>A lined hardcover journal for prayer, transit notes and Scripture study.</p><ul><li>150 lined pages, matte hardcover</li><li>Printed to order in the USA</li></ul>",
  },
];

const money = (c) => `$${(c / 100).toFixed(2)}`;

async function main() {
  if (!TOKEN || !SHOP) throw new Error("Set PRINTIFY_API_TOKEN and PRINTIFY_SHOP_ID in .env first.");
  const shops = await pf("/shops.json");
  const shop = shops.find((s) => String(s.id) === String(SHOP));
  if (!shop) throw new Error(`Shop ${SHOP} isn't in this Printify account.`);
  const ownShop = /christian\s*astrology/i.test(shop.title);
  if (!ownShop && !TAG) throw new Error(`Shop "${shop.title}" is shared with another site: set PRINTIFY_PRODUCT_TAG so this site's products stay separate.`);
  console.log(`Shop ${shop.id} "${shop.title}" (${shop.sales_channel})${TAG ? `, tag "${TAG}"` : ""} — ${CREATE ? "CREATING" : "dry run"}\n`);

  const existing = new Set();
  for (let page = 1; ; page++) {
    const j = await pf(`/shops/${SHOP}/products.json?limit=50&page=${page}`);
    for (const p of j.data || []) if (!TAG || (p.tags || []).some((t) => String(t).toLowerCase() === TAG)) existing.add(p.title); // only ever our own products
    if (!j.last_page || page >= j.last_page) break;
  }

  for (const item of PRODUCTS) {
    const { variants } = await pf(`/catalog/blueprints/${item.blueprint}/print_providers/${item.provider}/variants.json`);
    const chosen = variants.filter(item.pick);
    if (!chosen.length) throw new Error(`${item.title}: no matching variants`);
    const art = readFileSync(join(ART, item.art));
    console.log(`• ${item.title}\n  ${chosen.length} variants: ${chosen.map((v) => `${v.title} ${money(item.price(v))}`).join(", ")}`);
    if (existing.has(item.title)) {
      console.log("  already in the shop, skipped\n");
      continue;
    }
    if (!CREATE) {
      console.log(`  artwork ${item.art} (${Math.round(art.length / 1024)} KB) ok\n`);
      continue;
    }
    const upload = await pf("/uploads/images.json", { method: "POST", body: { file_name: item.art, contents: art.toString("base64") } });
    const product = await pf(`/shops/${SHOP}/products.json`, {
      method: "POST",
      body: {
        title: item.title,
        description: item.description,
        tags: TAG ? [...item.tags, TAG] : item.tags,
        blueprint_id: item.blueprint,
        print_provider_id: item.provider,
        variants: chosen.map((v) => ({ id: v.id, price: item.price(v), is_enabled: true })),
        print_areas: [
          {
            variant_ids: chosen.map((v) => v.id),
            placeholders: [{ position: item.position, images: [{ id: upload.id, x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
          },
        ],
      },
    });
    // Margin check: price vs Printify's cost for each variant (before shipping, which the customer pays).
    for (const v of product.variants.filter((x) => x.is_enabled)) {
      const fee = Math.round(v.price * 0.029 + 30); // Stripe card fee
      const profit = v.price - v.cost - fee;
      console.log(`  ${v.title}: price ${money(v.price)} − cost ${money(v.cost)} − card fee ${money(fee)} = ${profit >= 0 ? "" : "LOSS "}${money(profit)}`);
    }
    if (!ownShop) {
      // Shared shop: skip "publish", which notifies whatever else is connected to the shop (the other site).
      console.log(`  created: ${product.id}\n`);
      continue;
    }
    await pf(`/shops/${SHOP}/products/${product.id}/publish.json`, {
      method: "POST",
      body: { title: true, description: true, images: true, variants: true, tags: true, keyFeatures: true, shipping_template: true },
    });
    await pf(`/shops/${SHOP}/products/${product.id}/publishing_succeeded.json`, {
      method: "POST",
      body: { external: { id: String(product.id), handle: `${SITE}/store/${product.id}` } },
    });
    console.log(`  created + published: ${product.id}\n`);
  }
}

main().catch((e) => {
  console.error("\n✗", e.message);
  process.exit(1);
});
