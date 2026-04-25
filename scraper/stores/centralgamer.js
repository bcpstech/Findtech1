/**
 * scraper/stores/centralgamer.js
 * WooCommerce REST API — solo categorías de hardware verificadas
 * NOTA: La API devuelve el precio de tarjeta/Webpay.
 *       El precio efectivo/transferencia es tarjeta / 1.0526 (~5% descuento)
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

// La API entrega precio tarjeta. Efectivo = tarjeta / 1.0526
const CARD_FACTOR = 1.0526;

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
          // La API devuelve precio tarjeta/Webpay
          const priceCard = parseInt(p.prices?.price);
          if (!priceCard || priceCard < 1000) continue;

          // Precio efectivo/transferencia: ~5% menos que tarjeta
          const priceCash = Math.round(priceCard / CARD_FACTOR / 10) * 10;

          const regularPriceRaw = parseInt(p.prices?.regular_price);
          // regular_price también viene en precio tarjeta
          const regularPriceCash = regularPriceRaw > priceCard
            ? Math.round(regularPriceRaw / CARD_FACTOR / 10) * 10
            : null;

          this.stats.found++;
          await this.saveProductEnriched(
            {
              name:     p.name,
              category: catId,
              brand:    p.brands?.[0]?.name || this.extractBrand(p.name),
              imageUrl: p.images?.[0]?.src || null,
              specs: {
                'Efectivo/Transferencia': `$${priceCash.toLocaleString('es-CL')}`,
                'Webpay / Tarjeta crédito-débito': `$${priceCard.toLocaleString('es-CL')}`,
              }
            },
            {
              current:  priceCash,
              normal:   regularPriceCash,
              discount: regularPriceCash
                ? Math.round((1 - priceCash / regularPriceCash) * 100)
                : null,
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
