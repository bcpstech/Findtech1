/**
 * scraper/stores/pcexpress.js
 * PC-Express — OpenCart
 * URL base: tienda.pc-express.cl/index.php?route=product/category&path=ID
 * Path 460 = Componentes para PC (verificado)
 * Subcategorías encontradas navegando el sitio
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

// path=460 = Componentes para PC
// Subcategorías: intentamos con path=460_ID (OpenCart anida así)
// También intentamos búsqueda por texto como fallback
const SEARCHES = [
  { q: 'procesador ryzen',    catId: 'cpu',     sub: 'amd'    },
  { q: 'procesador intel',    catId: 'cpu',     sub: 'intel'  },
  { q: 'tarjeta video rtx',   catId: 'gpu',     sub: 'nvidia' },
  { q: 'tarjeta video radeon', catId: 'gpu',    sub: 'amd'    },
  { q: 'placa madre',         catId: 'mobo'                   },
  { q: 'memoria ram ddr',     catId: 'ram'                    },
  { q: 'ssd nvme',            catId: 'storage', sub: 'nvme'   },
  { q: 'ssd sata',            catId: 'storage', sub: 'sata'   },
  { q: 'fuente poder',        catId: 'psu'                    },
  { q: 'gabinete torre',      catId: 'case'                   },
  { q: 'refrigeracion liquida', catId: 'cooling', sub: 'liquida' },
  { q: 'disipador cooler',    catId: 'cooling', sub: 'aire'   },
];

const OUT_OF_STOCK = ['sin stock', 'agotado', 'out of stock', 'no disponible'];

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
    for (const search of SEARCHES) {
      try {
        await this.scrapeSearch(search);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[pcx] Error ${search.catId}: ${err.message}`);
      }
    }
  }

  async scrapeSearch(search) {
    let page = 1; let total = 0;
    while (page <= 5) {
      const searchUrl = proxify(
        `${BASE}/index.php?route=product/search&search=${encodeURIComponent(search.q)}&limit=50&page=${page}`
      );
      this.log('info', `[pcx] "${search.q}" pág ${page}`);
      let $;
      try {
        const res = await this.client.get(searchUrl, {
          headers: { Accept: 'text/html', 'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: BASE },
          timeout: 25000,
        });
        $ = cheerio.load(res.data);
      } catch (err) { this.log('warn', `[pcx] HTTP: ${err.message}`); break; }

      // OpenCart: .product-layout o .product-thumb
      const items = $('.product-layout, .product-thumb');
      if (!items.length) { this.log('info', `[pcx] Sin productos pág ${page}`); break; }

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
          if (!price) continue;

          const normalRaw = $el.find('.price-old').first().text().trim();
          const priceNormal = normalRaw ? parsePrice(normalRaw) : null;
          const priceCard = Math.round(price * FACTOR);
          const discount = priceNormal && priceNormal > price ? Math.round((1 - price / priceNormal) * 100) : null;
          const txt = $el.text().toLowerCase();
          const stock = OUT_OF_STOCK.some(p => txt.includes(p)) || $el.find('.out-of-stock').length ? 'out_of_stock' : 'in_stock';
          const imageUrl = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || null;

          this.stats.found++; newInPage++;
          await this.saveProductWithR2(
            { name, category: search.catId, brand: this.extractBrand(name), imageUrl,
              specs: { 'Efectivo / Transferencia': `$${price.toLocaleString('es-CL')}`, 'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}` } },
            { current: price, normal: priceNormal && priceNormal > price ? priceNormal : null, discount, stock, url: fullUrl }
          );
        } catch (err) { this.log('warn', `[pcx] item: ${err.message}`); }
      }
      total += newInPage;
      this.log('info', `[pcx] ✓ "${search.q}" pág ${page}: ${newInPage}`);
      if (items.length < 10 || newInPage === 0) break;
      page++; await this.delay(1500, 2500);
    }
    this.log('info', `[pcx] ✓ "${search.q}": ${total} total`);
  }
}

if (require.main === module) {
  new PCExpressScraper().run().then(r => { console.log('PC-Express:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = PCExpressScraper;
