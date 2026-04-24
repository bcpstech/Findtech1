/**
 * scraper/stores/centralgamer.js
 * WooCommerce REST API — solo categorías de hardware verificadas
 */
const BaseScraper = require('../base-scraper');

const BASE_API = 'https://centralgamer.cl/wp-json/wc/store/v1/products';

const CATEGORIES = [
  { slug: 'tarjetas-de-video',  catId: 'gpu'     },
  { slug: 'procesadores',       catId: 'cpu'     },
  { slug: 'placas-madre',       catId: 'mobo'    },
  { slug: 'memorias-ram',       catId: 'ram'     },
  { slug: 'almacenamiento',     catId: 'storage' },
  { slug: 'refrigeracion-pc',   catId: 'cooling' },
  { slug: 'gabinetes-gamer',    catId: 'case'    },
  { slug: 'fuentes-de-poder',   catId: 'psu'     },
];

class CentralGamerScraper extends BaseScraper {
  constructor() { super('cg', 'CentralGamer'); }

  async scrapeAll() {
    for (const { slug, catId } of CATEGORIES) {
      try {
        await this.scrapeCategory(slug, catId);
        await this.delay(1000, 2000);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error ${catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(slug, catId) {
    let page = 1;
    const PER_PAGE = 100;

    while (page <= 20) {
      const url = `${BASE_API}?category=${slug}&per_page=${PER_PAGE}&page=${page}`;
      this.log('info', `[cg] ${catId} pág ${page}`);

      try {
        const res = await this.client.get(url, {
          headers: { 'Accept': 'application/json' }
        });
        const products = res.data;
        if (!products?.length) break;

        for (const p of products) {
          const price = parseInt(p.prices?.price);
          if (!price || price < 1000) continue;

          const regularPrice = parseInt(p.prices?.regular_price);
          // Precio tarjeta +5.26% (verificado en centralgamer.cl)
          const priceCard = Math.round(price * 1.0526);

          this.stats.found++;
          this.saveProduct(
            {
              name:     p.name,
              category: catId,
              brand:    p.brands?.[0]?.name || this.extractBrand(p.name),
              imageUrl: p.images?.[0]?.src || null,
              specs: {
                'Efectivo/Transferencia':    `$${price.toLocaleString('es-CL')}`,
                'Tarjeta crédito/débito':    `$${priceCard.toLocaleString('es-CL')}`,
              }
            },
            {
              current:  price,
              normal:   regularPrice > price ? regularPrice : null,
              discount: regularPrice > price ? Math.round((1 - price/regularPrice)*100) : null,
              stock:    p.is_in_stock ? 'in_stock' : 'out_of_stock',
              url:      p.permalink || null,
            }
          );
        }

        if (products.length < PER_PAGE) break;
        page++;
        await this.delay(500, 1000);

      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error API ${slug} pág ${page}: ${err.message}`);
        break;
      }
    }
    this.log('info', `✓ ${catId}: ${this.stats.found} productos`);
  }
}

if (require.main === module) {
  new CentralGamerScraper().run().then(r => {
    console.log('CentralGamer:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = CentralGamerScraper;
