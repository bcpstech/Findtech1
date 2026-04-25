/**
 * scripts/export-json.js
 * DEDUPLICACIÓN: productos del mismo modelo físico se fusionan
 * aunque vengan de tiendas distintas con nombres ligeramente diferentes.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { getDb } = require('../db/database');

const OUT_DIR  = path.join(__dirname, '../docs/data');
const PROD_DIR = path.join(OUT_DIR, 'products');
fs.mkdirSync(OUT_DIR,  { recursive: true });
fs.mkdirSync(PROD_DIR, { recursive: true });
const db = getDb();

function write(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✓ ${path.relative(process.cwd(), filePath)}`);
}

// ── Normalizador de modelo ────────────────────────────────────────────────
const NOISE_WORDS = [
  'placa madre','placa-madre','motherboard','mainboard',
  'tarjeta de video','tarjeta grafica','tarjeta gráfica','tarjeta video',
  'procesador','processor','memoria ram','memory ram','memoria',
  'disco duro','disco solido','disco sólido','almacenamiento',
  'fuente de poder','fuente poder','fuente de alimentacion',
  'gabinete','case','torre','refrigeracion','refrigeración','cooler','disipador',
  'm\\.b\\.','m\\.b','gpu','cpu','psu','ssd','hdd','nvme',
  'wi-fi','wifi','wi fi','wireless',
  'aura sync','aura','rgb','argb',
  'micro-atx','micro atx','matx','mini-itx','mini itx','atx','eatx',
  'am5','am4','lga1700','lga1851','lga1200','lga1151',
  'ddr5','ddr4','ddr3','pcie 5\\.0','pcie 4\\.0','pcie 3\\.0','pcie','pcle',
  'gen 5','gen 4','gen 3',
  '\\(am5\\)','\\(am4\\)','\\(lga.*?\\)',
  'quad-core','hexa-core','octa-core','dual-core',
  'alta gama','gaming','gamer',
];
const NOISE_RE = new RegExp('(' + NOISE_WORDS.map(w => `\\b${w}\\b`).join('|') + ')','gi');

function modelKey(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[''"`]/g,'')
    .replace(NOISE_RE,' ')
    .replace(/\s*\(.*?\)\s*/g,' ')
    .replace(/[^a-z0-9\-\.\/\s]/g,' ')
    .replace(/\s+/g,' ').trim()
    .split(' ').filter(w => w.length > 1).slice(0,4).join(' ');
}

// ── 1. Categorías ─────────────────────────────────────────────────────────
const categories = db.prepare(`
  SELECT c.*,
    (SELECT COUNT(*) FROM products WHERE category_id = c.id) as product_count
  FROM categories c WHERE c.parent_id IS NULL ORDER BY c.sort_order
`).all().map(cat => ({
  ...cat,
  subcategories: db.prepare('SELECT * FROM categories WHERE parent_id = ? ORDER BY sort_order').all(cat.id)
}));
write(path.join(OUT_DIR,'categories.json'), categories);

// ── 2. Tiendas ────────────────────────────────────────────────────────────
const stores = db.prepare(`
  SELECT s.*,
    (SELECT COUNT(DISTINCT p.product_id) FROM prices p WHERE p.store_id = s.id
      AND date(p.scraped_at) = (SELECT MAX(date(scraped_at)) FROM prices WHERE store_id = s.id)
      AND p.stock != 'out_of_stock'
    ) as products_today,
    (SELECT MAX(scraped_at) FROM prices p WHERE p.store_id = s.id) as last_scraped
  FROM stores s WHERE s.active = 1 ORDER BY s.rating DESC
`).all();
write(path.join(OUT_DIR,'stores.json'), stores);

// ── 3. Fecha más reciente ─────────────────────────────────────────────────
const latestDate = db.prepare('SELECT MAX(date(scraped_at)) as d FROM prices').get()?.d;

// ── 4. Precios de hoy (solo in_stock) ────────────────────────────────────
const todayPrices = db.prepare(`
  SELECT p.product_id, p.store_id, p.price, p.price_normal,
         p.discount_pct, p.stock, p.product_url, s.name as store_name
  FROM prices p
  JOIN stores s ON s.id = p.store_id
  WHERE date(p.scraped_at) = ?
    AND p.stock != 'out_of_stock'
  ORDER BY p.price ASC
`).all(latestDate || '');

const pricesByProduct = {};
for (const row of todayPrices) {
  if (!pricesByProduct[row.product_id]) pricesByProduct[row.product_id] = [];
  pricesByProduct[row.product_id].push(row);
}

// ── 5. Deduplicar por modelo ──────────────────────────────────────────────
const rawProducts = db.prepare('SELECT * FROM products').all();
const modelGroups = {};

for (const p of rawProducts) {
  const prices = pricesByProduct[p.id] || [];
  if (!prices.length) continue;

  const key = modelKey(p.name);
  if (!key || key.length < 3) continue;

  if (!modelGroups[key]) {
    modelGroups[key] = { product: p, prices: [], minPrice: Infinity };
  }
  const group = modelGroups[key];

  for (const pr of prices) {
    const existing = group.prices.find(x => x.store_id === pr.store_id);
    if (!existing) {
      group.prices.push(pr);
    } else if (pr.price < existing.price) {
      Object.assign(existing, pr);
    }
  }

  const groupMin = Math.min(...group.prices.map(x => x.price));
  if (groupMin < group.minPrice) {
    group.minPrice = groupMin;
    group.product  = p;
  }
}

// ── 6. Índice de productos ────────────────────────────────────────────────
const products = Object.values(modelGroups).map(({ product: p, prices }) => {
  prices.sort((a,b) => a.price - b.price);
  const best = prices[0];
  const pricesMap = {};
  prices.forEach(r => { pricesMap[r.store_id] = r.price; });
  return {
    id:              p.id,
    category_id:     p.category_id,
    brand:           p.brand,
    name:            p.name,
    slug:            p.slug,
    image_url:       p.image_url,
    tags:            p.tags  ? JSON.parse(p.tags)  : [],
    updated_at:      p.updated_at,
    best_price:      best.price,
    best_store_name: best.store_name,
    best_store_id:   best.store_id,
    store_count:     prices.length,
    prices:          pricesMap,
    url:             best.product_url || null,
  };
}).sort((a,b) => a.best_price - b.best_price);

write(path.join(OUT_DIR,'products.json'), products);
console.log(`   → ${products.length} productos únicos (de ${rawProducts.length} en DB)`);

// ── 7. Detalle por producto ───────────────────────────────────────────────
let detailCount = 0;
for (const { product: p, prices } of Object.values(modelGroups)) {
  if (!prices.length) continue;

  const history = db.prepare(`
    SELECT p.store_id, s.name as store_name,
           date(p.scraped_at) as date, MIN(p.price) as price
    FROM prices p JOIN stores s ON s.id = p.store_id
    WHERE p.product_id = ?
      AND p.scraped_at >= datetime('now', '-30 days')
      AND p.stock != 'out_of_stock'
    GROUP BY p.store_id, date(p.scraped_at)
    ORDER BY date ASC
  `).all(p.id);

  const enrichedPrices = prices.map(pr => {
    const storeRow = stores.find(s => s.id === pr.store_id);
    return {
      ...pr,
      store_rating:  storeRow?.rating       || 0,
      review_count:  storeRow?.review_count || 0,
      store_url:     storeRow?.url          || '',
      full_url:      storeRow?.full_url     || '',
    };
  });

  write(path.join(PROD_DIR, `${p.id}.json`), {
    ...p,
    specs:      p.specs  ? JSON.parse(p.specs)  : null,
    tags:       p.tags   ? JSON.parse(p.tags)   : [],
    prices:     enrichedPrices,
    history,
    scraped_at: latestDate,
  });
  detailCount++;
}

// ── 8. Meta ───────────────────────────────────────────────────────────────
const lastRuns = db.prepare(
  'SELECT store_id, status, products_updated, errors_count, finished_at FROM scrape_logs ORDER BY started_at DESC LIMIT 20'
).all();

write(path.join(OUT_DIR,'meta.json'), {
  last_update:    latestDate,
  generated_at:   new Date().toISOString(),
  total_products: products.length,
  total_stores:   stores.length,
  last_runs:      lastRuns,
});

console.log(`\n✅ Exportación completa:`);
console.log(`   ${categories.length} categorías`);
console.log(`   ${stores.length} tiendas`);
console.log(`   ${products.length} productos únicos`);
console.log(`   ${detailCount} productos con detalle`);
console.log(`   Fecha: ${latestDate}`);
