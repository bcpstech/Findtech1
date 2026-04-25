/**
 * scraper/stores/pcexpress.js
 * PC-Express OpenCart — búsqueda HTML con selectores mejorados
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL     = 'https://tienda.pc-express.cl';
const PROXY_URL    = process.env.CF_PROXY_URL    || '';
const PROXY_SECRET = process.env.CF_PROXY_SECRET || '';

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_SECRET}`;
}

const SEARCHES = [
  { query: 'rtx',                catId: 'gpu',     minPrice: 80000  },
  { query: 'radeon rx',          catId: 'gpu',     minPrice: 80000  },
  { query: 'ryzen',              catId: 'cpu',     minPrice: 20000  },
  { query: 'core intel',         catId: 'cpu',     minPrice: 20000  },
  { query: 'placa madre',        catId: 'mobo',    minPrice: 30000  },
  { query: 'memoria ram ddr',    catId: 'ram',     minPrice: 10000  },
  { query: 'ssd nvme',           catId: 'storage', minPrice: 15000  },
  { query: 'ssd sata',           catId: 'storage', minPrice: 10000  },
  { query: 'fuente poder',       catId: 'psu',     minPrice: 20000  },
  { query: 'gabinete',           catId: 'case',    minPrice: 20000  },
  { query: 'refrigeracion aio',  catId: 'cooling', minPrice: 30000  },
  { query: 'cooler disipador',   catId: 'cooling', minPrice: 8000   },
];

const CARD_SURCHARGE = 1.03;
const OUT_OF_STOCK = ['out of stock','sin stock','agotado','no disponible'];

function detectStock($el) {
  const txt = $el.find('[class*="stock"],.stock,.availability').text().toLowerCase()
            + $el.find('button[disabled]').text().toLowerCase();
  if (OUT_OF_STOCK.some(p => txt.includes(p))) return 'out_of_stock';
  if ($el.find('.out-of-stock').length) return 'out_of_stock';
  return 'in_stock';
}

class PCExpressScraper extends BaseScraper {
  constructor() { super('pcexpress', 'PC-Express'); }

  async scrapeAll() {
    this.seenUrls = new Set();
    for (const cat of SEARCHES) {
      try {
        await this.scrapeSearch(cat);
        await this.delay(2000, 3000);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error ${cat.catId} "${cat.query}": ${err.message}`);
      }
    }
  }

  async scrapeSearch({ query, catId, minPrice }) {
    for (let page = 1; page <= 5; page++) {
      const directUrl = `${BASE_URL}/index.php?route=product/search&search=${encodeURIComponent(query)}&sort=p.price&order=ASC&limit=50&page=${page}`;
      const url = proxify(directUrl);
      this.log('info', `[pcx] ${catId} "${query}" pág ${page}`);

      try {
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': BASE_URL,
          }
        });

        const $ = cheerio.load(res.data);
        let newInPage = 0;

        // OpenCart usa .product-layout o .product-thumb
        const items = $('.product-layout, .product-thumb');

        if (!items.length) {
          this.log('info', `[pcx] Sin items pág ${page}`);
          break;
        }

        for (const el of items.toArray()) {
          try {
            const $el = $(el);

            // URL del producto
            const productUrl = $el.find('a[href*="product_id"], .product-img a, h4 a').first().attr('href') || '';
            if (!productUrl || this.seenUrls.has(productUrl)) continue;

            // Nombre
            const name = $el.find('h4 a, .product-name a, a[title]').first().text().trim()
                      || $el.find('a[title]').first().attr('title') || '';
            if (!name || name.length < 5) continue;

            // Precio
            const priceRaw = $el.find('.price-new, .price-normal, .price').first().text().trim();
            const price = this.parsePrice(priceRaw);
            if (!price || price < minPrice) continue;

            this.seenUrls.add(productUrl);

            const stock = detectStock($el);
            const oldRaw = $el.find('.price-old').first().text().trim();
            const regularPrice = oldRaw ? this.parsePrice(oldRaw) : null;
            const priceCard = Math.round(price * CARD_SURCHARGE);
            const imageUrl = $el.find('img').first().attr('src')
                          || $el.find('img').first().attr('data-src') || null;

            this.stats.found++;
            newInPage++;
            await this.saveProductWithR2(
              { name, category: catId, brand: this.extractBrand(name), imageUrl,
                specs: {
                  'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
                  'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
                }
              },
              { current: price,
                normal: regularPrice > price ? regularPrice : null,
                discount: regularPrice > price ? Math.round((1-price/regularPrice)*100) : null,
                stock,
                url: productUrl.startsWith('http') ? productUrl : `${BASE_URL}${productUrl}` }
            );
          } catch(e) {}
        }

        this.log('info', `[pcx] ✓ "${query}" pág ${page}: ${newInPage} nuevos`);
        if (newInPage === 0 || items.length < 10) break;
        await this.delay(1500, 2500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[pcx] Error HTTP "${query}" pág ${page}: ${err.message}`);
        break;
      }
    }
    this.log('info', `✓ pcx ${catId} total: ${this.stats.found}`);
  }
}

if (require.main === module) {
  new PCExpressScraper().run().then(r => { console.log('PC-Express:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = PCExpressScraper;
