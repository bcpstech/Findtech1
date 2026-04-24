/**
 * scraper/stores/n1g.js
 * PrestaShop HTML scraping — n1g.cl (NiceOne)
 * Selectores verificados en consola:
 *   - Items: article.product-miniature (48 por página)
 *   - Nombre: h3.h3.product-title a
 *   - Marca: .pl_manufacturer strong
 *   - Precio: .product-miniature .price → "49.900 $"
 *   - URL: h3.product-title a[href]
 *   - Imagen: .product-image-container img
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

// Palabras clave que indican accesorios a filtrar
const ACCESSORY_KEYWORDS = [
  'cable', 'adaptador', 'bracket', 'tornillo', 'pasta termica',
  'pasta térmica', 'soporte', 'accesorio', 'herramienta', 'limpiador',
  'teclado', 'mouse', 'auricular', 'headset', 'parlante', 'monitor',
  'silla', 'escritorio', 'pad', 'mousepad', 'webcam', 'microfono',
  'micrófono', 'control', 'joystick', 'cargador', 'hub usb',
];

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
        this.log('warn', `Error ${catId}: ${err.message}`);
      }
    }
  }

  isAccessory(name) {
    const lower = name.toLowerCase();
    return ACCESSORY_KEYWORDS.some(kw => lower.includes(kw));
  }

  async scrapeCategory(categoryPath, catId) {
    let page = 1;

    while (page <= 20) {
      const url = `${BASE_URL}${categoryPath}?page=${page}`;
      this.log('info', `[n1g] ${catId} pág ${page}`);

      try {
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-CL,es;q=0.9,en-US;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://n1g.cl/Home/',
            'Cache-Control': 'max-age=0',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
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

            // URL del producto
            const productUrl = $el.find('h3.product-title a, h3.h3.product-title a').attr('href')
                            || $el.find('a').first().attr('href') || '';
            if (this.seenUrls.has(productUrl)) return;
            this.seenUrls.add(productUrl);

            // Nombre
            const name = $el.find('h3.product-title a, h3.h3.product-title a').text().trim();
            if (!name || name.length < 3) return;

            // Filtrar accesorios
            if (this.isAccessory(name)) return;

            // Precio formato "49.900 $" — remover $ y espacios
            const priceRaw = $el.find('.price').first().text().trim();
            const price = this.parseN1GPrice(priceRaw);
            if (!price || price < 1000) return;

            // Precio tachado
            const oldRaw = $el.find('.regular-price, .old-price').first().text().trim();
            const regularPrice = oldRaw ? this.parseN1GPrice(oldRaw) : null;

            const priceCard = Math.round(price * CARD_SURCHARGE);

            // Marca
            const brand = $el.find('.pl_manufacturer strong').text().trim()
                       || this.extractBrand(name);

            // Imagen
            const imageUrl = $el.find('.product-image-container img').attr('data-src')
                          || $el.find('.product-image-container img').attr('src')
                          || $el.find('img').first().attr('src') || null;

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
                discount: regularPrice > price
                  ? Math.round((1 - price / regularPrice) * 100) : null,
                stock:    $el.find('.product-unavailable').length ? 'out_of_stock' : 'in_stock',
                url:      productUrl || null,
              }
            );
          } catch (err) {
            this.log('warn', `[n1g] Error item: ${err.message}`);
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

  // Precio formato N1G: "49.900 $" → 49900
  parseN1GPrice(str) {
    if (!str) return null;
    const clean = str.replace(/\$/g, '').replace(/\./g, '').replace(/\s/g, '');
    const num = parseInt(clean);
    if (isNaN(num) || num < 1000 || num > 100000000) return null;
    return num;
  }
}

if (require.main === module) {
  new N1GScraper().run().then(r => {
    console.log('N1G:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = N1GScraper;
