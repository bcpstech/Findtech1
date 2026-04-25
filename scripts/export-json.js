/**
 * scripts/export-json.js
 * Deduplicación por similitud de nombre (Jaccard + containment + marca).
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

// ── Similitud de nombres ──────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'placa','madre','tarjeta','video','grafica','procesador','memoria','ram',
  'fuente','poder','gabinete','refrigeracion','cooler','disco','duro',
  'solido','almacenamiento','motherboard','mainboard','gaming','gamer',
  'mb','sb','ob','box','oem','tray','retail','kit','pack',
  'socket','wifi','wireless','rgb','argb','led','sync','aura',
  'micro','mini','atx','matx','itx','eatx',
  'gen','series','edition','version','plus','pro','max','ultra','slim',
  'pcie','nvme','sata','hdmi','usb','lan','wan','type',
  'de','la','el','en','con','para','y','a','the','of','and',
  'twin','edge','ventus','black','white','oc','strix','tuf','prime',
  'hero','carbon','extreme','apex','formula','impact','unify','wraith','stealth',
]);

const BRANDS = new Set([
  'amd','intel','asus','msi','gigabyte','asrock','nvidia','zotac','sapphire',
  'powercolor','xfx','pny','palit','gainward','inno3d','colorful','galax',
  'kingston','corsair','crucial','gskill','samsung','micron','teamgroup',
  'seagate','western','wd','toshiba','sandisk','lexar',
  'noctua','bequiet','deepcool','arctic','coolermaster','nzxt','thermalright',
  'seasonic','evga','thermaltake','antec','fractal','lianli','phanteks',
]);

function normalizeStr(s) {
  return s.toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e')
    .replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u')
    .replace(/\(.*?\)/g,' ')
    .replace(/[^a-z0-9\s]/g,' ')
    .replace(/\s+/g,' ').trim();
}

function tokenize(name) {
  return normalizeStr(name).split(' ').filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

function extractBrand(tokens) {
  return tokens.find(t => BRANDS.has(t)) || null;
}

function shouldMerge(name1, name2) {
  const t1 = tokenize(name1);
  const t2 = tokenize(name2);
  if (!t1.length || !t2.length) return false;

  // Marcas distintas → nunca fusionar
  const b1 = extractBrand(t1);
  const b2 = extractBrand(t2);
  if (b1 && b2 && b1 !== b2) return false;

  const s1 = new Set(t1);
  const s2 = new Set(t2);
  const intersection = new Set([...s1].filter(x => s2.has(x)));
  const union = new Set([...s1, ...s2]);

  // Containment: nombre corto está contenido en nombre largo
  const smaller = s1.size <= s2.size ? s1 : s2;
  const containment = intersection.size / smaller.size;

  // Jaccard: similitud general
  const jaccard = intersection.size / union.size;

  return containment >= 0.80 || jaccard >= 0.70;
}

// Agrupar con unión transitiva (si A~B y B~C, entonces A~B~C)
function groupByName(products) {
  const groups = [];       // cada grupo es un array de índices
  const assigned = new Set();

  for (let i = 0; i < products.length; i++) {
    if (assigned.has(i)) continue;
    const group = [i];
    assigned.add(i);

    for (let j = i + 1; j < products.length; j++) {
      if (assigned.has(j)) continue;
      // Comparar con cualquier miembro ya en el grupo
      const merges = group.some(gi =>
        shouldMerge(products[gi].name, products[j].name)
      );
      if (merges) {
        group.push(j);
        assigned.add(j);
      }
    }
    groups.push(group);
  }
  return groups;
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
  ).all(cat.id),
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

// ── 5. Solo productos con stock hoy ──────────────────────────────────────
const rawProducts = db.prepare('SELECT * FROM products').all()
  .filter(p => pricesByProduct[p.id]?.length > 0);

// ── 6. Agrupar por similitud de nombre ───────────────────────────────────
console.log(`Agrupando ${rawProducts.length} productos por similitud de nombre...`);
const nameGroups = groupByName(rawProducts);
console.log(`→ ${nameGroups.length} grupos únicos`);

// ── 7. Construir productos fusionados ────────────────────────────────────
const mergedProducts = nameGroups.map(indices => {
  // Recolectar todos los precios del grupo, sin duplicar tiendas
  const allPrices = [];
  let bestProduct = null;
  let minPrice = Infinity;

  for (const idx of indices) {
    const p = rawProducts[idx];
    const prices = pricesByProduct[p.id] || [];
    for (const pr of prices) {
      const existing = allPrices.find(x => x.store_id === pr.store_id);
      if (!existing) {
        allPrices.push({ ...pr });
      } else if (pr.price < existing.price) {
        Object.assign(existing, pr);
      }
    }
    const groupMin = Math.min(...prices.map(x => x.price));
    if (groupMin < minPrice) {
      minPrice = groupMin;
      bestProduct = p;
    }
  }

  allPrices.sort((a, b) => a.price - b.price);
  return { product: bestProduct, prices: allPrices };
});

// ── 8. Índice de productos ────────────────────────────────────────────────
const products = mergedProducts.map(({ product: p, prices }) => {
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
    tags:            p.tags ? JSON.parse(p.tags) : [],
    updated_at:      p.updated_at,
    best_price:      best.price,
    best_store_name: best.store_name,
    best_store_id:   best.store_id,
    store_count:     prices.length,
    prices:          pricesMap,
    url:             best.product_url || null,
  };
}).sort((a, b) => a.best_price - b.best_price);

write(path.join(OUT_DIR,'products.json'), products);
console.log(`   → ${products.length} productos únicos (de ${rawProducts.length} con stock)`);

// ── 9. Detalle por producto ───────────────────────────────────────────────
let detailCount = 0;
for (const { product: p, prices } of mergedProducts) {
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
    specs:      p.specs ? JSON.parse(p.specs) : null,
    tags:       p.tags  ? JSON.parse(p.tags)  : [],
    prices:     enrichedPrices,
    history,
    scraped_at: latestDate,
  });
  detailCount++;
}

// ── 10. Meta ──────────────────────────────────────────────────────────────
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
