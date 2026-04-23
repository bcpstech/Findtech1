/**
 * scraper/stores/solotodo.js
 * Obtiene precios reales usando la API pública de SoloTodo.cl
 */
require('dotenv').config();
const axios   = require('axios');
const { upsertProduct, upsertPrice, logScrape } = require('../../db/database');
const logger  = require('../logger');

// IDs de tiendas en SoloTodo → IDs en nuestra DB
const STORE_MAP = {
  14: 'n1g',
  6:  'alltec',
  43: 'cg',
  29: 'centrale',
  17: 'pcexpress',
};

// IDs de categorías en SoloTodo → IDs en nuestra DB
const CATEGORY_MAP = {
  2:  'gpu',
  3:  'cpu',
  5:  'ram',
  7:  'storage',
  11: 'cooling',
  4:  'mobo',
  8:  'psu',
  9:  'case',
  10: 'monitor',
  12: 'periph',
};

const client = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; FindTech.cl/1.0)',
    'Accept': 'application/json',
  }
});

function slugify(text) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

function extractBrand(name) {
  const brands = ['NVIDIA','AMD','Intel','Samsung','WD','Seagate','Corsair',
    'G.Skill','Kingston','Crucial','ASUS','MSI','Gigabyte','ASRock',
    'Noctua','Arctic','Seasonic','Cooler Master','NZXT','LG','BenQ',
    'AOC','Acer','Logitech','Razer','SteelSeries','HyperX'];
  return brands.find(b => name.toUpperCase().includes(b.toUpperCase())) || 'Genérico';
}

async function fetchJSON(url) {
  try {
    const res = await client.get(url);
    return res.data;
  } catch (err) {
    logger.warn(`Error fetching ${url}: ${err.message}`);
    return null;
  }
}

async function delay(min = 500, max = 1500) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  const startTime = Date.now();
  const logId = logScrape('n1g', 'running'); // usamos n1g como referencia
  let found = 0, updated = 0, errors = 0;

  logger.info('⬇️  Iniciando scraping via SoloTodo API');

  for (const [soloTodoCatId, catId] of Object.entries(CATEGORY_MAP)) {
    logger.info(`Categoría: ${catId} (SoloTodo ID: ${soloTodoCatId})`);
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 5) {
      const url = `https://www.solotodo.cl/api/products/?category=${soloTodoCatId}&page_size=50&page=${page}&format=json`;
      const data = await fetchJSON(url);

      if (!data || !data.results) { hasMore = false; break; }

      for (const product of data.results) {
        try {
          // Obtener precios del producto
          const entitiesUrl = `https://www.solotodo.cl/api/products/${product.id}/entities/?format=json`;
          const entitiesData = await fetchJSON(entitiesUrl);
          if (!entitiesData) continue;

          const entities = entitiesData.results || entitiesData;
          if (!entities.length) continue;

          // Filtrar solo nuestras tiendas
          const relevantEntities = entities.filter(e => STORE_MAP[e.store?.id]);
          if (!relevantEntities.length) continue;

          // Guardar producto
          const external_id = `solotodo_${product.id}`;
          const row = upsertProduct({
            external_id,
            category_id: catId,
            brand:       product.brand?.name || extractBrand(product.name),
            name:        product.name,
            slug:        slugify(product.name),
            image_url:   product.thumbnail_url || null,
            specs:       product.specs ? JSON.stringify(product.specs) : null,
            tags:        null,
          });

          if (!row?.id) continue;

          // Guardar precio por cada tienda
          for (const entity of relevantEntities) {
            const storeId = STORE_MAP[entity.store.id];
            const price = parseInt(
              entity.active_registry?.cell_monthly_payment ||
              entity.active_registry?.normal_price
            );
            if (!price || price < 1000) continue;

            upsertPrice({
              product_id:   row.id,
              store_id:     storeId,
              price,
              price_normal: null,
              discount_pct: null,
              stock:        entity.condition === 'https://schema.org/InStock' ? 'in_stock' : 'out_of_stock',
              product_url:  entity.external_url || null,
            });
            updated++;
          }
          found++;
        } catch (err) {
          errors++;
          logger.warn(`Error procesando ${product.name}: ${err.message}`);
        }

        await delay(300, 800);
      }

      hasMore = !!data.next;
      page++;
      await delay(1000, 2000);
    }
  }

  const duration = Date.now() - startTime;
  logger.info(`✅ Completado en ${(duration/1000).toFixed(1)}s — ${found} productos, ${updated} precios`);
  return { success: true, found, updated, errors, duration };
}

run()
  .then(r => { console.log('SoloTodo API:', r); process.exit(0); })
  .catch(err => { console.error('Error fatal:', err); process.exit(1); });
