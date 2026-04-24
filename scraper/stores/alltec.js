/**
 * scraper/stores/alltec.js
 * Categorías específicas verificadas — sin accesorios
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.alltec.cl';

const CATEGORIES = [
  // GPU
  { url: '/63-amd',                        catId: 'gpu'     },
  { url: '/64-nvidia',                     catId: 'gpu'     },
  // CPU
  { url: '/28-amd',                        catId: 'cpu'     },
  { url: '/29-intel',                      catId: 'cpu'     },
  // Placas Madre
  { url: '/31-para-amd',                   catId: 'mobo'    },
  { url: '/79-para-intel',                 catId: 'mobo'    },
  // RAM
  { url: '/37-ddr4',                       catId: 'ram'     },
  { url: '/118-ddr5',                      catId: 'ram'     },
  // Almacenamiento
  { url: '/34-ssd',                        catId: 'storage' },
  { url: '/33-mecanicos-rigidos',          catId: 'storage' },
  // Refrigeración
  { url: '/92-water-cooling',              catId: 'cooling' },
  { url: '/93-cpu-cooler',                 catId: 'cooling' },
  // Fuentes
  { url: '/38-potencia-nominal-estandar',  catId: 'psu'     },
  { url: '/80-potencia-real-certificadas', catId: 'psu'     },
  // Gabinetes
  { url: '/81-sin-fuente-de-poder',        catId: 'case'    },
  { url: '/82-con-fuente-de-poder',        catId: 'case'    },
];

const CARD_SURCHARGE = 1.03;

class AlltecScraper extends BaseScraper {
  constructor() { super('alltec', 'Alltec'); }

  async scrapeAll() {
    this.seenUrls = new Set();
    for (const { url, catId } of CATEGORIES) {
      try {
        await this.scrapeCategory(url, catId);
        await this.delay(1500, 2500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error ${catId} (${url}): ${err.message}`);
      }
    }
  }

  async scrapeCategory(categoryPath, catId) {
    let page = 1;

    while (page <= 20) {
      const url = `${BASE_URL}${categoryPath}?page=${page}`;
      this.log('info', `[alltec] ${catId} ${categoryPath} pág ${page}`);

      try {
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.alltec.cl/',
          }
        });

        const $ = cheerio.load(res.data);
        const items = $('ul.products li');

        if (!items.length) {
          this.log('info', `[alltec] Sin productos pág ${page} — li:${$('li').length} ul:${$('ul').length}`);
          break;
        }

        let newInPage = 0;
        items.each((_, el) => {
          try {
            const $el = $(el);
            const productUrl = $el.find('a.products-block-image').attr('href')
                            || $el.find('a').first().attr('href') || '';
            if (this.seenUrls.has(productUrl)) return;
            this.seenUrls.add(productUrl);

            const name = $el.find('.product-name').text().trim()
                      || $el.find('a.products-block-image').attr('title') || '';
            if (!name) return;

            const priceRaw = $el.find('.price-box span.price, .price').first().text().trim();
            const price = this.parseAlltecPrice(priceRaw);
            if (!price || price < 1000) return;

            const oldRaw = $el.find('.price-box .old-price, .regular-price').text().trim();
            const regularPrice = oldRaw ? this.parseAlltecPrice(oldRaw) : null;
            const priceCard = Math.round(price * CARD_SURCHARGE);
            const imageUrl = $el.find('img.img-responsive').attr('src')
                          || $el.find('img').first().attr('src') || null;

            this.stats.found++;
            newInPage++;
            this.saveProduct(
              { name, category: catId, brand: this.extractBrand(name), imageUrl,
                specs: {
                  'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
                  'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
                }
              },
              { current: price, normal: regularPrice > price ? regularPrice : null,
                discount: regularPrice > price ? Math.round((1-price/regularPrice)*100) : null,
                stock: 'in_stock', url: productUrl || null }
            );
          } catch (err) {
            this.log('warn', `[alltec] Error item: ${err.message}`);
          }
        });

        this.log('info', `[alltec] ✓ ${catId} pág ${page}: ${newInPage} nuevos`);
        if (items.length < 8) break;
        page++;
        await this.delay(1000, 2000);

      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[alltec] Error HTTP ${categoryPath} pág ${page}: ${err.message}`);
        break;
      }
    }
    this.log('info', `✓ alltec ${catId} total: ${this.stats.found}`);
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
