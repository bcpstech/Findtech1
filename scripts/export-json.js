/**
 * scripts/export-json.js
 * Exporta DB → JSONs para el frontend.
 * Deduplicación: número de modelo (primario) + similitud de nombre (fallback).
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

// ── Extractor de número de modelo ─────────────────────────────────────────
function extractModelNumber(name) {
  const n = name.toUpperCase();

  const GPU_VARIANTS = {
    'LOW PROFILE': 'lp', 'LOW-PROFILE': 'lp', '\bLP\b': 'lp',
    'VENTUS': 'ventus', 'GAMING X': 'gamingx', 'GAMING OC': 'gamingoc',
    'EAGLE': 'eagle', 'WINDFORCE': 'windforce', 'PULSE': 'pulse',
    'NITRO': 'nitro', 'HELLHOUND': 'hellhound', 'FIGHTER': 'fighter',
    'MECH': 'mech', 'TWIN EDGE': 'twinedge', 'SHADOW': 'shadow',
    'AERO': 'aero', 'SUPRIM': 'suprim', 'TUF': 'tuf',
    'PRIME': 'prime', 'ROG STRIX': 'rogstrix', 'ARMOR': 'armor',
    'AIR BOOST': 'airboost', 'TRIO': 'trio',
  };

  // GPU patterns
  const gpuPatterns = [
    /\bRTX\s+(\d{4}(?:[\s-]*TI)?(?:[\s-]*SUPER)?)\b/,
    /\bRX\s+(\d{4}[A-Z]*)\b/,
    /\bGTX\s+(\d{4}(?:[\s-]*TI)?)\b/,
    /\bARC\s+([AB]\d{3})\b/,
  ];
  for (const pat of gpuPatterns) {
    const m = n.match(pat);
    if (m) {
      let key = m[1].replace(/\s+/g, '').toLowerCase();
      // VRAM
      const vramM = n.match(/(\d+)\s*G(?:B|DDR|GDDR)/i) || n.match(/\b(\d+)GB\b/i);
      if (vramM) key += '_' + vramM[1] + 'g';
      // Variant — normalize Low Profile first
      const nNorm = n.replace(/LOW[\s-]?PROFILE/g, 'LP');
      for (const [vname, vcode] of Object.entries(GPU_VARIANTS)) {
        if (nNorm.includes(vname)) { key += '_' + vcode; break; }
      }
      return key;
    }
  }

  // CPU patterns
  const cpuPatterns = [
    /\bI([3579])[\s-](\d{4,5}[A-Z]*)\b/,
    /\bCORE\s+ULTRA\s+([3579])\s+(\d{3}[A-Z]*)\b/,
    /\bRYZEN\s+([3579])\s+(\d{4}[A-Z0-9]*)\b/,
    /\bTHREADRIPPER\s+(?:PRO\s+)?(\d{4,5}[A-Z]*)\b/,
    /\bATHLON\s+(\w+\s*\d+\w*)\b/,
  ];
  for (const pat of cpuPatterns) {
    const m = n.match(pat);
    if (m) return m.slice(1).join('').replace(/\s+/g, '').toLowerCase();
  }

  // Mobo / SSD
  const moboM = n.match(/\b([A-Z]\d{3}[A-Z]?(?:[-][A-Z0-9]+){1,3})\b/)
             || n.match(/\b([A-Z]\d{3}[A-Z]{2,6})\b/)
             || n.match(/\b(SN\d{3}[XP]?)\b/);
  if (moboM) return moboM[1].toLowerCase();

  // Monitor patterns
  const monitorM = n.match(/\b(\d{2,3}(?:\.\d)?)\s*(?:PULGADAS|INCH|")\b/)
                || n.match(/\b([A-Z]{2,4}\d{4,6}[A-Z]*)\b/);
  if (monitorM) return 'mon_' + monitorM[1].toLowerCase().replace(/\s+/g,'');

  // Periféricos — por SKU/modelo si tiene patrón alfanumérico
  const periphM = n.match(/\b([A-Z]{2,4}[\s-]?\d{3,6}[A-Z0-9]*)\b/);
  if (periphM) return 'periph_' + periphM[1].toLowerCase().replace(/[\s-]/g,'');

  return null;
}

// ── Similitud de nombres (fallback) ───────────────────────────────────────
const STOP_WORDS = new Set([
  'placa','madre','tarjeta','video','grafica','procesador','memoria','ram',
  'fuente','poder','gabinete','refrigeracion','cooler','disco','duro',
  'solido','almacenamiento','motherboard','mainboard','gaming','gamer',
  'mb','sb','ob','box','oem','tray','retail','kit','pack',
  'socket','wifi','wireless','rgb','argb','led','sync','aura',
  'micro','mini','atx','matx','itx','eatx','gen','series','edition',
  'version','plus','pro','max','ultra','slim','pcie','nvme','sata',
  'hdmi','usb','lan','wan','type','de','la','el','en','con','para',
  'y','a','the','of','and','sin','video','turbo','cache','generacion',
  'no','si','negro','blanco','rojo','azul','gris','silver','black','white',
  'psu','gpu','cpu','certificacion','certificado','nuevo','new',
  '80plus','80','plus','w','gb','tb','mhz','ghz',
]);

const BRANDS = new Set([
  'amd','intel','asus','msi','gigabyte','asrock','nvidia','zotac','sapphire',
  'powercolor','xfx','pny','palit','gainward','inno3d','colorful',
  'kingston','corsair','crucial','gskill','samsung','micron','teamgroup',
  'seagate','western','wd','toshiba','sandisk','lexar',
  'noctua','deepcool','arctic','coolermaster','nzxt','thermalright',
  'seasonic','evga','thermaltake','antec','fractal','lianli','phanteks',
]);

function normalizeStr(s) {
  return s.toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e')
    .replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u')
    .replace(/\(.*?\)/g,' ').replace(/[^a-z0-9\s]/g,' ')
    .replace(/\s+/g,' ').trim();
}

function tokenize(name) {
  return normalizeStr(name).split(' ')
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

function extractBrand(tokens) {
  return tokens.find(t => BRANDS.has(t)) || null;
}

function shouldMerge(name1, name2, cat1, cat2) {
  // Nunca fusionar productos de categorías diferentes
  if (cat1 && cat2 && cat1 !== cat2) return false;
  const t1 = tokenize(name1);
  const t2 = tokenize(name2);
  if (!t1.length || !t2.length) return false;
  const b1 = extractBrand(t1);
  const b2 = extractBrand(t2);
  if (b1 && b2 && b1 !== b2) return false;
  const s1 = new Set(t1);
  const s2 = new Set(t2);
  const intersection = new Set([...s1].filter(x => s2.has(x)));
  const smaller = s1.size <= s2.size ? s1 : s2;
  const containment = intersection.size / smaller.size;
  const jaccard = intersection.size / new Set([...s1, ...s2]).size;
  return containment >= 0.72 || jaccard >= 0.65;
}

// ── Agrupación principal ──────────────────────────────────────────────────
function groupProducts(products) {
  // Paso 1: agrupar por número de modelo exacto (misma marca)
  const modelGroups = {};
  const noModel = [];

  for (const p of products) {
    const model = extractModelNumber(p.name);
    if (model) {
      // Incluir marca en la key para evitar fusionar modelos distintos de marcas distintas
      const brandToken = extractBrand(tokenize(p.name)) || 'generic';
      const key = `${p.category_id}_${brandToken}_${model}`;
      if (!modelGroups[key]) modelGroups[key] = [];
      modelGroups[key].push(p);
    } else {
      noModel.push(p);
    }
  }

  // Paso 2: los productos sin modelo conocido usan similitud de nombre
  const nameGrouped = [];
  const assigned = new Set();

  for (let i = 0; i < noModel.length; i++) {
    if (assigned.has(i)) continue;
    const group = [noModel[i]];
    assigned.add(i);
    for (let j = i + 1; j < noModel.length; j++) {
      if (assigned.has(j)) continue;
      if (group.some(g => shouldMerge(g.name, noModel[j].name, g.category_id, noModel[j].category_id))) {
        group.push(noModel[j]);
        assigned.add(j);
      }
    }
    nameGrouped.push(group);
  }

  // Combinar ambos grupos
  const allGroups = [
    ...Object.values(modelGroups),
    ...nameGrouped,
  ];

  return allGroups;
}

// ── Fusionar grupo en un producto ─────────────────────────────────────────
function mergeGroup(indices, pricesByProduct) {
  const allPrices = [];
  let bestProduct = null;
  let minPrice = Infinity;
  let mostSpecs = -1;

  for (const p of indices) {
    const prices = pricesByProduct[p.id] || [];
    for (const pr of prices) {
      const existing = allPrices.find(x => x.store_id === pr.store_id);
      if (!existing) {
        allPrices.push({ ...pr });
      } else if (pr.price < existing.price) {
        Object.assign(existing, pr);
      }
    }
    const groupMin = Math.min(...prices.map(x => x.price), Infinity);
    if (groupMin < minPrice) {
      minPrice = groupMin;
      bestProduct = p;
    }
    // Prefer product with more specs for better detail page
    try {
      const specCount = p.specs ? Object.keys(JSON.parse(p.specs)).length : 0;
      if (specCount > mostSpecs) {
        mostSpecs = specCount;
        bestProduct = p; // override with spec-rich product
      }
    } catch(e) {}
  }

  if (!bestProduct) bestProduct = indices[0];
  allPrices.sort((a, b) => a.price - b.price);
  return { product: bestProduct, prices: allPrices, group: indices };
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
write(path.join(OUT_DIR, 'categories.json'), categories);

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
write(path.join(OUT_DIR, 'stores.json'), stores);

// ── 3. Fecha más reciente ─────────────────────────────────────────────────
const latestDate = db.prepare('SELECT MAX(date(scraped_at)) as d FROM prices').get()?.d;

// ── 4. Precios in_stock de hoy ────────────────────────────────────────────
const hasPriceCard = db.prepare("PRAGMA table_info(prices)").all().some(c => c.name === 'price_card');
const priceCardCol = hasPriceCard ? 'p.price_card,' : '';

const todayPrices = db.prepare(`
  SELECT p.product_id, p.store_id, p.price, ${priceCardCol} p.price_normal,
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

// ── 5. Solo productos con stock ───────────────────────────────────────────
const rawProducts = db.prepare('SELECT * FROM products').all()
  .filter(p => pricesByProduct[p.id]?.length > 0);

// ── 6. Agrupar ───────────────────────────────────────────────────────────
console.log(`Agrupando ${rawProducts.length} productos...`);
const groups = groupProducts(rawProducts);
console.log(`→ ${groups.length} grupos únicos`);

// ── 7. Construir merged products ──────────────────────────────────────────
const mergedProducts = groups
  .map(group => mergeGroup(group, pricesByProduct))
  .filter(m => m.prices.length > 0);

// ── 8. Índice de productos ────────────────────────────────────────────────
const products = mergedProducts.map(({ product: p, prices }) => {
  const best = prices[0];
  const pricesMap = {};
  prices.forEach(r => { pricesMap[r.store_id] = r.price; });

  // Specs enriquecidas desde el nombre
  let specs = {};
  try { specs = p.specs ? JSON.parse(p.specs) : {}; } catch {}

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

write(path.join(OUT_DIR, 'products.json'), products);
console.log(`   → ${products.length} productos únicos (de ${rawProducts.length} con stock)`);

// ── 9. Detalle por producto ───────────────────────────────────────────────
let detailCount = 0;
for (const { product: p, prices, group } of mergedProducts) {
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

  // Merge specs from all products in group (prefer non-price specs)
  let specs = {};
  for (const gp of (group || [p])) {
    try {
      const gpSpecs = gp.specs ? JSON.parse(gp.specs) : {};
      // Count non-price keys
      const techKeys = Object.keys(gpSpecs).filter(k => {
        const l = k.toLowerCase();
        return !['efectivo','transferencia','tarjeta','webpay','crédito','credito','precio','khipu'].some(w => l.includes(w));
      });
      if (techKeys.length > Object.keys(specs).filter(k => {
        const l = k.toLowerCase();
        return !['efectivo','transferencia','tarjeta','webpay','crédito','credito','precio','khipu'].some(w => l.includes(w));
      }).length) {
        specs = gpSpecs;
      }
    } catch {}
  }
  if (!Object.keys(specs).length) {
    try { specs = p.specs ? JSON.parse(p.specs) : {}; } catch {}
  }

  const enrichedPrices = prices.map(pr => {
    const storeRow = stores.find(s => s.id === pr.store_id);

    // Reconstruir specs de precio por tienda desde price_normal
    const priceSpecs = {};
    const storeLabels = {
      'n1g':        { cash: 'Efectivo/Transferencia',   card: 'Tarjeta crédito/débito' },
      'alltec':     { cash: 'Efectivo/Transferencia',   card: 'Tarjeta crédito/débito' },
      'spdigital':  { cash: 'Transferencia / Efectivo', card: 'Webpay / Tarjeta' },
      'cg':         { cash: 'Efectivo/Transferencia',   card: 'Webpay / Tarjeta' },
      'centrale':   { cash: 'Transferencia / Efectivo', card: 'Tarjetas de Crédito / Débito' },
      'centralgamer':{ cash: 'Efectivo/Transferencia',  card: 'Webpay / Tarjeta' },
      'trulustore': { cash: 'Efectivo / Transferencia', card: 'Tarjeta crédito/débito', khipu: 'Khipu' },
      'pcexpress':  { cash: 'Efectivo/Transferencia',   card: 'Tarjeta crédito/débito' },
      'winpy':      { cash: 'Transferencia o Depósito', card: 'Otros medios de pago' },
      'dust2':      { cash: 'Efectivo/Transferencia',   card: 'Tarjeta crédito/débito' },
      'myshop':     { cash: 'Efectivo/Transferencia',   card: 'Tarjeta crédito/débito' },
      'progaming':  { cash: 'Efectivo/Transferencia',   card: 'Tarjeta crédito/débito' },
      'megabytes':  { cash: 'Efectivo/Transferencia',   card: 'Tarjeta crédito/débito' },
      'bcpstech':   { cash: 'Efectivo/Transferencia',   card: 'Tarjeta crédito/débito' },
      'mybox':      { cash: 'Efectivo/Transferencia',   card: 'Tarjeta crédito/débito' },
      'sandos':     { cash: 'Efectivo/Transferencia',   card: 'Tarjeta crédito/débito' },
      'sipo':       { cash: 'Efectivo/Transferencia',   card: 'Tarjeta crédito/débito' },
      'tytgamer':   { cash: 'Efectivo/Transferencia',   card: 'Tarjeta crédito/débito' },
      'megadrive':  { cash: 'Efectivo/Transferencia',   card: 'Tarjeta crédito/débito' },
      'infor-ingen':{ cash: 'Efectivo / Transferencia', card: 'Tarjeta crédito/débito' },
    };
    const CARD_FACTORS = {
      'spdigital': 1.045, 'cg': 1.0526, 'centralgamer': 1.0526,
      'n1g': 1.053, 'winpy': 1.053, 'alltec': 1.03,
      'centrale': 1.055, 'pcexpress': 1.03, 'bcpstech': 1.03,
    };
    const labels    = storeLabels[pr.store_id] || { cash: 'Efectivo/Transferencia', card: 'Tarjeta crédito/débito' };
    const cardPrice = (pr.price_card && pr.price_card > pr.price)
      ? pr.price_card
      : Math.round(pr.price * (CARD_FACTORS[pr.store_id] || 1.03));
    priceSpecs[labels.cash] = `$${pr.price.toLocaleString('es-CL')}`;
    if (labels.khipu) {
      priceSpecs[labels.khipu] = `$${Math.round(pr.price * 1.02).toLocaleString('es-CL')}`;
    }
    if (labels.card) {
      priceSpecs[labels.card] = `$${cardPrice.toLocaleString('es-CL')}`;
    }
    pr.price_card = cardPrice;
    if (labels.khipu) {
      pr.khipu_price = Math.round(pr.price * 1.02);
    }

    return {
      ...pr,
      price_specs:   priceSpecs,
      store_rating:  storeRow?.rating       || 0,
      review_count:  storeRow?.review_count || 0,
      store_url:     storeRow?.url          || '',
      full_url:      storeRow?.full_url     || '',
    };
  });

  write(path.join(PROD_DIR, `${p.id}.json`), {
    ...p,
    specs,
    tags:       p.tags ? JSON.parse(p.tags) : [],
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

write(path.join(OUT_DIR, 'meta.json'), {
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
