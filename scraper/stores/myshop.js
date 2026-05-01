/**
 * scraper/stores/myshop.js
 * MyShop — Jumpseller, usa endpoint /buscar.json público
 * Factor tarjeta: 1.03
 */
require('dotenv').config();
const BaseScraper = require('../base-scraper');

const BASE      = 'https://www.myshop.cl';
const PROXY_URL = process.env.CF_PROXY_URL    || '';
const PROXY_KEY = process.env.CF_PROXY_SECRET || '';
const FACTOR    = 1.03;

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

function parsePrice(raw) {
  if (!raw) return null;
  const n = parseInt(String(raw).replace(/[^\d]/g, ''));
  return n > 1000 && n < 100000000 ? n : null;
}

// Categorías y sus términos de búsqueda
const SEARCH_QUERIES = [
  // Procesadores
  { q: 'procesador amd ryzen',    catId: 'cpu',     sub: 'amd'    },
  { q: 'procesador intel core',   catId: 'cpu',     sub: 'intel'  },
  // GPU
  { q: 'tarjeta video nvidia rtx', catId: 'gpu',    sub: 'nvidia' },
  { q: 'tarjeta video nvidia gtx', catId: 'gpu',    sub: 'nvidia' },
  { q: 'tarjeta video amd radeon', catId: 'gpu',    sub: 'amd'    },
  // RAM
  { q: 'memoria ram ddr5',         catId: 'ram',    sub: 'ddr5'   },
  { q: 'memoria ram ddr4',         catId: 'ram',    sub: 'ddr4'   },
  // Storage
  { q: 'ssd m.2 nvme',             catId: 'storage', sub: 'nvme'  },
  { q: 'ssd sata 2.5',             catId: 'storage', sub: 'sata'  },
  // Cooling
  { q: 'refrigeracion liquida aio', catId: 'cooling', sub: 'liquida' },
  { q: 'disipador cpu cooler',      catId: 'cooling', sub: 'aire'    },
  { q: 'ventilador gabinete argb',  catId: 'cooling', sub: 'fans'    },
  { q: 'pasta disipadora termica',  catId: 'cooling', sub: 'pasta'   },
  // Mobo
  { q: 'placa madre amd am5',      catId: 'mobo',   sub: 'am5'    },
  { q: 'placa madre amd am4',      catId: 'mobo',   sub: 'am4'    },
  { q: 'placa madre intel lga1851', catId: 'mobo',  sub: 'lga1851' },
  { q: 'placa madre intel lga1700', catId: 'mobo',  sub: 'lga1700' },
  // PSU
  { q: 'fuente poder modular gold', catId: 'psu',   sub: 'modular' },
  { q: 'fuente poder 80 plus',      catId: 'psu'                   },
  // Case
  { q: 'gabinete atx torre',        catId: 'case',  sub: 'atx'    },
  { q: 'gabinete micro atx matx',   catId: 'case',  sub: 'matx'   },
  { q: 'gabinete mini itx',         catId: 'case',  sub: 'itx'    },
  // PC
  { q: 'pc gamer escritorio amd',   catId: 'pc'                    },
  { q: 'pc gamer escritorio intel', catId: 'pc'                    },
];

class MyShopScraper extends BaseScraper {
  constructor() {
    super('myshop', 'MyShop');
    this.seenIds  = new Set();
  }

  async scrapeAll() {
    for (const query of SEARCH_QUERIES) {
      try {
        await this.scrapeSearch(query);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[myshop] Error búsqueda "${query.q}": ${err.message}`);
      }
    }
  }

  async scrapeSearch(query) {
    let page = 1;
    let total = 0;

    while (page <= 15) {
      // Jumpseller search endpoint — devuelve JSON con los productos
      const searchUrl = `${BASE}/buscar.json?q=${encodeURIComponent(query.q)}&page=${page}&per_page=50`;
      this.log('info', `[myshop] "${query.q}" pág ${page}`);

      let data;
      try {
        const res = await this.client.get(proxify(searchUrl), {
          headers: {
            'Accept':          'application/json, text/javascript, */*',
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer':         `${BASE}/buscar?q=${encodeURIComponent(query.q)}`,
          },
          timeout: 25000,
        });
        data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      } catch (err) {
        this.log('warn', `[myshop] HTTP error: ${err.message}`);
        break;
      }

      // Jumpseller search returns { products: [...] } or { results: [...] }
      const products = data?.products || data?.results || data?.data || (Array.isArray(data) ? data : []);

      if (!products.length) {
        this.log('info', `[myshop] Sin resultados pág ${page} para "${query.q}"`);
        break;
      }

      let newInPage = 0;
      for (const item of products) {
        try {
          const id = item.id || item.product_id;
          if (!id || this.seenIds.has(id)) continue;
          this.seenIds.add(id);

          const name = item.name || item.title || '';
          if (!name || name.length < 4) continue;

          // Price
          const price = parsePrice(item.price) ||
                        parsePrice(item.price_min) ||
                        parsePrice(item.variants?.[0]?.price);
          if (!price) continue;

          const priceCard = Math.round(price * FACTOR);

          // Stock
          const stock = item.available === false || item.stock === 0 ||
                        item.status === 'unavailable' ? 'out_of_stock' : 'in_stock';

          // URL
          const slug = item.url || item.permalink || item.handle || '';
          const productUrl = slug.startsWith('http') ? slug : `${BASE}${slug.startsWith('/') ? '' : '/'}${slug}`;

          // Image
          const imageUrl = item.image?.url || item.image_url ||
                          item.images?.[0]?.url || item.featured_image || null;

          this.stats.found++;
          newInPage++;

          await this.saveProductWithR2(
            {
              name,
              category: query.catId,
              brand: this.extractBrand(name),
              imageUrl,
              specs: {
                'Efectivo / Transferencia': `$${price.toLocaleString('es-CL')}`,
                'Tarjeta crédito/débito':   `$${priceCard.toLocaleString('es-CL')}`,
              },
            },
            { current: price, normal: priceCard, discount: null, stock, url: productUrl }
          );
        } catch (err) {
          this.log('warn', `[myshop] item error: ${err.message}`);
        }
      }

      total += newInPage;
      this.log('info', `[myshop] ✓ "${query.q}" pág ${page}: ${newInPage}`);

      // Check if more pages exist
      const hasMore = products.length >= 50;
      if (!hasMore || newInPage === 0) break;
      page++;
      await this.delay(1500, 2500);
    }

    this.log('info', `[myshop] ✓ "${query.q}": ${total} total`);
  }
}

if (require.main === module) {
  new MyShopScraper().run().then(r => {
    console.log('MyShop:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = MyShopScraper;
