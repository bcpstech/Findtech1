/**
 * scraper/stores/winpy.js
 * Winpy.cl — plataforma propia, scraping HTML por categoría
 * Precio mostrado = transferencia. Tarjeta no especificada → usamos × 1.03
 */
require('dotenv').config();
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE      = 'https://www.winpy.cl';
const PROXY_URL = process.env.CF_PROXY_URL    || '';
const PROXY_KEY = process.env.CF_PROXY_SECRET || '';
const FACTOR    = 1.03;

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

const CATEGORIES = [
  { url: '/partes-y-piezas/tarjetas-de-video/',  catId: 'gpu'     },
  { url: '/partes-y-piezas/procesadores/',        catId: 'cpu'     },
  { url: '/partes-y-piezas/placas-madres/',       catId: 'mobo'    },
  { url: '/partes-y-piezas/memorias-ram/',        catId: 'ram'     },
  { url: '/partes-y-piezas/almacenamiento/',      catId: 'storage' },
  { url: '/partes-y-piezas/refrigeracion/',       catId: 'cooling' },
  { url: '/partes-y-piezas/fuentes-de-poder/',    catId: 'psu'     },
  { url: '/partes-y-piezas/gabinetes/',           catId: 'case'    },
];

const OUT_OF_STOCK = ['sin stock', 'agotado', 'out of stock', 'no disponible'];

function parsePrice(str) {
  if (!str) return null;
  const n = parseInt(String(str).replace(/[^\d]/g, ''));
  return n > 1000 && n < 100000000 ? n : null;
}

class WinpyScraper extends BaseScraper {
  constructor() {
    super('winpy', 'Winpy');
    this.seenUrls = new Set();
  }

  async scrapeAll() {
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[winpy] Error ${cat.catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(cat) {
    let page = 1;
    let total = 0;

    while (page <= 20) {
      const pageUrl = proxify(`${BASE}${cat.url}?page=${page}`);
      this.log('info', `[winpy] ${cat.catId} pág ${page}`);

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
        this.log('warn', `[winpy] HTTP error: ${err.message}`);
        break;
      }

      // Winpy usa .product-item o .card con links a /producto/
      const items = $('.product-item, .product, [class*="producto"], article').filter((_, el) => {
        return $(el).find('a[href*="/producto/"], a[href*="/partes"]').length > 0;
      });

      if (!items.length) {
        this.log('info', `[winpy] Sin productos pág ${page}`);
        break;
      }

      let newInPage = 0;
      for (const el of items.toArray()) {
        try {
          const $el = $(el);
          let productUrl = $el.find('a[href*="/producto/"]').first().attr('href')
                        || $el.find('a').first().attr('href') || '';
          if (!productUrl) continue;
          if (!productUrl.startsWith('http')) productUrl = `${BASE}${productUrl}`;
          if (this.seenUrls.has(productUrl)) continue;
          this.seenUrls.add(productUrl);

          const name = $el.find('[class*="name"],[class*="title"],h3,h2,h4').first().text().trim()
                    || $el.find('a').first().attr('title') || '';
          if (!name || name.length < 4) continue;

          const priceRaw = $el.find('[class*="price"],[class*="precio"]').first().text().trim();
          const price = parsePrice(priceRaw);
          if (!price) continue;

          const priceCard = Math.round(price * FACTOR);

          const txt = $el.text().toLowerCase();
          const stock = OUT_OF_STOCK.some(p => txt.includes(p)) ||
            $el.find('.out-of-stock,.no-stock').length
            ? 'out_of_stock' : 'in_stock';

          const imageUrl = $el.find('img').first().attr('data-src')
                        || $el.find('img').first().attr('src') || null;

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
            { current: price, normal: null, discount: null, stock, url: productUrl }
          );
        } catch (err) {
          this.log('warn', `[winpy] item error: ${err.message}`);
        }
      }

      total += newInPage;
      this.log('info', `[winpy] ✓ ${cat.catId} pág ${page}: ${newInPage}`);
      if (items.length < 6 || newInPage === 0) break;
      page++;
      await this.delay(1500, 2500);
    }

    this.log('info', `[winpy] ✓ ${cat.catId}: ${total} total`);
  }
}

if (require.main === module) {
  new WinpyScraper().run().then(r => {
    console.log('Winpy:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = WinpyScraper;
