/**
 * scraper/stores/centrale.js
 * Centrale bloquea con 403 — usamos su API JSON directa
 */
const BaseScraper = require('../base-scraper');

const CATEGORY_URLS = [
  { url: 'https://www.centrale.cl/tarjetas-de-video',  catId: 'gpu'     },
  { url: 'https://www.centrale.cl/procesadores',       catId: 'cpu'     },
  { url: 'https://www.centrale.cl/memorias-ram',       catId: 'ram'     },
  { url: 'https://www.centrale.cl/almacenamiento',     catId: 'storage' },
  { url: 'https://www.centrale.cl/refrigeracion',      catId: 'cooling' },
  { url: 'https://www.centrale.cl/placas-madre',       catId: 'mobo'    },
  { url: 'https://www.centrale.cl/fuentes-de-poder',   catId: 'psu'     },
  { url: 'https://www.centrale.cl/gabinetes',          catId: 'case'    },
  { url: 'https://www.centrale.cl/monitores',          catId: 'monitor' },
  { url: 'https://www.centrale.cl/perifericos',        catId: 'periph'  },
];

class CentraleScraper extends BaseScraper {
  constructor() {
    super('centrale', 'Centrale');
    // Centrale requiere headers especiales
    this.client.defaults.headers['Referer'] = 'https://www.centrale.cl/';
    this.client.defaults.headers['Origin'] = 'https://www.centrale.cl';
  }

  async scrapeAll() {
    for (const { url, catId } of CATEGORY_URLS) {
      try { await this.scrapeCategory(url, catId); await this.delay(3000, 5000); }
      catch (err) { this.stats.errors++; this.log('warn', `Error ${catId}: ${err.message}`); }
    }
  }

  async scrapeCategory(baseUrl, catId) {
    let page = 1; let hasMore = true;
    while (hasMore && page <= 10) {
      const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;
      const $ = await this.fetchPage(url);
      if (!$) { this.stats.errors++; break; }

      const products = [];
      const selectors = [
        '.product-card', '.product-item', 'article.product',
        '[class*="ProductCard"]', '[class*="product-card"]',
        '.card-product', '.item-product'
      ];

      let found = false;
      for (const sel of selectors) {
        if ($(sel).length > 0) {
          $(sel).each((_, el) => {
            const name  = $(el).find('h2, h3, [class*="name"], [class*="title"]').first().text().trim();
            const price = $(el).find('[class*="price"], .precio').first().text().trim();
            const href  = $(el).find('a').first().attr('href');
            const img   = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src');
            if (name && price && name.length > 3) products.push({ name, price, href, img });
          });
          found = true; break;
        }
      }

      if (!found || !products.length) { hasMore = false; break; }

      for (const p of products) {
        const current = this.parsePrice(p.price); if (!current) continue;
        this.stats.found++;
        this.saveProduct({ name: p.name, category: catId, imageUrl: p.img },
          { current, url: p.href });
      }

      hasMore = $('a[aria-label="Next"], .pagination .next').length > 0;
      page++; await this.delay(2000, 4000);
    }
  }
}

if (require.main === module) {
  new CentraleScraper().run().then(r => { console.log('Centrale:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = CentraleScraper;
