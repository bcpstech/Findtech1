/**
 * scraper/stores/alltec.js
 * Alltec usa PrestaShop
 */
const BaseScraper = require('../base-scraper');

const CATEGORY_URLS = [
  { url: 'https://www.alltec.cl/tarjetas-de-video',   catId: 'gpu'     },
  { url: 'https://www.alltec.cl/procesadores',        catId: 'cpu'     },
  { url: 'https://www.alltec.cl/memorias',            catId: 'ram'     },
  { url: 'https://www.alltec.cl/almacenamiento',      catId: 'storage' },
  { url: 'https://www.alltec.cl/refrigeracion',       catId: 'cooling' },
  { url: 'https://www.alltec.cl/placas-madre',        catId: 'mobo'    },
  { url: 'https://www.alltec.cl/fuentes-de-poder',    catId: 'psu'     },
  { url: 'https://www.alltec.cl/gabinetes',           catId: 'case'    },
  { url: 'https://www.alltec.cl/monitores',           catId: 'monitor' },
  { url: 'https://www.alltec.cl/perifericos',         catId: 'periph'  },
];

class AlltecScraper extends BaseScraper {
  constructor() { super('alltec', 'Alltec'); }

  async scrapeAll() {
    for (const { url, catId } of CATEGORY_URLS) {
      try { await this.scrapeCategory(url, catId); await this.delay(); }
      catch (err) { this.stats.errors++; this.log('warn', `Error ${catId}: ${err.message}`); }
    }
  }

  async scrapeCategory(baseUrl, catId) {
    let page = 1; let hasMore = true;
    while (hasMore && page <= 10) {
      const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;
      this.log('info', `Pág ${page} — ${catId}`);
      const $ = await this.fetchPage(url);
      if (!$) { this.stats.errors++; break; }
      const products = [];
      $('.product-miniature, .js-product, .product-item').each((_, el) => {
        const name  = $(el).find('.product-title a, h3.product-title, .product-name').first().text().trim();
        const price = $(el).find('.price').not('.regular-price').first().text().trim();
        const normal = $(el).find('.regular-price').first().text().trim();
        const href  = $(el).find('a').first().attr('href');
        const img   = $(el).find('img').first().attr('data-src') || $(el).find('img').first().attr('src');
        if (name && price) products.push({ name, price, normal, href, img });
      });
      if (!products.length) { hasMore = false; break; }
      for (const p of products) {
        const current = this.parsePrice(p.price); if (!current) continue;
        const normal = this.parsePrice(p.normal); this.stats.found++;
        this.saveProduct({ name: p.name, category: catId, imageUrl: p.img },
          { current, normal, discount: normal ? Math.round((1-current/normal)*100) : null, url: p.href });
      }
      hasMore = $('.pagination .next, a[rel="next"]').length > 0;
      page++; await this.delay(1500, 3000);
    }
  }
}

if (require.main === module) {
  new AlltecScraper().run().then(r => { console.log('Alltec:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = AlltecScraper;
