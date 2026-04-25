/**
 * scraper/stores/sipo.js
 * Sipo.cl — WooCommerce con proxy (timeout sin él)
 */
const BaseScraper = require('../base-scraper');

const BASE_API     = 'https://sipo.cl/wp-json/wc/store/v1/products';
const CARD_FACTOR  = 1.03;
const PROXY_URL    = process.env.CF_PROXY_URL    || '';
const PROXY_SECRET = process.env.CF_PROXY_SECRET || '';

const CATEGORIES = [
  { slug: 'tarjetas-de-video',  catId: 'gpu'     },
  { slug: 'procesadores',       catId: 'cpu'     },
  { slug: 'placas-madre',       catId: 'mobo'    },
  { slug: 'memorias-ram',       catId: 'ram'     },
  { slug: 'almacenamiento',     catId: 'storage' },
  { slug: 'refrigeracion',      catId: 'cooling' },
  { slug: 'fuentes-de-poder',   catId: 'psu'     },
  { slug: 'gabinetes',          catId: 'case'    },
];

class SipoScraper extends BaseScraper {
  constructor() { super('sipo', 'Sipo'); }

  async scrapeAll() {
    for (const { slug, catId } of CATEGORIES) {
      try {
        await this.scrapeCategory(slug, catId);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error ${catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(slug, catId) {
    let page = 1;
    while (page <= 20) {
      // Usar proxy para evitar timeout desde GitHub Actions
      const targetUrl = `${BASE_API}?category=${slug}&per_page=100&page=${page}`;
      const url = PROXY_URL
        ? `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}&secret=${PROXY_SECRET}`
        : targetUrl;

      this.log('info', `[sipo] ${catId} pág ${page}`);
      try {
        const res = await this.client.get(url, {
          headers: { Accept: 'application/json' },
          timeout: 30000,
        });
        // El proxy devuelve texto — parsear si es string
        const products = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        if (!Array.isArray(products) || !products.length) break;

        for (const p of products) {
          const priceCard = parseInt(p.prices?.price);
          if (!priceCard || priceCard < 1000) continue;
          const priceCash = Math.round(priceCard / CARD_FACTOR / 10) * 10;
          const regularRaw = parseInt(p.prices?.regular_price);
          const regularCash = regularRaw > priceCard ? Math.round(regularRaw / CARD_FACTOR / 10) * 10 : null;
          const techSpecs = this.extractWooSpecs(p);
          this.stats.found++;
          await this.saveProductWithR2(
            { name: p.name, category: catId,
              brand: p.brands?.[0]?.name || this.extractBrand(p.name),
              imageUrl: p.images?.[0]?.src || null,
              specs: { ...techSpecs,
                'Transferencia/Efectivo': `$${priceCash.toLocaleString('es-CL')}`,
                'Webpay / Tarjeta':       `$${priceCard.toLocaleString('es-CL')}` }
            },
            { current: priceCash, normal: regularCash,
              discount: regularCash ? Math.round((1-priceCash/regularCash)*100) : null,
              stock: p.is_in_stock ? 'in_stock' : 'out_of_stock',
              url: p.permalink || null }
          );
        }
        if (products.length < 100) break;
        page++;
        await this.delay(1500, 2500);
      } catch(err) {
        this.stats.errors++;
        this.log('warn', `[sipo] Error ${slug} pág ${page}: ${err.message}`);
        if (err.response?.status === 429) await new Promise(r => setTimeout(r, 15000));
        break;
      }
    }
    this.log('info', `✓ sipo ${catId}: ${this.stats.found}`);
  }
}

if (require.main === module) {
  new SipoScraper().run().then(r => { console.log('Sipo:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = SipoScraper;
