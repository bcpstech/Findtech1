/**
 * scraper/stores/alltec.js
 * Alltec usa PrestaShop pero los productos se cargan via AJAX.
 * Solución: usar el endpoint AJAX interno de PrestaShop ps_facetedsearch
 * o el endpoint de categorías con parámetro ajax=1
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.alltec.cl';

const CATEGORIES = [
  { id: 63,  catId: 'gpu',     name: 'GPU AMD'       },
  { id: 64,  catId: 'gpu',     name: 'GPU NVIDIA'    },
  { id: 28,  catId: 'cpu',     name: 'CPU AMD'       },
  { id: 29,  catId: 'cpu',     name: 'CPU Intel'     },
  { id: 31,  catId: 'mobo',    name: 'Mobo AMD'      },
  { id: 79,  catId: 'mobo',    name: 'Mobo Intel'    },
  { id: 37,  catId: 'ram',     name: 'RAM DDR4'      },
  { id: 118, catId: 'ram',     name: 'RAM DDR5'      },
  { id: 34,  catId: 'storage', name: 'SSD'           },
  { id: 33,  catId: 'storage', name: 'HDD'           },
  { id: 92,  catId: 'cooling', name: 'Water Cooling' },
  { id: 93,  catId: 'cooling', name: 'CPU Cooler'    },
  { id: 38,  catId: 'psu',     name: 'PSU Estándar'  },
  { id: 80,  catId: 'psu',     name: 'PSU Cert.'     },
  { id: 81,  catId: 'case',    name: 'Gabinete S/F'  },
  { id: 82,  catId: 'case',    name: 'Gabinete C/F'  },
];

const CARD_SURCHARGE = 1.03;

class AlltecScraper extends BaseScraper {
  constructor() { super('alltec', 'Alltec'); }

  async scrapeAll() {
    this.seenUrls = new Set();
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategoryAjax(cat);
        await this.delay(2000, 3000);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error ${cat.name}: ${err.message}`);
      }
    }
  }

  async scrapeCategoryAjax({ id, catId, name }) {
    // Intentar endpoint AJAX de PrestaShop
    // PrestaShop expone los productos via módulo ps_facetedsearch o via controller category con ajax
    const endpoints = [
      // Endpoint 1: controller category con ajax
      `${BASE_URL}/index.php?fc=module&module=ps_facetedsearch&action=search&id_category=${id}&resultsPerPage=48&page=1`,
      // Endpoint 2: API REST de PrestaShop (sin key, solo lectura pública)  
      `${BASE_URL}/api/products?filter[id_category_default]=${id}&output_format=JSON&display=[id,name,price,link_rewrite]&limit=50`,
      // Endpoint 3: categoria normal con parámetro extra
      `${BASE_URL}/${id}?n=48`,
    ];

    let found = false;

    for (const url of endpoints) {
      try {
        this.log('info', `[alltec] ${name} probando: ${url.slice(0,80)}`);
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'application/json, text/html, */*',
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': `${BASE_URL}/`,
          },
          timeout: 15000,
        });

        const ct = res.headers['content-type'] || '';

        if (ct.includes('json')) {
          // Respuesta JSON
          const data = res.data;
          const prods = data.products || data.psxCart?.products || data.cart?.products || [];
          if (prods.length) {
            this.log('info', `[alltec] ${name} JSON: ${prods.length} productos`);
            for (const p of prods) {
              const price = parseInt(p.price) || parseInt(p.price_amount) || 0;
              if (!price) continue;
              const priceCard = Math.round(price * CARD_SURCHARGE);
              this.stats.found++;
              this.saveProduct(
                { name: p.name, category: catId, brand: this.extractBrand(p.name),
                  imageUrl: p.cover?.bySize?.home_default?.url || p.image?.url || null,
                  specs: {
                    'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
                    'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
                  }
                },
                { current: price, normal: null, discount: null,
                  stock: 'in_stock',
                  url: `${BASE_URL}/${p.id}-${p.link_rewrite}.html` }
              );
            }
            found = true;
            break;
          }
        } else {
          // Respuesta HTML — parsear
          const $ = cheerio.load(res.data);
          const items = $('ul.products li, .product-miniature, [class*="product-item"]');
          if (items.length) {
            this.log('info', `[alltec] ${name} HTML: ${items.length} items`);
            let newItems = 0;
            items.each((_, el) => {
              const $el = $(el);
              const productUrl = $el.find('a').first().attr('href') || '';
              if (this.seenUrls.has(productUrl)) return;
              this.seenUrls.add(productUrl);

              const pname = $el.find('.product-name, h3 a, h4 a').first().text().trim()
                         || $el.find('a').first().attr('title') || '';
              if (!pname) return;

              const priceRaw = $el.find('.price, [class*="price"]').first().text().trim();
              const price = this.parseAlltecPrice(priceRaw);
              if (!price) return;

              const priceCard = Math.round(price * CARD_SURCHARGE);
              const imageUrl = $el.find('img').first().attr('src')
                            || $el.find('img').first().attr('data-src') || null;

              this.stats.found++;
              newItems++;
              this.saveProduct(
                { name: pname, category: catId, brand: this.extractBrand(pname), imageUrl,
                  specs: {
                    'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
                    'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
                  }
                },
                { current: price, normal: null, discount: null,
                  stock: 'in_stock', url: productUrl }
              );
            });
            if (newItems > 0) { found = true; break; }
          }
        }
      } catch (e) {
        this.log('warn', `[alltec] ${name} endpoint falló: ${e.message}`);
      }
      await this.delay(500, 1000);
    }

    if (!found) {
      this.log('warn', `[alltec] ${name} sin productos en ningún endpoint`);
    }
    this.log('info', `✓ alltec ${name} total: ${this.stats.found}`);
  }

  parseAlltecPrice(str) {
    if (!str) return null;
    const clean = str.replace(/\$/g, '').replace(/,/g, '').replace(/\s/g, '');
    const num = parseInt(clean);
    if (isNaN(num) || num < 1000 || num > 100000000) return null;
    return num;
  }
}

if (require.main === module) {
  new AlltecScraper().run().then(r => {
    console.log('Alltec:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = AlltecScraper;
