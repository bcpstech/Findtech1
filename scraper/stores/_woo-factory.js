/**
 * scraper/stores/_woo-factory.js
 * Genera scrapers WooCommerce Store API v1 con slugs verificados.
 * Uso interno — importado por cada tienda.
 */
require('dotenv').config();
const BaseScraper = require('../base-scraper');

const FACTOR_CARD = 1.03;

function classifyStorage(name) {
  const n = name.toLowerCase();
  if (/nvme|m\.2|pcie/.test(n)) return 'nvme';
  if (/hdd|mecanico|disco duro/.test(n)) return 'hdd';
  return 'sata';
}

function classifyMobo(name) {
  const n = name.toUpperCase();
  if (/AM5/.test(n)) return 'am5';
  if (/AM4/.test(n)) return 'am4';
  if (/LGA\s*1851/.test(n)) return 'lga1851';
  if (/LGA\s*1700/.test(n)) return 'lga1700';
  return null;
}

/**
 * @param {string} storeId
 * @param {string} storeName
 * @param {string} baseApi  — URL base sin trailing slash
 * @param {Array}  categories — [{ slug, catId, sub? }]
 * @param {object} opts — { factor?, proxify? }
 */
function createWooScraper(storeId, storeName, baseApi, categories, opts = {}) {
  const factor   = opts.factor   || FACTOR_CARD;
  const proxify  = opts.proxify  || (u => u);

  class WooScraper extends BaseScraper {
    constructor() {
      super(storeId, storeName);
      this.seenIds = new Set();
    }

    async scrapeAll() {
      for (const cat of categories) {
        try {
          await this.scrapeCategory(cat);
          await this.delay(2000, 3500);
        } catch (err) {
          this.stats.errors++;
          this.log('warn', `[${storeId}] Error ${cat.catId}: ${err.message}`);
        }
      }
    }

    async scrapeCategory(cat) {
      let page  = 1;
      let total = 0;

      while (page <= 20) {
        const url = proxify(`${baseApi}?category=${cat.slug}&per_page=100&page=${page}`);
        this.log('info', `[${storeId}] ${cat.catId} "${cat.slug}" pág ${page}`);

        let products;
        try {
          const res = await this.client.get(url, {
            headers: { Accept: 'application/json' },
            timeout: 30000,
          });
          products = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          if (!Array.isArray(products) || !products.length) break;
        } catch (err) {
          this.log('warn', `[${storeId}] HTTP error: ${err.message}`);
          if (err.response?.status === 429) await this.delay(15000, 20000);
          break;
        }

        let newInPage = 0;
        for (const p of products) {
          try {
            if (this.seenIds.has(p.id)) continue;
            this.seenIds.add(p.id);

            const name = p.name?.trim();
            if (!name || name.length < 4) continue;

            // WC Store API devuelve precios en centavos — dividir por 100
            const rawPrice = parseInt(p.prices?.price);
            const priceCard = rawPrice > 10000 ? Math.round(rawPrice / 100) : rawPrice;
            if (!priceCard || priceCard < 1000) continue;

            const priceCash   = Math.round(priceCard / factor / 10) * 10;
            const rawRegular  = parseInt(p.prices?.regular_price);
            const regularCard = rawRegular > 10000 ? Math.round(rawRegular / 100) : rawRegular;
            const regularCash = regularCard > priceCard
              ? Math.round(regularCard / factor / 10) * 10 : null;
            const discount = regularCash
              ? Math.round((1 - priceCash / regularCash) * 100) : null;

            const stock = p.is_in_stock ? 'in_stock' : 'out_of_stock';

            let sub = cat.sub || null;
            if (!sub) {
              if (cat.catId === 'storage') sub = classifyStorage(name);
              if (cat.catId === 'mobo')    sub = classifyMobo(name);
            }

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
                  'Efectivo / Transferencia': `$${priceCash.toLocaleString('es-CL')}`,
                  'Tarjeta crédito/débito':   `$${priceCard.toLocaleString('es-CL')}`,
                },
              },
              { current: priceCash, normal: regularCash, discount, stock, url: p.permalink || null }
            );
          } catch (err) {
            this.log('warn', `[${storeId}] item error: ${err.message}`);
          }
        }

        total += newInPage;
        this.log('info', `[${storeId}] ✓ "${cat.slug}" pág ${page}: ${newInPage}`);
        if (products.length < 100) break;
        page++;
        await this.delay(1500, 2500);
      }

      this.log('info', `[${storeId}] ✓ ${cat.slug}: ${total} total`);
    }
  }

  return WooScraper;
}

module.exports = { createWooScraper };
