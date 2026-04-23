/**
 * scraper/stores/via-worker.js
 * Llama al Cloudflare Worker que hace el scraping
 * sin ser bloqueado por las tiendas
 */
require('dotenv').config();
const axios  = require('axios');
const { upsertProduct, upsertPrice, logScrape } = require('../../db/database');
const logger = require('../logger');

const WORKER_URL    = process.env.CF_WORKER_URL;    // https://findtech-scraper.TU.workers.dev
const SECRET_TOKEN  = process.env.CF_SECRET_TOKEN;  // token secreto configurado en el Worker

const STORES = ['n1g', 'alltec', 'cg', 'centrale', 'pcexpress'];
const CATS   = ['gpu', 'cpu', 'ram', 'storage', 'cooling', 'mobo', 'psu', 'case', 'monitor', 'periph'];

function slugify(text) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 100);
}

function extractBrand(name) {
  const brands = ['NVIDIA','AMD','Intel','Samsung','WD','Seagate','Corsair',
    'G.Skill','Kingston','Crucial','ASUS','MSI','Gigabyte','ASRock',
    'Noctua','Arctic','Seasonic','Cooler Master','NZXT','LG','BenQ','AOC'];
  return brands.find(b => name.toUpperCase().includes(b.toUpperCase())) || 'Genérico';
}

async function delay(ms = 500) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  if (!WORKER_URL) {
    console.error('❌ CF_WORKER_URL no configurado en variables de entorno');
    process.exit(1);
  }

  const startTime = Date.now();
  logScrape('n1g', 'running');
  let found = 0, updated = 0, errors = 0;

  logger.info(`⬇️  Scraping via Cloudflare Worker: ${WORKER_URL}`);

  for (const store of STORES) {
    logger.info(`Tienda: ${store}`);

    for (const cat of CATS) {
      try {
        const url = `${WORKER_URL}/scrape?store=${store}&cat=${cat}&secret=${SECRET_TOKEN}`;
        const res = await axios.get(url, { timeout: 30000 });
        const data = res.data;

        if (data.error) {
          logger.warn(`Error ${store}/${cat}: ${data.error}`);
          errors++;
          continue;
        }

        const products = data.products || [];
        logger.info(`${store}/${cat}: ${products.length} productos`);

        for (const p of products) {
          if (!p.name || !p.price) continue;

          const row = upsertProduct({
            external_id: `${store}_${slugify(p.name)}`,
            category_id: cat,
            brand:       extractBrand(p.name),
            name:        p.name,
            slug:        slugify(p.name),
            image_url:   p.img || null,
            specs:       null,
            tags:        null,
          });

          if (!row?.id) continue;

          upsertPrice({
            product_id:   row.id,
            store_id:     store,
            price:        p.price,
            price_normal: p.normal || null,
            discount_pct: p.discount || null,
            stock:        'in_stock',
            product_url:  p.url || null,
          });

          found++;
          updated++;
        }
      } catch (err) {
        errors++;
        logger.warn(`Error llamando Worker ${store}/${cat}: ${err.message}`);
      }

      await delay(300);
    }

    await delay(1000);
  }

  const duration = Date.now() - startTime;
  logger.info(`✅ Completado en ${(duration/1000).toFixed(1)}s — ${found} productos`);
  console.log(JSON.stringify({ success: true, found, updated, errors, duration }));
}

run().catch(err => { console.error('Error:', err); process.exit(1); });
