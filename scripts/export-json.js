/**
 * scripts/export-json.js
 * Lee la base de datos SQLite y genera archivos JSON en docs/data/
 * que el frontend de GitHub Pages consume directamente (sin backend).
 *
 * Genera:
 *   docs/data/categories.json
 *   docs/data/stores.json
 *   docs/data/products.json          ← todos con mejor precio
 *   docs/data/products/{id}.json     ← detalle de cada producto
 *   docs/data/meta.json              ← fecha de última actualización
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { getDb } = require('../db/database');

const OUT_DIR = path.join(__dirname, '../docs/data');
const PROD_DIR = path.join(OUT_DIR, 'products');

// Crear carpetas
fs.mkdirSync(OUT_DIR,  { recursive: true });
fs.mkdirSync(PROD_DIR, { recursive: true });

const db = getDb();

function write(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✓ ${path.relative(process.cwd(), filePath)}`);
}

// ── 1. Categorías ─────────────────────────────────────────────────────────
const categories = db.prepare(`
  SELECT c.*,
    (SELECT COUNT(*) FROM products WHERE category_id = c.id) as product_count
  FROM categories c WHERE c.parent_id IS NULL ORDER BY c.sort_order
`).all().map(cat => ({
  ...cat,
  subcategories: db.prepare(
    'SELECT * FROM categories WHERE parent_id = ? ORDER BY sort_order'
  ).all(cat.id)
}));
write(path.join(OUT_DIR, 'categories.json'), categories);

// ── 2. Tiendas ────────────────────────────────────────────────────────────
const stores = db.prepare(`
  SELECT s.*,
    (SELECT COUNT(DISTINCT p.product_id) FROM prices p WHERE p.store_id = s.id
      AND date(p.scraped_at) = (SELECT MAX(date(scraped_at)) FROM prices WHERE store_id = s.id)
    ) as products_today,
    (SELECT MAX(scraped_at) FROM prices p WHERE p.store_id = s.id) as last_scraped
  FROM stores s WHERE s.active = 1 ORDER BY s.rating DESC
`).all();
write(path.join(OUT_DIR, 'stores.json'), stores);

// ── 3. Todos los productos con mejor precio ────────────────────────────────
const latestDate = db.prepare(
  'SELECT MAX(date(scraped_at)) as d FROM prices'
).get()?.d;

const products = db.prepare(`
  SELECT
    pr.id, pr.category_id, pr.brand, pr.name, pr.slug,
    pr.image_url, pr.tags, pr.updated_at,
    MIN(p.price) as best_price,
    s.name       as best_store_name,
    s.id         as best_store_id,
    COUNT(DISTINCT p.store_id) as store_count
  FROM products pr
  LEFT JOIN prices p ON p.product_id = pr.id AND date(p.scraped_at) = ?
  LEFT JOIN stores s ON s.id = p.store_id
  GROUP BY pr.id
  HAVING best_price IS NOT NULL
  ORDER BY best_price ASC
`).all(latestDate || '').map(p => ({
  ...p,
  tags: p.tags ? JSON.parse(p.tags) : []
}));
write(path.join(OUT_DIR, 'products.json'), products);

// ── 4. Detalle de cada producto ───────────────────────────────────────────
let detailCount = 0;
const allProds = db.prepare('SELECT * FROM products').all();

for (const p of allProds) {
  const prices = db.prepare(`
    SELECT p.*, s.name as store_name, s.url as store_url,
           s.full_url, s.rating as store_rating, s.review_count
    FROM prices p JOIN stores s ON s.id = p.store_id
    WHERE p.product_id = ? AND date(p.scraped_at) = ?
    ORDER BY p.price ASC
  `).all(p.id, latestDate || '');

  if (!prices.length) continue; // no exportar sin precios

  const history = db.prepare(`
    SELECT p.store_id, s.name as store_name,
           date(p.scraped_at) as date, MIN(p.price) as price
    FROM prices p JOIN stores s ON s.id = p.store_id
    WHERE p.product_id = ? AND p.scraped_at >= datetime('now', '-30 days')
    GROUP BY p.store_id, date(p.scraped_at)
    ORDER BY date ASC
  `).all(p.id);

  write(path.join(PROD_DIR, `${p.id}.json`), {
    ...p,
    specs:   p.specs   ? JSON.parse(p.specs)   : null,
    tags:    p.tags    ? JSON.parse(p.tags)     : [],
    prices,
    history,
    scraped_at: latestDate
  });
  detailCount++;
}

// ── 5. Meta ───────────────────────────────────────────────────────────────
const lastRuns = db.prepare(`
  SELECT store_id, status, products_updated, errors_count, finished_at
  FROM scrape_logs ORDER BY started_at DESC LIMIT 10
`).all();

write(path.join(OUT_DIR, 'meta.json'), {
  last_update:    latestDate,
  generated_at:   new Date().toISOString(),
  total_products: products.length,
  total_stores:   stores.length,
  last_runs:      lastRuns
});

console.log(`\n✅ Exportación completa:`);
console.log(`   ${categories.length} categorías`);
console.log(`   ${stores.length} tiendas`);
console.log(`   ${products.length} productos (índice)`);
console.log(`   ${detailCount} productos (detalle)`);
console.log(`   Fecha de datos: ${latestDate}`);
