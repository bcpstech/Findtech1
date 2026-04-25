/**
 * scraper/stores/centrale.js
 * WooCommerce REST API — specs desde p.attributes
 */
const BaseScraper = require('../base-scraper');

const BASE_API    = 'https://centrale.cl/wp-json/wc/store/v1/products';
const CARD_FACTOR = 1.055;

const CATEGORIES = [
  { slug: 'tarjetas-graficas-para-pc',  catId: 'gpu'     },
  { slug: 'procesadores-para-pc',       catId: 'cpu'     },
  { slug: 'placas-madres-para-pc',      catId: 'mobo'    },
  { slug: 'memorias-ram-para-pc',       catId: 'ram'     },
  { slug: 'almacenamiento-para-pc',     catId: 'storage' },
  { slug: 'refrigeracion-liquida',      catId: 'cooling' },
  { slug: 'coolers-de-aire',            catId: 'cooling' },
  { slug: 'ventiladores',               catId: 'cooling' },
  { slug: 'fuentes-de-poder-para-pc',   catId: 'psu'     },
  { slug: 'gabinetes-para-pc',          catId: 'case'    },
];

class CentraleScraper extends BaseScraper {
  constructor() { super('centrale', 'Centrale'); }

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
      this.log('info', `[centrale] ${catId} pág ${page}`);
      try {
        const res = await this.client.get(url, { headers: { Accept: 'application/json' } });
        const products = res.data;
        if (!products?.length) break;

        for (const p of products) {
          const priceCash = parseInt(p.prices?.price);
          if (!priceCash || priceCash < 1000) continue;
          const priceCard = Math.round(priceCash * CARD_FACTOR / 10) * 10;
          const regularRaw = parseInt(p.prices?.regular_price);
          const regularPrice = regularRaw > priceCash ? regularRaw : null;

          // Specs técnicas desde atributos WooCommerce
          const techSpecs = this.extractWooSpecs(p);

          this.stats.found++;
          this.saveProduct(
            {
              name:     p.name,
              category: catId,
              brand:    p.brands?.[0]?.name || this.extractBrand(p.name),
              imageUrl: p.images?.[0]?.src || null,
              specs: {
                ...techSpecs,
                'Transferencia / Efectivo':      `$${priceCash.toLocaleString('es-CL')}`,
                'Tarjetas de Crédito / Débito':  `$${priceCard.toLocaleString('es-CL')}`,
              }
            },
            {
              current:  priceCash,
              normal:   regularPrice,
              discount: regularPrice ? Math.round((1 - priceCash / regularPrice) * 100) : null,
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
        this.log('warn', `[centrale] Error API ${slug} pág ${page}: ${err.message}`);
        break;
      }
    }
    this.log('info', `✓ centrale ${catId}: ${this.stats.found} productos`);
  }
}

if (require.main === module) {
  new CentraleScraper().run().then(r => { console.log('Centrale:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = CentraleScraper;
