/**
 * scraper/stores/centrale.js
 * Centrale usa una API JSON propia — más rápido que HTML scraping
 */
const BaseScraper = require('../base-scraper');

// Centrale expone una API JSON para su catálogo
const API_CATEGORIES = [
  { path: '/api/products?category=tarjetas-de-video', catId: 'gpu'     },
  { path: '/api/products?category=procesadores',      catId: 'cpu'     },
  { path: '/api/products?category=memorias-ram',      catId: 'ram'     },
  { path: '/api/products?category=almacenamiento',    catId: 'storage' },
  { path: '/api/products?category=refrigeracion',     catId: 'cooling' },
  { path: '/api/products?category=placas-madre',      catId: 'mobo'    },
  { path: '/api/products?category=fuentes-de-poder',  catId: 'psu'     },
  { path: '/api/products?category=gabinetes',         catId: 'case'    },
  { path: '/api/products?category=monitores',         catId: 'monitor' },
  { path: '/api/products?category=perifericos',       catId: 'periph'  },
];

// URLs de categorías HTML como fallback
const HTML_CATEGORIES = [
  { url: 'https://www.centrale.cl/componentes/tarjetas-de-video', catId: 'gpu'     },
  { url: 'https://www.centrale.cl/componentes/procesadores',      catId: 'cpu'     },
  { url: 'https://www.centrale.cl/componentes/memorias-ram',      catId: 'ram'     },
  { url: 'https://www.centrale.cl/componentes/almacenamiento',    catId: 'storage' },
  { url: 'https://www.centrale.cl/componentes/refrigeracion',     catId: 'cooling' },
  { url: 'https://www.centrale.cl/componentes/placas-madre',      catId: 'mobo'    },
  { url: 'https://www.centrale.cl/componentes/fuentes-de-poder',  catId: 'psu'     },
  { url: 'https://www.centrale.cl/gabinetes',                     catId: 'case'    },
  { url: 'https://www.centrale.cl/monitores',                     catId: 'monitor' },
  { url: 'https://www.centrale.cl/perifericos',                   catId: 'periph'  },
];

class CentraleScraper extends BaseScraper {
  constructor() { super('centrale', 'Centrale'); }

  async scrapeAll() {
    for (const { url, catId } of HTML_CATEGORIES) {
      try { await this.scrapeCategory(url, catId); await this.delay(); }
      catch (err) { this.stats.errors++; this.log('warn', `Error ${catId}: ${err.message}`); }
    }
  }

  async scrapeCategory(baseUrl, catId) {
    let page = 1; let hasMore = true;
    while (hasMore && page <= 15) {
      const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;
      const $ = await this.fetchPage(url);
      if (!$) { this.stats.errors++; break; }

      const products = [];
      // Centrale usa varios frameworks — intentar múltiples selectores
      const selectors = [
        '.product-card', '.product-item', '.card-product',
        '[class*="ProductCard"]', '[class*="product-card"]',
        '.item-product', 'article.product'
      ];

      let found = false;
      for (const sel of selectors) {
        if ($(sel).length > 0) {
          $(sel).each((_, el) => {
            const name  = $(el).find('h2, h3, [class*="name"], [class*="title"]').first().text().trim();
            const price = $(el).find('[class*="price"], .precio, .price').first().text().trim();
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

      hasMore = $('a[aria-label="Next"], .pagination .next, [class*="next"]').length > 0;
      page++; await this.delay(800, 2000);
    }
  }
}

if (require.main === module) {
  new CentraleScraper().run().then(r => { console.log('Centrale:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = CentraleScraper;
