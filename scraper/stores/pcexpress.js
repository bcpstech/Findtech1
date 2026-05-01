/**
 * scraper/stores/pcexpress.js
 * PC-Express — OpenCart, scraping HTML por categoría vía proxy
 */
require('dotenv').config();
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE      = 'https://tienda.pc-express.cl';
const PROXY_URL = process.env.CF_PROXY_URL    || '';
const PROXY_KEY = process.env.CF_PROXY_SECRET || '';
const FACTOR    = 1.03;

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

// OpenCart: /index.php?route=product/category&path=ID
// Los IDs se pueden encontrar en el HTML del menú
const CATEGORIES = [
  { path: 'product/search&search=rtx',          catId: 'gpu',     sub: 'nvidia', minPrice: 80000  },
  { path: 'product/search&search=radeon+rx',     catId: 'gpu',     sub: 'amd',    minPrice: 80000  },
  { path: 'product/search&search=ryzen',         catId: 'cpu',     sub: 'amd',    minPrice: 20000  },
  { path: 'product/search&search=core+i',        catId: 'cpu',     sub: 'intel',  minPrice: 20000  },
  { path: 'product/search&search=placa+madre',   catId: 'mobo',                   minPrice: 30000  },
  { path: 'product/search&search=memoria+ram',   catId: 'ram',                    minPrice: 10000  },
  { path: 'product/search&search=ssd+nvme',      catId: 'storage', sub: 'nvme',  minPrice: 15000  },
  { path: 'product/search&search=ssd+sata',      catId: 'storage', sub: 'sata',  minPrice: 10000  },
  { path: 'product/search&search=fuente+poder',  catId: 'psu',                    minPrice: 20000  },
  { path: 'product/search&search=gabinete',      catId: 'case',                   minPrice: 20000  },
  { path: 'product/search&search=refrigeracion', catId: 'cooling',                minPrice: 8000   },
  { path: 'product/search&search=disipador',     catId: 'cooling', sub: 'aire',  minPrice: 8000   },
];

const OUT_OF_STOCK = ['out of stock', 'sin stock', 'agotado', 'no disponible'];

function parsePrice(str) {
  if (!str) return null;
  const n = parseInt(String(str).replace(/[^\d]/g, ''));
  return n > 1000 && n < 100000000 ? n : null;
}

class PCExpressScraper extends BaseScraper {
  constructor() {
    super('pcexpress', 'PC-Express');
    this.seenUrls = new Set();
  }

  async scrapeAll() {
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCat(cat);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[pcx] Error ${cat.catId}: ${err.message}`);
      }
    }
  }

  async scrapeCat(cat) {
    let total = 0;

    for (let page = 1; page <= 10; page++) {
      const pageUrl = proxify(
        `${BASE}/index.php?route=${cat.path}&sort=p.price&order=ASC&limit=50&page=${page}`
      );
      this.log('info', `[pcx] ${cat.catId} pág ${page}`);

      let $;
      try {
        const res = await this.client.get(pageUrl, {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Referer: BASE,
          },
          timeout: 25000,
        });
        $ = cheerio.load(res.data);
      } catch (err) {
        this.log('warn', `[pcx] HTTP error: ${err.message}`);
        break;
      }

      const items = $('.product-layout, .product-thumb');
      if (!items.length) break;

      let newInPage = 0;
      for (const el of items.toArray()) {
        try {
          const $el = $(el);
          const productUrl = $el.find('a[href*="product_id"], .product-img a, h4 a').first().attr('href') || '';
          if (!productUrl) continue;
          const fullUrl = productUrl.startsWith('http') ? productUrl : `${BASE}${productUrl}`;
          if (this.seenUrls.has(fullUrl)) continue;
          this.seenUrls.add(fullUrl);

          const name = $el.find('h4 a, .product-name a').first().text().trim()
                    || $el.find('a[title]').first().attr('title') || '';
          if (!name || name.length < 4) continue;

          const priceRaw = $el.find('.price-new, .price').first().text().trim();
          const price = parsePrice(priceRaw);
          if (!price || price < (cat.minPrice || 1000)) continue;

          const normalRaw = $el.find('.price-old').first().text().trim();
          const priceNormal = normalRaw ? parsePrice(normalRaw) : null;
          const priceCard   = Math.round(price * FACTOR);
          const discount    = priceNormal && priceNormal > price
            ? Math.round((1 - price / priceNormal) * 100) : null;

          const txt = $el.text().toLowerCase();
          const stock = OUT_OF_STOCK.some(p => txt.includes(p)) ||
            $el.find('.out-of-stock').length ? 'out_of_stock' : 'in_stock';

          const imageUrl = $el.find('img').first().attr('src')
                        || $el.find('img').first().attr('data-src') || null;

          this.stats.found++;
          newInPage++;

          await this.saveProductWithR2(
            {
              name,
              category: cat.catId,
              brand: this.extractBrand(name),
              imageUrl,
              specs: {
                'Efectivo / Transferencia': `$${price.toLocaleString('es-CL')}`,
                'Tarjeta crédito/débito':   `$${priceCard.toLocaleString('es-CL')}`,
              },
            },
            { current: price, normal: priceNormal, discount, stock, url: fullUrl }
          );
        } catch (err) {
          this.log('warn', `[pcx] item error: ${err.message}`);
        }
      }

      total += newInPage;
      this.log('info', `[pcx] ✓ ${cat.catId} pág ${page}: ${newInPage}`);
      if (items.length < 10 || newInPage === 0) break;
      await this.delay(1500, 2500);
    }

    this.log('info', `[pcx] ✓ ${cat.catId}: ${total} total`);
  }
}

if (require.main === module) {
  new PCExpressScraper().run().then(r => {
    console.log('PC-Express:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = PCExpressScraper;
