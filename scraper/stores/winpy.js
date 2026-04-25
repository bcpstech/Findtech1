/**
 * scraper/stores/winpy.js
 * Winpy.cl — plataforma propia, scraping HTML via proxy
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL     = 'https://www.winpy.cl';
const PROXY_URL    = process.env.CF_PROXY_URL    || '';
const PROXY_SECRET = process.env.CF_PROXY_SECRET || '';

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_SECRET}`;
}

const CATEGORIES = [
  { url: '/partes-y-piezas/tarjetas-de-video/',   catId: 'gpu',     minPrice: 80000 },
  { url: '/partes-y-piezas/procesadores/',          catId: 'cpu',     minPrice: 20000 },
  { url: '/partes-y-piezas/placas-madres/',         catId: 'mobo',    minPrice: 30000 },
  { url: '/partes-y-piezas/memorias-ram/',          catId: 'ram',     minPrice: 10000 },
  { url: '/partes-y-piezas/almacenamiento/',        catId: 'storage', minPrice: 10000 },
  { url: '/partes-y-piezas/refrigeracion/',         catId: 'cooling', minPrice: 8000  },
  { url: '/partes-y-piezas/fuentes-de-poder/',      catId: 'psu',     minPrice: 20000 },
  { url: '/partes-y-piezas/gabinetes/',             catId: 'case',    minPrice: 20000 },
];

const OUT_OF_STOCK = ['sin stock','agotado','out of stock','no disponible','sold out'];

function detectStock($el) {
  const txt = $el.find('[class*="stock"],.availability,.badge').text().toLowerCase();
  if (OUT_OF_STOCK.some(p => txt.includes(p))) return 'out_of_stock';
  if ($el.find('.out-of-stock,.no-stock').length) return 'out_of_stock';
  return 'in_stock';
}

class WinpyScraper extends BaseScraper {
  constructor() { super('winpy', 'Winpy'); }

  async scrapeAll() {
    this.seenUrls = new Set();
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(2000, 3000);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error ${cat.catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory({ url: catPath, catId, minPrice }) {
    for (let page = 1; page <= 20; page++) {
      const directUrl = `${BASE_URL}${catPath}?page=${page}`;
      const url = proxify(directUrl);
      this.log('info', `[winpy] ${catId} pág ${page}`);
      try {
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
            'Referer': BASE_URL,
          }
        });
        const $ = cheerio.load(res.data);
        // Winpy usa Bootstrap grid — buscar cards de producto
        const items = $('[class*="product"], .card, article').filter((_, el) => {
          const $el = $(el);
          return $el.find('a[href*="/"]').length > 0 && $el.find('[class*="price"], .precio').length > 0;
        });

        if (!items.length) { this.log('info', `[winpy] Sin productos pág ${page}`); break; }

        let newInPage = 0;
        for (const el of items.toArray()) {
          try {
            const $el = $(el);
            const productUrl = $el.find('a').first().attr('href') || '';
            const fullUrl = productUrl.startsWith('http') ? productUrl : `${BASE_URL}${productUrl}`;
            if (this.seenUrls.has(fullUrl)) continue;
            this.seenUrls.add(fullUrl);

            const name = $el.find('[class*="name"],[class*="title"],h3,h2').first().text().trim()
                      || $el.find('a[title]').attr('title') || '';
            if (!name || name.length < 5) continue;

            const priceRaw = $el.find('[class*="price"],.precio').first().text().trim();
            const price = this.parsePrice(priceRaw);
            if (!price || price < minPrice) continue;

            const stock = detectStock($el);
            const imageUrl = $el.find('img').first().attr('src')
                          || $el.find('img').first().attr('data-src') || null;

            this.stats.found++;
            newInPage++;
            await this.saveProductWithR2(
              { name, category: catId, brand: this.extractBrand(name), imageUrl,
                specs: { 'Precio': `$${price.toLocaleString('es-CL')}` }
              },
              { current: price, normal: null, discount: null, stock, url: fullUrl }
            );
          } catch(e) {}
        }

        this.log('info', `[winpy] ✓ ${catId} pág ${page}: ${newInPage} nuevos`);
        if (items.length < 8 || newInPage === 0) break;
        await this.delay(1500, 2500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[winpy] Error HTTP ${catPath} pág ${page}: ${err.message}`);
        break;
      }
    }
    this.log('info', `✓ winpy ${catId}: ${this.stats.found}`);
  }
}

if (require.main === module) {
  new WinpyScraper().run().then(r => { console.log('Winpy:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = WinpyScraper;
