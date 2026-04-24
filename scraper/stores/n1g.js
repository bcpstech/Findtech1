/**
 * scraper/stores/n1g.js
 * PrestaShop HTML scraping — n1g.cl
 * Precio formato: "49.900 $" (número primero, símbolo después)
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL = 'https://n1g.cl';

const CATEGORIES = [
  { url: '/Home/39-tarjetas-graficas', catId: 'gpu'     },
  { url: '/Home/34-procesadores',      catId: 'cpu'     },
  { url: '/Home/33-placas-madre',      catId: 'mobo'    },
  { url: '/Home/27-memorias',          catId: 'ram'     },
  { url: '/Home/22-almacenamiento',    catId: 'storage' },
  { url: '/Home/35-refrigeracion',     catId: 'cooling' },
  { url: '/Home/24-gabinetes',         catId: 'case'    },
  { url: '/Home/23-fuentes-de-poder',  catId: 'psu'     },
];

// N1G no muestra precio diferenciado efectivo/tarjeta en la lista
// Asumimos precio único (efectivo). Si hay recargo tarjeta confirmar.
const CARD_SURCHARGE = 1.03;

class N1GScraper extends BaseScraper {
  constructor() { super('n1g', 'N1G'); }

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
      this.log('info', `[n1g] ${catId} pág ${page}`);

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
          this.log('info', `[n1g] Sin productos en pág ${page}`);
          break;
        }

        let newInPage = 0;

        items.each((_, el) => {
          try {
            const $el = $(el);
            const productUrl = $el.find('a.thumbnail').attr('href')
                            || $el.find('.product-title a').attr('href') || '';

            if (this.seenUrls.has(productUrl)) return;
            this.seenUrls.add(productUrl);

            const name = $el.find('.product-title, h3.product-title').text().trim();
            if (!name) return;

            // Precio en formato "49.900 $" — limpiar símbolo al final
            const priceRaw = $el.find('.price').first().text().trim();
            const price = this.parsePrice(priceRaw);
            if (!price || price < 1000) return;

            const regularRaw = $el.find('.regular-price').text().trim();
            const regularPrice = regularRaw ? this.parsePrice(regularRaw) : null;

            const priceCard = Math.round(price * CARD_SURCHARGE);

            const imageUrl = $el.find('img.product-thumbnail').attr('data-src')
                          || $el.find('img.product-thumbnail').attr('src')
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
                  'Efectivo/Transferencia':    `$${price.toLocaleString('es-CL')}`,
                  'Tarjeta crédito/débito':    `$${priceCard.toLocaleString('es-CL')}`,
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
          } catch (err) {
            this.log('warn', `[n1g] Error parseando item: ${err.message}`);
          }
        });

        this.log('info', `[n1g] ✓ ${catId} pág ${page}: ${newInPage} nuevos`);
        if (items.length < 12) break;
        page++;
        await this.delay(1000, 2000);

      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[n1g] Error HTTP ${categoryPath} pág ${page}: ${err.message}`);
        break;
      }
    }
    this.log('info', `✓ n1g ${catId} total: ${this.stats.found}`);
  }
}

if (require.main === module) {
  new N1GScraper().run().then(r => {
    console.log('N1G:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = N1GScraper;
