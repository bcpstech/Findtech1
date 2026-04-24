/**
 * scraper/stores/alltec.js
 * HTML scraping — alltec.cl (PrestaShop con tema personalizado)
 * Selectores reales verificados en consola del navegador:
 *   - Items: ul.products > li
 *   - Nombre: .product-name (dentro de h5 > a)
 *   - URL: a.products-block-image[href]
 *   - Imagen: img.img-responsive[src]
 *   - Precio: .price-box span.price → "$ 52,900" (coma como miles)
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.alltec.cl';

const CATEGORIES = [
  { url: '/31-para-amd',                   catId: 'mobo'    },
  { url: '/79-para-intel',                 catId: 'mobo'    },
  { url: '/81-sin-fuente-de-poder',        catId: 'case'    },
  { url: '/82-con-fuente-de-poder',        catId: 'case'    },
  { url: '/38-potencia-nominal-estandar',  catId: 'psu'     },
  { url: '/80-potencia-real-certificadas', catId: 'psu'     },
  { url: '/16-gabinetes',                  catId: 'case'    },
  { url: '/18-fuentes-de-poder',           catId: 'psu'     },
  { url: '/17-placas-madre',               catId: 'mobo'    },
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

        // Selector real: ul.products > li (tema personalizado Alltec)
        const items = $('ul.products li');

        if (!items.length) {
          this.log('info', `[alltec] Sin productos en pág ${page}`);
          break;
        }

        let newInPage = 0;

        items.each((_, el) => {
          try {
            const $el = $(el);

            // URL desde el enlace de imagen
            const productUrl = $el.find('a.products-block-image').attr('href')
                            || $el.find('a').first().attr('href') || '';

            if (this.seenUrls.has(productUrl)) return;
            this.seenUrls.add(productUrl);

            // Nombre desde .product-name o del atributo title del enlace
            const name = $el.find('.product-name').text().trim()
                      || $el.find('a.products-block-image').attr('title') || '';
            if (!name) return;

            // Precio formato: "$ 52,900" — remover $ y reemplazar coma por punto
            const priceRaw = $el.find('.price-box span.price, .price').first().text().trim();
            const price = this.parseAlltecPrice(priceRaw);
            if (!price || price < 1000) return;

            // Precio tachado si hay oferta
            const oldRaw = $el.find('.price-box .old-price, .regular-price').text().trim();
            const regularPrice = oldRaw ? this.parseAlltecPrice(oldRaw) : null;

            const priceCard = Math.round(price * CARD_SURCHARGE);

            // Imagen
            const imageUrl = $el.find('img.img-responsive').attr('src')
                          || $el.find('img').first().attr('src') || null;

            this.stats.found++;
            newInPage++;

            this.saveProduct(
              {
                name,
                category: catId,
                brand: this.extractBrand(name),
                imageUrl,
                specs: {
                  'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
                  'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
                }
              },
              {
                current:  price,
                normal:   regularPrice > price ? regularPrice : null,
                discount: regularPrice > price
                  ? Math.round((1 - price / regularPrice) * 100) : null,
                stock:    'in_stock',
                url:      productUrl || null,
              }
            );
          } catch (err) {
            this.log('warn', `[alltec] Error parseando item: ${err.message}`);
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

  // Precio formato Alltec: "$ 52,900" → 52900
  parseAlltecPrice(str) {
    if (!str) return null;
    // Remover símbolo $, espacios y reemplazar coma por nada (es separador de miles)
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
