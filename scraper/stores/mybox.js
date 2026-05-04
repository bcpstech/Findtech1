/**
 * scraper/stores/mybox.js
 * MyBox — PrestaShop
 * URLs verificadas directamente del sitio
 */
require('dotenv').config();
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE      = 'https://mybox.cl';
const PROXY_URL = process.env.CF_PROXY_URL    || '';
const PROXY_KEY = process.env.CF_PROXY_SECRET || '';
const FACTOR    = 1.03;

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

const CATEGORIES = [
  { url: '/64-procesador',                   catId: 'cpu'     },
  { url: '/68-tarjeta-de-video',             catId: 'gpu'     },
  { url: '/65-placa-madre',                  catId: 'mobo'    },
  { url: '/66-memoria-ram',                  catId: 'ram'     },
  { url: '/67-almacenamiento',               catId: 'storage' },
  { url: '/92-enfriamiento-refrigeracion',   catId: 'cooling' },
  { url: '/63-fuentes-de-poder',             catId: 'psu'     },
  { url: '/62-gabinetes',                    catId: 'case'    },
];

const OUT_OF_STOCK = ['sin stock', 'agotado', 'out of stock', 'no disponible'];

function parsePrice(str) {
  if (!str) return null;
  const n = parseInt(String(str).replace(/[^\d]/g, ''));
  return n > 1000 && n < 100000000 ? n : null;
}

class MyBoxScraper extends BaseScraper {
  constructor() {
    super('mybox', 'MyBox');
    this.seenUrls = new Set();
  }

  async scrapeAll() {
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[mybox] Error ${cat.catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(cat) {
    let page = 1; let total = 0;
    while (page <= 20) {
      const pageUrl = proxify(`${BASE}${cat.url}?page=${page}`);
      this.log('info', `[mybox] ${cat.catId} pág ${page}`);
      let $;
      try {
        const res = await this.client.get(pageUrl, {
          headers: { Accept: 'text/html', 'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: BASE },
          timeout: 25000,
        });
        $ = cheerio.load(res.data);
      } catch (err) { this.log('warn', `[mybox] HTTP: ${err.message}`); break; }

      const items = $('article.product-miniature, .product-container, li.ajax_block_product');
      if (!items.length) { this.log('info', `[mybox] Sin productos pág ${page}`); break; }

      let newInPage = 0;
      for (const el of items.toArray()) {
        try {
          const $el = $(el);
          const productUrl = $el.find('a.product-thumbnail, .product-name a, h3 a, a[href*=".html"]').first().attr('href')
                          || $el.find('a').first().attr('href') || '';
          if (!productUrl || this.seenUrls.has(productUrl)) continue;
          this.seenUrls.add(productUrl);
          const name = $el.find('.product-title, .product-name, h3').first().text().trim()
                    || $el.find('a[href*=".html"]').first().attr('title') || '';
          if (!name || name.length < 4) continue;
          const priceRaw = $el.find('span.price, .product-price').first().text().trim()
                        || $el.find('[itemprop="price"]').attr('content') || '';
          const price = parsePrice(priceRaw);
          if (!price) continue;
          const normalRaw = $el.find('.regular-price, .old-price, del').first().text().trim();
          const priceNormal = normalRaw ? parsePrice(normalRaw) : null;
          const priceCard = Math.round(price * FACTOR);
          const discount = priceNormal && priceNormal > price ? Math.round((1 - price / priceNormal) * 100) : null;
          const txt = $el.text().toLowerCase();
          const stock = OUT_OF_STOCK.some(p => txt.includes(p)) || $el.find('.out-of-stock,.product-unavailable').length ? 'out_of_stock' : 'in_stock';
          const imageUrl = $el.find('img').first().attr('data-src') || $el.find('img').first().attr('src') || null;
          this.stats.found++; newInPage++;
          await this.saveProductWithR2(
            { name, category: cat.catId, brand: this.extractBrand(name), imageUrl,
              specs: { 'Efectivo / Transferencia': `$${price.toLocaleString('es-CL')}`, 'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}` } },
            { current: price, normal: priceNormal && priceNormal > price ? priceNormal : null, discount, stock, url: productUrl }
          );
        } catch (err) { this.log('warn', `[mybox] item: ${err.message}`); }
      }
      total += newInPage;
      this.log('info', `[mybox] ✓ pág ${page}: ${newInPage}`);
      if (items.length < 6 || newInPage === 0) break;
      page++; await this.delay(1500, 2500);
    }
    this.log('info', `[mybox] ✓ ${cat.url}: ${total} total`);
  }
}

if (require.main === module) {
  new MyBoxScraper().run().then(r => { console.log('MyBox:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = MyBoxScraper;
