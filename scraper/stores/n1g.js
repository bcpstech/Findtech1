/**
 * scraper/stores/n1g.js
 * Scraper para www.n1g.cl usando axios + cheerio
 * N1G usa WooCommerce
 */

const BaseScraper = require('../base-scraper');

const CATEGORY_URLS = [
  { url: 'https://www.n1g.cl/categoria/tarjetas-de-video/',  catId: 'gpu'     },
  { url: 'https://www.n1g.cl/categoria/procesadores/',       catId: 'cpu'     },
  { url: 'https://www.n1g.cl/categoria/memorias-ram/',       catId: 'ram'     },
  { url: 'https://www.n1g.cl/categoria/almacenamiento/',     catId: 'storage' },
  { url: 'https://www.n1g.cl/categoria/refrigeracion/',      catId: 'cooling' },
  { url: 'https://www.n1g.cl/categoria/placas-madre/',       catId: 'mobo'    },
  { url: 'https://www.n1g.cl/categoria/fuentes-de-poder/',   catId: 'psu'     },
  { url: 'https://www.n1g.cl/categoria/gabinetes/',          catId: 'case'    },
  { url: 'https://www.n1g.cl/categoria/monitores/',          catId: 'monitor' },
  { url: 'https://www.n1g.cl/categoria/perifericos/',        catId: 'periph'  },
];

class N1GScraper extends BaseScraper {
  constructor() { super('n1g', 'N1G'); }

  async scrapeAll() {
    for (const { url, catId } of CATEGORY_URLS) {
      try {
        await this.scrapeCategory(url, catId);
        await this.delay();
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error en ${catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(baseUrl, catId) {
    let page = 1;
    let hasMore = true;
    const MAX_PAGES = 15;

    while (hasMore && page <= MAX_PAGES) {
      const url = page === 1 ? baseUrl : `${baseUrl}page/${page}/`;
      this.log('info', `Pág ${page} — ${catId}`, { url });

      const $ = await this.fetchPage(url);
      if (!$) { this.stats.errors++; break; }

      // WooCommerce selectores
      const products = [];
      $('li.product, .product-item').each((_, el) => {
        const name     = $(el).find('.woocommerce-loop-product__title, h2').first().text().trim();
        const priceEl  = $(el).find('.price ins .amount, .price .woocommerce-Price-amount').first();
        const price    = priceEl.text().trim() || $(el).find('.price .amount').first().text().trim();
        const normalEl = $(el).find('.price del .amount').first().text().trim();
        const href     = $(el).find('a').first().attr('href');
        const img      = $(el).find('img').first().attr('data-src') || $(el).find('img').first().attr('src');

        if (name && price) products.push({ name, price, normal: normalEl, href, img });
      });

      if (!products.length) { hasMore = false; break; }

      for (const p of products) {
        const current = this.parsePrice(p.price);
        if (!current) continue;
        const normal = this.parsePrice(p.normal);
        this.stats.found++;
        this.saveProduct(
          { name: p.name, category: catId, imageUrl: p.img },
          { current, normal, discount: normal ? Math.round((1 - current/normal)*100) : null, url: p.href }
        );
      }

      // Verificar si hay página siguiente
      hasMore = $('a.next, .next.page-numbers').length > 0;
      page++;
      await this.delay(600, 1500);
    }
  }
}

if (require.main === module) {
  new N1GScraper().run().then(r => { console.log('N1G:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = N1GScraper;
