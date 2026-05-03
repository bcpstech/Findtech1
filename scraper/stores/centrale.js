/**
 * scraper/stores/centrale.js
 * Centrale — WooCommerce Store API v1
 * Precio base = transferencia, tarjeta × 1.055
 */
require('dotenv').config();
const BaseScraper = require('../base-scraper');

const BASE_API    = 'https://centrale.cl/wp-json/wc/store/v1/products';
const FACTOR_CARD = 1.055;

const CATEGORIES = [
  { slug: 'tarjetas-graficas-para-pc',  catId: 'gpu'                   },
  { slug: 'procesadores-para-pc',       catId: 'cpu'                   },
  { slug: 'placas-madres-para-pc',      catId: 'mobo'                  },
  { slug: 'memorias-ram-para-pc',       catId: 'ram'                   },
  { slug: 'almacenamiento-para-pc',     catId: 'storage'               },
  { slug: 'refrigeracion-liquida',      catId: 'cooling', sub:'liquida'},
  { slug: 'coolers-de-aire',            catId: 'cooling', sub:'aire'   },
  { slug: 'ventiladores',               catId: 'cooling', sub:'fans'   },
  { slug: 'fuentes-de-poder-para-pc',   catId: 'psu'                   },
  { slug: 'gabinetes-para-pc',          catId: 'case'                  },
];

function classifyStorage(name) {
  const n = name.toLowerCase();
  if (/nvme|m\.2|pcie/.test(n)) return 'nvme';
  if (/hdd|mecanico|disco duro/.test(n)) return 'hdd';
  return 'sata';
}

class CentraleScraper extends BaseScraper {
  constructor() {
    super('centrale', 'Centrale');
    this.seenIds = new Set();
  }

  async scrapeAll() {
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(1500, 2500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[centrale] Error ${cat.catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(cat) {
    let page = 1;
    let total = 0;

    while (page <= 20) {
      const url = `${BASE_API}?category=${cat.slug}&per_page=100&page=${page}`;
      this.log('info', `[centrale] ${cat.catId} "${cat.slug}" pág ${page}`);

      let products;
      try {
        const res = await this.client.get(url, {
          headers: { Accept: 'application/json' },
          timeout: 25000,
        });
        products = res.data;
        if (!Array.isArray(products) || !products.length) break;
      } catch (err) {
        this.log('warn', `[centrale] HTTP error: ${err.message}`);
        break;
      }

      let newInPage = 0;
      for (const p of products) {
        try {
          if (this.seenIds.has(p.id)) continue;
          this.seenIds.add(p.id);

          const name = p.name?.trim();
          if (!name || name.length < 4) continue;

          const minorUnit = p.prices?.currency_minor_unit ?? 2;
          const divisor   = Math.pow(10, minorUnit);
          const priceCash = Math.round(parseInt(p.prices?.price) / divisor);
          if (!priceCash || priceCash < 1000) continue;

          const priceCard   = Math.round(priceCash * FACTOR_CARD / 10) * 10;
          const regularRaw  = Math.round(parseInt(p.prices?.regular_price) / divisor);
          const priceNormal = regularRaw > priceCash ? regularRaw : null;
          const discount    = priceNormal ? Math.round((1 - priceCash / priceNormal) * 100) : null;

          const stock = p.is_in_stock ? 'in_stock' : 'out_of_stock';

          let sub = cat.sub || null;
          if (!sub && cat.catId === 'storage') sub = classifyStorage(name);

          const techSpecs = this.extractWooSpecs(p);

          this.stats.found++;
          newInPage++;

          await this.saveProductWithR2(
            {
              name,
              category: cat.catId,
              brand: p.brands?.[0]?.name || this.extractBrand(name),
              imageUrl: p.images?.[0]?.src || null,
              specs: {
                ...techSpecs,
                'Transferencia / Efectivo':     `$${priceCash.toLocaleString('es-CL')}`,
                'Tarjeta crédito/débito':        `$${priceCard.toLocaleString('es-CL')}`,
              },
            },
            { current: priceCash, normal: priceNormal, discount, stock, url: p.permalink || null }
          );
        } catch (err) {
          this.log('warn', `[centrale] item error: ${err.message}`);
        }
      }

      total += newInPage;
      this.log('info', `[centrale] ✓ "${cat.slug}" pág ${page}: ${newInPage}`);
      if (products.length < 100) break;
      page++;
      await this.delay(1000, 2000);
    }

    this.log('info', `[centrale] ✓ ${cat.slug}: ${total} total`);
  }
}

if (require.main === module) {
  new CentraleScraper().run().then(r => {
    console.log('Centrale:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = CentraleScraper;
