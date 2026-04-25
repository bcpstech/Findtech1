/**
 * scraper/stores/centralgamer.js
 * WooCommerce REST API — specs desde p.attributes
 */
const BaseScraper = require('../base-scraper');

const BASE_API    = 'https://centralgamer.cl/wp-json/wc/store/v1/products';
const CARD_FACTOR = 1.0526;
const DELAY_BETWEEN_CATEGORIES = 4000;

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
        await this.delay(DELAY_BETWEEN_CATEGORIES, DELAY_BETWEEN_CATEGORIES + 2000);
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
        const res = await this.client.get(url, { headers: { Accept: 'application/json' } });
        const products = res.data;
        if (!products?.length) break;

        for (const p of products) {
          const priceCard = parseInt(p.prices?.price);
          if (!priceCard || priceCard < 1000) continue;
          const priceCash = Math.round(priceCard / CARD_FACTOR / 10) * 10;
          const regularRaw = parseInt(p.prices?.regular_price);
          const regularCash = regularRaw > priceCard
            ? Math.round(regularRaw / CARD_FACTOR / 10) * 10 : null;

          // Specs técnicas desde atributos WooCommerce
          const techSpecs = this.extractWooSpecs(p);

          this.stats.found++;
          await this.saveProductWithR2(
            {
              name:     p.name,
              category: catId,
              brand:    p.brands?.[0]?.name || this.extractBrand(p.name),
              imageUrl: p.images?.[0]?.src || null,
              specs: {
                ...techSpecs,
                'Efectivo/Transferencia':        `$${priceCash.toLocaleString('es-CL')}`,
                'Webpay / Tarjeta crédito-débito': `$${priceCard.toLocaleString('es-CL')}`,
              }
            },
            {
              current:  priceCash,
              normal:   regularCash,
              discount: regularCash ? Math.round((1 - priceCash / regularCash) * 100) : null,
              stock:    p.is_in_stock ? 'in_stock' : 'out_of_stock',
              url:      p.permalink || null,
            }
          );
        }
        if (products.length < PER_PAGE) break;
        page++;
        await this.delay(2000, 3000);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error API ${slug} pág ${page}: ${err.message}`);
        if (err.response?.status === 429) {
          this.log('warn', `[cg] Rate limit en ${slug} — esperando 15s`);
          await new Promise(r => setTimeout(r, 15000));
        }
        break;
      }
    }
    this.log('info', `✓ ${catId}: ${this.stats.found} productos`);
  }
}

if (require.main === module) {
  new CentralGamerScraper().run().then(r => { console.log('CentralGamer:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = CentralGamerScraper;
