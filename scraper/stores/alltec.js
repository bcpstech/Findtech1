/**
 * scraper/stores/alltec.js
 * PrestaShop HTML scraping — categorías de hardware de alltec.cl
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.alltec.cl';

// Categorías verificadas desde la consola de alltec.cl
const CATEGORIES = [
  { url: '/31-para-amd',                    catId: 'mobo'    },
  { url: '/79-para-intel',                  catId: 'mobo'    },
  { url: '/81-sin-fuente-de-poder',         catId: 'case'    },
  { url: '/82-con-fuente-de-poder',         catId: 'case'    },
  { url: '/38-potencia-nominal-estandar',   catId: 'psu'     },
  { url: '/80-potencia-real-certificadas',  catId: 'psu'     },
  { url: '/16-gabinetes',                   catId: 'case'    },
  { url: '/18-fuentes-de-poder',            catId: 'psu'     },
  { url: '/17-placas-madre',                catId: 'mobo'    },
];

// Porcentaje recargo tarjeta Alltec (ajustar si se confirma otro valor)
const CARD_SURCHARGE = 1.03; // +3%

class AlltecScraper extends BaseScraper {
  constructor() { super('alltec', 'Alltec'); }

  async scrapeAll() {
    // Usamos un Set para evitar productos duplicados entre subcategorías
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
      this.log('info', `[at] ${catId} ${categoryPath} pág ${page}`);

      try {
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          }
        });

        const $ = cheerio.load(res.data);
        const items = $('article.product-miniature');

        if (!items.length) {
          this.log('info', `[at] Sin productos en pág ${page}, terminando`);
          break;
        }

        let newInPage = 0;

        items.each((_, el) => {
          try {
            const $el = $(el);

            const productUrl = $el.find('a.thumbnail').attr('href')
                            || $el.find('h3.product-title a').attr('href')
                            || '';

            // Evitar duplicados entre subcategorías
            if (this.seenUrls.has(productUrl)) return;
            this.seenUrls.add(productUrl);

            const name = $el.find('h3.product-title a').text().trim()
                      || $el.find('.product-title a').text().trim();
            if (!name) return;

            // Precio efectivo (precio principal en PrestaShop)
            const priceRaw = $el.find('.price').first().text().trim()
                           || $el.find('[itemprop="price"]').attr('content') || '';
            const price = this.parsePrice(priceRaw);
            if (!price || price < 1000) return;

            // Precio normal (tachado) si existe oferta
            const regularRaw = $el.find('.regular-price').text().trim();
            const regularPrice = regularRaw ? this.parsePrice(regularRaw) : null;

            // Precio tarjeta
            const priceCard = Math.round(price * CARD_SURCHARGE);

            const imageUrl = $el.find('img.product-thumbnail').attr('data-src')
                          || $el.find('img.product-thumbnail').attr('src')
                          || null;

            const brand = this.extractBrand(name);

            this.stats.found++;
            newInPage++;

            this.saveProduct(
              {
                name,
                category: catId,
                brand,
                imageUrl,
                specs: {
                  'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
                  'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
                }
              },
              {
                current:  price,
                normal:   regularPrice > price ? regularPrice : null,
                discount: regularPrice > price ? Math.round((1 - price / regularPrice) * 100) : null,
                stock:    $el.find('.product-unavailable').length ? 'out_of_stock' : 'in_stock',
                url:      productUrl || null,
              }
            );
          } catch (itemErr) {
            this.log('warn', `[at] Error parseando item: ${itemErr.message}`);
          }
        });

        this.log('info', `[at] ✓ ${catId} pág ${page}: ${newInPage} nuevos`);

        // Si la página tiene menos de 12 items, es la última
        if (items.length < 12) break;
        page++;
        await this.delay(1000, 2000);

      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[at] Error HTTP ${categoryPath} pág ${page}: ${err.message}`);
        break;
      }
    }

    this.log('info', `✓ ${catId} total acumulado: ${this.stats.found} productos`);
  }

  // Convierte "$63.897" o "63897" a número entero
  parsePrice(str) {
    if (!str) return null;
    const clean = str.replace(/[^\d]/g, '');
    const num = parseInt(clean);
    return isNaN(num) ? null : num;
  }
}

if (require.main === module) {
  new AlltecScraper().run().then(r => {
    console.log('Alltec:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = AlltecScraper;
