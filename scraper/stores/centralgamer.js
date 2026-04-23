/**
 * scraper/stores/centralgamer.js
 * WooCommerce
 */
const BaseScraper = require('../base-scraper');

const CATEGORY_URLS = [
  { url: 'https://www.centralgamer.cl/categoria-producto/tarjetas-de-video/', catId: 'gpu'     },
  { url: 'https://www.centralgamer.cl/categoria-producto/procesadores/',      catId: 'cpu'     },
  { url: 'https://www.centralgamer.cl/categoria-producto/memorias/',          catId: 'ram'     },
  { url: 'https://www.centralgamer.cl/categoria-producto/almacenamiento/',    catId: 'storage' },
  { url: 'https://www.centralgamer.cl/categoria-producto/refrigeracion/',     catId: 'cooling' },
  { url: 'https://www.centralgamer.cl/categoria-producto/placas-madre/',      catId: 'mobo'    },
  { url: 'https://www.centralgamer.cl/categoria-producto/fuentes/',           catId: 'psu'     },
  { url: 'https://www.centralgamer.cl/categoria-producto/monitores/',         catId: 'monitor' },
  { url: 'https://www.centralgamer.cl/categoria-producto/perifericos/',       catId: 'periph'  },
];

class CentralGamerScraper extends BaseScraper {
  constructor() { super('cg', 'CentralGamer'); }

  async scrapeAll() {
    for (const { url, catId } of CATEGORY_URLS) {
      try { await this.scrapeCategory(url, catId); await this.delay(); }
      catch (err) { this.stats.errors++; this.log('warn', `Error ${catId}: ${err.message}`); }
    }
  }

  async scrapeCategory(baseUrl, catId) {
    let page = 1; let hasMore = true;
    while (hasMore && page <= 15) {
      const url = page === 1 ? baseUrl : `${baseUrl}page/${page}/`;
      const $ = await this.fetchPage(url);
      if (!$) { this.stats.errors++; break; }

      const products = [];
      $('ul.products li.product, .products .product').each((_, el) => {
        const name  = $(el).find('.woocommerce-loop-product__title, h2').first().text().trim();
        const price = $(el).find('.price ins .amount, .price .woocommerce-Price-amount').first().text().trim()
                   || $(el).find('.price .amount').first().text().trim();
        const normal = $(el).find('.price del .amount').first().text().trim();
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
      hasMore = $('a.next, .next.page-numbers').length > 0;
      page++; await this.delay(600, 1500);
    }
  }
}

if (require.main === module) {
  new CentralGamerScraper().run().then(r => { console.log('CentralGamer:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = CentralGamerScraper;
