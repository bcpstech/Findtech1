/**
 * scraper/stores/sandos.js
 * Sandos — WooCommerce Store API con fallback a búsqueda HTML
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL    = 'https://www.sandos.cl';
const BASE_API    = 'https://www.sandos.cl/wp-json/wc/store/v1/products';
const CARD_FACTOR = 1.03;
const PROXY_URL    = process.env.CF_PROXY_URL    || '';
const PROXY_SECRET = process.env.CF_PROXY_SECRET || '';

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_SECRET}`;
}

const API_CATEGORIES = [
  { slug: 'tarjetas-de-video',  catId: 'gpu'     },
  { slug: 'procesadores',       catId: 'cpu'     },
  { slug: 'placas-madre',       catId: 'mobo'    },
  { slug: 'memorias-ram',       catId: 'ram'     },
  { slug: 'almacenamiento',     catId: 'storage' },
  { slug: 'refrigeracion',      catId: 'cooling' },
  { slug: 'fuentes-de-poder',   catId: 'psu'     },
  { slug: 'gabinetes',          catId: 'case'    },
];

const HTML_SEARCHES = [
  { query: 'rtx',          catId: 'gpu',     minPrice: 80000  },
  { query: 'radeon rx',    catId: 'gpu',     minPrice: 80000  },
  { query: 'ryzen',        catId: 'cpu',     minPrice: 20000  },
  { query: 'core i',       catId: 'cpu',     minPrice: 20000  },
  { query: 'placa madre',  catId: 'mobo',    minPrice: 30000  },
  { query: 'memoria ddr',  catId: 'ram',     minPrice: 10000  },
  { query: 'ssd nvme',     catId: 'storage', minPrice: 15000  },
  { query: 'fuente poder', catId: 'psu',     minPrice: 20000  },
  { query: 'gabinete',     catId: 'case',    minPrice: 20000  },
];

const OUT_OF_STOCK = ['sin stock','agotado','out of stock','no disponible','sold out'];

class SandosScraper extends BaseScraper {
  constructor() {
    super('sandos', 'Sandos');
    this.useApi = true;
  }

  async scrapeAll() {
    try {
      const test = await this.client.get(`${BASE_API}?category=procesadores&per_page=1`, {
        headers: { Accept: 'application/json' }, timeout: 10000
      });
      this.useApi = Array.isArray(test.data) && test.data.length > 0;
    } catch(e) {
      this.useApi = false;
    }
    this.log('info', `[sandos] Modo: ${this.useApi ? 'WooCommerce API' : 'HTML scraping'}`);
    if (this.useApi) await this.scrapeViaApi();
    else await this.scrapeViaHtml();
  }

  async scrapeViaApi() {
    for (const { slug, catId } of API_CATEGORIES) {
      let page = 1;
      while (page <= 20) {
        const url = `${BASE_API}?category=${slug}&per_page=100&page=${page}`;
        try {
          const res = await this.client.get(url, { headers: { Accept: 'application/json' } });
          const products = res.data;
          if (!products?.length) break;
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
          this.log('warn', `[sandos] API error ${slug} pág ${page}: ${err.message}`);
          if (err.response?.status === 429) await new Promise(r => setTimeout(r, 15000));
          break;
        }
      }
      await this.delay(2000, 3500);
    }
  }

  async scrapeViaHtml() {
    this.seenUrls = new Set();
    for (const { query, catId, minPrice } of HTML_SEARCHES) {
      try {
        const searchUrl = proxify(`${BASE_URL}/?s=${encodeURIComponent(query)}&post_type=product`);
        const res = await this.client.get(searchUrl, {
          headers: { 'Accept': 'text/html', 'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36' }
        });
        const $ = cheerio.load(res.data);
        const items = $('ul.products li.product, .products .product');
        let newItems = 0;
        for (const el of items.toArray()) {
          try {
            const $el = $(el);
            const productUrl = $el.find('a').first().attr('href') || '';
            if (!productUrl || this.seenUrls.has(productUrl)) continue;
            this.seenUrls.add(productUrl);
            const name = $el.find('.woocommerce-loop-product__title, h2, h3').first().text().trim();
            if (!name || name.length < 5) continue;
            const priceRaw = $el.find('.price ins .amount, .price .amount').first().text()
                          || $el.find('.price').first().text();
            const price = this.parsePrice(priceRaw);
            if (!price || price < minPrice) continue;
            const stockTxt = $el.text().toLowerCase();
            const stock = OUT_OF_STOCK.some(s => stockTxt.includes(s)) ? 'out_of_stock' : 'in_stock';
            const priceCard = Math.round(price * CARD_FACTOR);
            this.stats.found++;
            newItems++;
            await this.saveProductWithR2(
              { name, category: catId, brand: this.extractBrand(name),
                imageUrl: $el.find('img').first().attr('src') || null,
                specs: { 'Transferencia/Efectivo': `$${price.toLocaleString('es-CL')}`,
                          'Webpay / Tarjeta':       `$${priceCard.toLocaleString('es-CL')}` }
              },
              { current: price, normal: null, discount: null, stock, url: productUrl }
            );
          } catch(e) {}
        }
        this.log('info', `[sandos] HTML "${query}": ${newItems} productos`);
        await this.delay(2000, 3000);
      } catch(err) {
        this.log('warn', `[sandos] HTML error "${query}": ${err.message}`);
      }
    }
  }
}

if (require.main === module) {
  new SandosScraper().run().then(r => {
    console.log('Sandos:', r); process.exit(r.success ? 0 : 1);
  });
}
module.exports = SandosScraper;
