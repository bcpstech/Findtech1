/**
 * scraper/stores/pcexpress.js
 * OpenCart HTML scraping — tienda.pc-express.cl
 * URLs: ?route=product/category&path=XXX
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL = 'https://tienda.pc-express.cl';

const CATEGORIES = [
  // Tarjetas de video
  { url: '/index.php?route=product/category&path=460_475_158', catId: 'gpu'     }, // AMD Radeon
  { url: '/index.php?route=product/category&path=460_475_159', catId: 'gpu'     }, // NVIDIA Gamer
  // Procesadores
  { url: '/index.php?route=product/category&path=460_473_367', catId: 'cpu'     }, // AMD AM4
  { url: '/index.php?route=product/category&path=460_473_588', catId: 'cpu'     }, // Intel s1700
  { url: '/index.php?route=product/category&path=460_473_600', catId: 'cpu'     }, // Intel s1851
  // Placas Madre
  { url: '/index.php?route=product/category&path=460_472_369', catId: 'mobo'    }, // AMD AM4
  { url: '/index.php?route=product/category&path=460_472_590', catId: 'mobo'    }, // AMD AM5
  { url: '/index.php?route=product/category&path=460_472_589', catId: 'mobo'    }, // Intel s1700
  { url: '/index.php?route=product/category&path=460_472_599', catId: 'mobo'    }, // Intel s1851
  // Memorias
  { url: '/index.php?route=product/category&path=72_126',      catId: 'ram'     }, // Para PC
  // Almacenamiento
  { url: '/index.php?route=product/category&path=62_331_406',  catId: 'storage' }, // SSD M.2
  { url: '/index.php?route=product/category&path=62_331_407',  catId: 'storage' }, // SSD SATA
  { url: '/index.php?route=product/category&path=62_331_408',  catId: 'storage' }, // SSD NVMe
  { url: '/index.php?route=product/category&path=62_413_101',  catId: 'storage' }, // Discos PC
  // Fuentes
  { url: '/index.php?route=product/category&path=460_461_118', catId: 'psu'     }, // Estándar
  { url: '/index.php?route=product/category&path=460_461_279', catId: 'psu'     }, // Certificadas
  // Gabinetes
  { url: '/index.php?route=product/category&path=460_462_119', catId: 'case'    }, // Básicos
  { url: '/index.php?route=product/category&path=460_462_120', catId: 'case'    }, // Gamer
  // Refrigeración
  { url: '/index.php?route=product/category&path=460_473_169', catId: 'cooling' }, // Ventilación CPU
];

const CARD_SURCHARGE = 1.03;

class PCExpressScraper extends BaseScraper {
  constructor() { super('pcexpress', 'PC-Express'); }

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

  async scrapeCategory(categoryPath, catId) {
    let page = 1;

    while (page <= 20) {
      // OpenCart usa &page= para paginación
      const url = `${BASE_URL}${categoryPath}&page=${page}`;
      this.log('info', `[pcx] ${catId} pág ${page}`);

      try {
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          }
        });

        const $ = cheerio.load(res.data);
        // OpenCart usa .product-layout o .product-thumb
        const items = $('.product-layout, .product-thumb');

        if (!items.length) {
          this.log('info', `[pcx] Sin productos en pág ${page}`);
          break;
        }

        let newInPage = 0;

        items.each((_, el) => {
          try {
            const $el = $(el);

            const productUrl = $el.find('a').first().attr('href') || '';
            if (this.seenUrls.has(productUrl)) return;
            this.seenUrls.add(productUrl);

            const name = $el.find('.caption h4 a, .name a, h4 a').first().text().trim();
            if (!name) return;

            // OpenCart precio: puede tener precio normal tachado y precio oferta
            const priceNew  = $el.find('.price-new, .price').first().text().trim();
            const priceOld  = $el.find('.price-old').first().text().trim();

            const price = this.parsePrice(priceNew);
            if (!price || price < 1000) return;

            const regularPrice = priceOld ? this.parsePrice(priceOld) : null;
            const priceCard    = Math.round(price * CARD_SURCHARGE);

            const imageUrl = $el.find('img').first().attr('src') || null;

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
                discount: regularPrice > price ? Math.round((1 - price / regularPrice) * 100) : null,
                stock:    'in_stock',
                url:      productUrl || null,
              }
            );
          } catch (err) {
            this.log('warn', `[pcx] Error parseando item: ${err.message}`);
          }
        });

        this.log('info', `[pcx] ✓ ${catId} pág ${page}: ${newInPage} nuevos`);
        if (items.length < 10) break;
        page++;
        await this.delay(1000, 2000);

      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[pcx] Error HTTP pág ${page}: ${err.message}`);
        break;
      }
    }
    this.log('info', `✓ pcx ${catId} total: ${this.stats.found}`);
  }
}

if (require.main === module) {
  new PCExpressScraper().run().then(r => {
    console.log('PC-Express:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = PCExpressScraper;
