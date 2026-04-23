/**
 * scraper/stores/pcexpress.js
 * PC-Express usa OpenCart
 */
const BaseScraper = require('../base-scraper');

const CATEGORY_URLS = [
  { url: 'https://tienda.pc-express.cl/index.php?route=product/category&path=24', catId: 'gpu'     },
  { url: 'https://tienda.pc-express.cl/index.php?route=product/category&path=20', catId: 'cpu'     },
  { url: 'https://tienda.pc-express.cl/index.php?route=product/category&path=26', catId: 'ram'     },
  { url: 'https://tienda.pc-express.cl/index.php?route=product/category&path=27', catId: 'storage' },
  { url: 'https://tienda.pc-express.cl/index.php?route=product/category&path=36', catId: 'cooling' },
  { url: 'https://tienda.pc-express.cl/index.php?route=product/category&path=21', catId: 'mobo'    },
  { url: 'https://tienda.pc-express.cl/index.php?route=product/category&path=29', catId: 'psu'     },
  { url: 'https://tienda.pc-express.cl/index.php?route=product/category&path=30', catId: 'case'    },
  { url: 'https://tienda.pc-express.cl/index.php?route=product/category&path=45', catId: 'monitor' },
  { url: 'https://tienda.pc-express.cl/index.php?route=product/category&path=46', catId: 'periph'  },
];

class PCExpressScraper extends BaseScraper {
  constructor() { super('pcexpress', 'PC-Express'); }

  async scrapeAll() {
    for (const { url, catId } of CATEGORY_URLS) {
      try { await this.scrapeCategory(url, catId); await this.delay(); }
      catch (err) { this.stats.errors++; this.log('warn', `Error ${catId}: ${err.message}`); }
    }
  }

  async scrapeCategory(baseUrl, catId) {
    let page = 1; let hasMore = true;
    while (hasMore && page <= 15) {
      const url = page === 1 ? baseUrl : `${baseUrl}&page=${page}`;
      const $ = await this.fetchPage(url);
      if (!$) { this.stats.errors++; break; }

      const products = [];
      // OpenCart 3.x selectores
      $('.product-layout').each((_, el) => {
        const name   = $(el).find('.caption h4 a, .product-name a').first().text().trim();
        const price  = $(el).find('.price-new, .price').first().text().trim();
        const normal = $(el).find('.price-old').first().text().trim();
        const href   = $(el).find('.caption h4 a').first().attr('href');
        const img    = $(el).find('img').first().attr('src');
        if (name && price) products.push({ name, price, normal, href, img });
      });

      if (!products.length) { hasMore = false; break; }

      for (const p of products) {
        const current = this.parsePrice(p.price); if (!current) continue;
        const normal = this.parsePrice(p.normal); this.stats.found++;
        this.saveProduct({ name: p.name, category: catId, imageUrl: p.img },
          { current, normal, discount: normal ? Math.round((1-current/normal)*100) : null, url: p.href });
      }

      hasMore = $('.pagination li a[rel="next"]').length > 0;
      page++; await this.delay(600, 1500);
    }
  }
}

if (require.main === module) {
  new PCExpressScraper().run().then(r => { console.log('PC-Express:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = PCExpressScraper;
