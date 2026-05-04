/**
 * scraper/stores/infor-ingen.js
 * Infor-Ingen — WooCommerce HTML scraping
 * URLs verificadas: store.infor-ingen.com/categoria-producto/procesadores/am5/
 */
require('dotenv').config();
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE      = 'https://store.infor-ingen.com';
const PROXY_URL = process.env.CF_PROXY_URL    || '';
const PROXY_KEY = process.env.CF_PROXY_SECRET || '';
const FACTOR    = 1.03;

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

const CATEGORIES = [
  { url: '/categoria-producto/procesadores/am5/',          catId: 'cpu',     sub: 'am5'   },
  { url: '/categoria-producto/procesadores/am4/',          catId: 'cpu',     sub: 'amd'   },
  { url: '/categoria-producto/procesadores/intel-s1700/',  catId: 'cpu',     sub: 'intel' },
  { url: '/categoria-producto/procesadores/intel-s1200/',  catId: 'cpu',     sub: 'intel' },
  { url: '/categoria-producto/tarjetas-de-video/',         catId: 'gpu'                   },
  { url: '/categoria-producto/placas-madres/',             catId: 'mobo'                  },
  { url: '/categoria-producto/memorias/',                  catId: 'ram'                   },
  { url: '/categoria-producto/almacenamiento/',            catId: 'storage'               },
  { url: '/categoria-producto/refrigeracion/',             catId: 'cooling'               },
  { url: '/categoria-producto/fuentes-de-poder/',          catId: 'psu'                   },
  { url: '/categoria-producto/gabinetes/',                 catId: 'case'                  },
];

const OUT_OF_STOCK = ['sin stock', 'agotado', 'out of stock', 'no disponible'];

function parsePrice(str) {
  if (!str) return null;
  const n = parseInt(String(str).replace(/[^\d]/g, ''));
  return n > 1000 && n < 100000000 ? n : null;
}

class InforIngenScraper extends BaseScraper {
  constructor() {
    super('infor-ingen', 'Infor-Ingen');
    this.seenUrls = new Set();
  }

  async scrapeAll() {
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[infor-ingen] Error ${cat.catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(cat) {
    let page = 1; let total = 0;
    while (page <= 20) {
      const pageUrl = proxify(
        page === 1 ? `${BASE}${cat.url}` : `${BASE}${cat.url}page/${page}/`
      );
      this.log('info', `[infor-ingen] ${cat.catId} pág ${page}`);
      let $;
      try {
        const res = await this.client.get(pageUrl, {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
            Referer: BASE,
          },
          timeout: 25000,
        });
        $ = cheerio.load(res.data);
      } catch (err) { this.log('warn', `[infor-ingen] HTTP: ${err.message}`); break; }

      const items = $('ul.products li.product, .products .product');
      if (!items.length) { this.log('info', `[infor-ingen] Sin productos pág ${page}`); break; }

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
        } catch (err) { this.log('warn', `[infor-ingen] item: ${err.message}`); }
      }
      total += newInPage;
      this.log('info', `[infor-ingen] ✓ pág ${page}: ${newInPage}`);
      const hasNext = $('a.next.page-numbers').length > 0;
      if (!hasNext || newInPage === 0) break;
      page++; await this.delay(1500, 2500);
    }
    this.log('info', `[infor-ingen] ✓ ${cat.url}: ${total} total`);
  }
}

if (require.main === module) {
  new InforIngenScraper().run().then(r => { console.log('Infor-Ingen:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = InforIngenScraper;
