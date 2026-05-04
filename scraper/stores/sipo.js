/**
 * scraper/stores/sipo.js
 * Sipo — WooCommerce HTML scraping
 * Dominio correcto: sipoonline.cl
 * URL verificada: sipoonline.cl/product-category/componentes-pc/procesadores/
 */
require('dotenv').config();
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE      = 'https://sipoonline.cl';
const PROXY_URL = process.env.CF_PROXY_URL    || '';
const PROXY_KEY = process.env.CF_PROXY_SECRET || '';
const FACTOR    = 1.03;

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

const CATEGORIES = [
  { url: '/product-category/componentes-pc/procesadores/',      catId: 'cpu'     },
  { url: '/product-category/componentes-pc/tarjetas-de-video/', catId: 'gpu'     },
  { url: '/product-category/componentes-pc/placas-madre/',      catId: 'mobo'    },
  { url: '/product-category/componentes-pc/memorias-ram/',      catId: 'ram'     },
  { url: '/product-category/componentes-pc/almacenamiento/',    catId: 'storage' },
  { url: '/product-category/componentes-pc/refrigeracion/',     catId: 'cooling' },
  { url: '/product-category/componentes-pc/fuentes-de-poder/',  catId: 'psu'     },
  { url: '/product-category/componentes-pc/gabinetes/',         catId: 'case'    },
  { url: '/product-category/pc-armadas/',                       catId: 'pc'      },
];

const OUT_OF_STOCK = ['sin stock', 'agotado', 'out of stock', 'no disponible'];

function parsePrice(str) {
  if (!str) return null;
  const n = parseInt(String(str).replace(/[^\d]/g, ''));
  return n > 1000 && n < 100000000 ? n : null;
}

class SipoScraper extends BaseScraper {
  constructor() {
    super('sipo', 'Sipo');
    this.seenUrls = new Set();
  }

  async scrapeAll() {
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[sipo] Error ${cat.catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(cat) {
    let page = 1; let total = 0;
    while (page <= 20) {
      const pageUrl = proxify(
        page === 1 ? `${BASE}${cat.url}` : `${BASE}${cat.url}page/${page}/`
      );
      this.log('info', `[sipo] ${cat.catId} pág ${page}`);
      let $;
      try {
        const res = await this.client.get(pageUrl, {
          headers: { Accept: 'text/html', 'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: BASE },
          timeout: 25000,
        });
        $ = cheerio.load(res.data);
      } catch (err) { this.log('warn', `[sipo] HTTP: ${err.message}`); break; }

      const items = $('ul.products li.product, .products .product');
      if (!items.length) { this.log('info', `[sipo] Sin productos pág ${page}`); break; }

      let newInPage = 0;
      for (const el of items.toArray()) {
        try {
          const $el = $(el);
          const productUrl = $el.find('a.woocommerce-loop-product__link, a').first().attr('href') || '';
          if (!productUrl || this.seenUrls.has(productUrl)) continue;
          this.seenUrls.add(productUrl);
          const name = $el.find('.woocommerce-loop-product__title, h2').first().text().trim();
          if (!name || name.length < 4) continue;
          const priceRaw = $el.find('.price ins .amount').first().text()
                        || $el.find('.price .amount').first().text()
                        || $el.find('.price').first().text();
          const price = parsePrice(priceRaw);
          if (!price) continue;
          const normalRaw = $el.find('.price del .amount').first().text();
          const priceNormal = normalRaw ? parsePrice(normalRaw) : null;
          const priceCard = Math.round(price * FACTOR);
          const discount = priceNormal && priceNormal > price ? Math.round((1 - price / priceNormal) * 100) : null;
          const txt = $el.text().toLowerCase();
          const stock = OUT_OF_STOCK.some(p => txt.includes(p)) || $el.find('.out-of-stock').length ? 'out_of_stock' : 'in_stock';
          const imageUrl = $el.find('img').first().attr('data-src') || $el.find('img').first().attr('src') || null;
          this.stats.found++; newInPage++;
          await this.saveProductWithR2(
            { name, category: cat.catId, brand: this.extractBrand(name), imageUrl,
              specs: { 'Efectivo / Transferencia': `$${price.toLocaleString('es-CL')}`, 'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}` } },
            { current: price, normal: priceNormal && priceNormal > price ? priceNormal : null, discount, stock, url: productUrl }
          );
        } catch (err) { this.log('warn', `[sipo] item: ${err.message}`); }
      }
      total += newInPage;
      this.log('info', `[sipo] ✓ pág ${page}: ${newInPage}`);
      const hasNext = $('a.next.page-numbers').length > 0;
      if (!hasNext || newInPage === 0) break;
      page++; await this.delay(1500, 2500);
    }
    this.log('info', `[sipo] ✓ ${cat.url}: ${total} total`);
  }
}

if (require.main === module) {
  new SipoScraper().run().then(r => { console.log('Sipo:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = SipoScraper;
