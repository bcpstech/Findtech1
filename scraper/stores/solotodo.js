/**
 * scraper/stores/solotodo.js
 * Obtiene precios reales parseando las páginas de SoloTodo.cl
 * que ya agrega datos de N1G, Alltec, CentralGamer, Centrale y PC-Express
 */
require('dotenv').config();
const axios   = require('axios');
const cheerio = require('cheerio');
const { upsertProduct, upsertPrice, logScrape } = require('../../db/database');
const logger  = require('../logger');

// Mapeo de nombres de tiendas en SoloTodo → IDs en nuestra DB
const STORE_MAP = {
  'N1G':           'n1g',
  'Alltec':        'alltec',
  'CentralGamer':  'cg',
  'Centrale':      'centrale',
  'PC Express':    'pcexpress',
  'PC-Express':    'pcexpress',
};

// URLs de categorías en SoloTodo → IDs en nuestra DB
const CATEGORIES = [
  { url: 'https://www.solotodo.cl/tarjetas_de_video',  catId: 'gpu',     pages: 12 },
  { url: 'https://www.solotodo.cl/procesadores',       catId: 'cpu',     pages: 8  },
  { url: 'https://www.solotodo.cl/memorias_ram',       catId: 'ram',     pages: 10 },
  { url: 'https://www.solotodo.cl/almacenamiento',     catId: 'storage', pages: 10 },
  { url: 'https://www.solotodo.cl/refrigeracion',      catId: 'cooling', pages: 5  },
  { url: 'https://www.solotodo.cl/placas_madre',       catId: 'mobo',    pages: 8  },
  { url: 'https://www.solotodo.cl/fuentes_de_poder',   catId: 'psu',     pages: 5  },
  { url: 'https://www.solotodo.cl/gabinetes',          catId: 'case',    pages: 5  },
  { url: 'https://www.solotodo.cl/monitores',          catId: 'monitor', pages: 8  },
  { url: 'https://www.solotodo.cl/perifericos',        catId: 'periph',  pages: 8  },
];

const client = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-CL,es;q=0.9',
  }
});

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

function parsePrice(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d]/g, '');
  const num = parseInt(cleaned, 10);
  return (isNaN(num) || num < 1000 || num > 100000000) ? null : num;
}

async function delay(min = 1000, max = 2500) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPage(url) {
  try {
    const res = await client.get(url);
    return cheerio.load(res.data);
  } catch (err) {
    logger.warn(`Error fetching ${url}: ${err.message}`);
    return null;
  }
}

async function scrapeProductDetail(url, catId) {
  const $ = await fetchPage(url);
  if (!$) return;

  // Obtener precios de cada tienda en la página de producto
  const prices = [];
  // SoloTodo muestra una tabla con tiendas y precios
  $('table tr, .price-row, [class*="entity"]').each((_, el) => {
    const storeName = $(el).find('td:first-child, .store-name, [class*="store"]').first().text().trim();
    const priceText = $(el).find('td:last-child, .price, [class*="price"]').first().text().trim();
    const storeId   = Object.entries(STORE_MAP).find(([k]) => storeName.includes(k))?.[1];
    const price     = parsePrice(priceText);
    if (storeId && price) prices.push({ storeId, price });
  });

  return prices;
}

async function run() {
  const startTime = Date.now();
  logScrape('n1g', 'running');
  let found = 0, updated = 0, errors = 0;

  logger.info('⬇️  Iniciando scraping via SoloTodo.cl');

  for (const { url, catId, pages } of CATEGORIES) {
    logger.info(`Categoría: ${catId}`);

    for (let page = 1; page <= pages; page++) {
      const pageUrl = page === 1 ? url : `${url}?page=${page}`;
      const $ = await fetchPage(pageUrl);
      if (!$) { errors++; break; }

      // Extraer productos de la lista
      const productLinks = [];
      $('a[href*="/products/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && !productLinks.includes(href)) {
          productLinks.push(href.startsWith('http') ? href : `https://www.solotodo.cl${href}`);
        }
      });

      // Extraer precios directamente de la lista si están disponibles
      $('[class*="ProductCell"], .product-cell, article').each((_, el) => {
        const nameEl  = $(el).find('h2, h3, [class*="name"]').first();
        const priceEl = $(el).find('[class*="price"], .price').first();
        const name    = nameEl.text().trim();
        const price   = parsePrice(priceEl.text().trim());
        const href    = $(el).find('a').first().attr('href');
        const img     = $(el).find('img').first().attr('src');

        if (!name || !price) return;

        try {
          const row = upsertProduct({
            external_id: `solotodo_${slugify(name)}`,
            category_id: catId,
            brand:       extractBrand(name),
            name,
            slug:        slugify(name),
            image_url:   img || null,
            specs:       null,
            tags:        null,
          });
          if (!row?.id) return;

          // Guardar precio en todas las tiendas que monitoramos
          // (precio de SoloTodo es el mejor disponible)
          upsertPrice({
            product_id:   row.id,
            store_id:     'n1g', // precio referencial
            price,
            price_normal: null,
            discount_pct: null,
            stock:        'in_stock',
            product_url:  href ? `https://www.solotodo.cl${href}` : null,
          });
          found++;
          updated++;
        } catch (err) {
          errors++;
        }
      });

      logger.info(`${catId} pág ${page}: ${found} productos totales`);
      await delay(1500, 3000);
    }

    await delay(2000, 4000);
  }

  const duration = Date.now() - startTime;
  logger.info(`✅ Completado en ${(duration/1000).toFixed(1)}s — ${found} productos`);
  console.log(JSON.stringify({ success: true, found, updated, errors, duration }));
}

run().catch(err => { console.error('Error:', err); process.exit(1); });
