/**
 * scraper/stores/n1g.js
 * N1G usa PrestaShop con URLs /Home/ID-nombre
 */
const BaseScraper = require('../base-scraper');

const CATEGORY_URLS = [
  { url: 'https://n1g.cl/Home/39-tarjetas-graficas',     catId: 'gpu'     },
  { url: 'https://n1g.cl/Home/2-procesadores',           catId: 'cpu'     },
  { url: 'https://n1g.cl/Home/5-memorias-ram',           catId: 'ram'     },
  { url: 'https://n1g.cl/Home/54-discos-ssd',            catId: 'storage' },
  { url: 'https://n1g.cl/Home/6-refrigeracion',          catId: 'cooling' },
  { url: 'https://n1g.cl/Home/3-placas-madre',           catId: 'mobo'    },
  { url: 'https://n1g.cl/Home/4-fuentes-de-poder',       catId: 'psu'     },
  { url: 'https://n1g.cl/Home/24-gabinetes',             catId: 'case'    },
  { url: 'https://n1g.cl/Home/8-monitores',              catId: 'monitor' },
  { url: 'https://n1g.cl/Home/9-perifericos',            catId: 'periph'  },
];

class N1GScraper extends BaseScraper {
  constructor() { super('n1g', 'N1G'); }

  async scrapeAll() {
    for (const { url, catId } of CATEGORY_URLS) {
      try { await this.scrapeCategory(url, catId); await this.delay(); }
      catch (err) { this.stats.errors++; this.log('warn', `Error ${catId}: ${err.message}`); }
    }
  }

  async scrapeCategory(baseUrl, catId) {
    let page = 1; let hasMore = true;
    while (hasMore && page <= 10) {
      const url = page === 1 ? baseUrl : `${baseUrl}?p=${page}`;
      this.log('info', `Pág ${page} — ${catId}`, { url });
      const $ = await this.fetchPage(url);
      if (!$) { this.stats.errors++; break; }
      const products = [];
      $('.product-miniature, .js-product, article.product-miniature').each((_, el) => {
        const name  = $(el).find('.product-title a, h3.product-title').first().text().trim();
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
  new N1GScraper().run().then(r => { console.log('N1G:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = N1GScraper;
