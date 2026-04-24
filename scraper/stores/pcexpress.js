/**
 * scraper/stores/pcexpress.js
 * OpenCart — categorías específicas por path
 * Los productos cargan vía JS en el browser, pero la búsqueda devuelve HTML estático
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL = 'https://tienda.pc-express.cl';

// Categorías específicas verificadas — sin accesorios
const CATEGORIES = [
  // GPU
  { path: '460_475_158', catId: 'gpu'     }, // AMD Radeon
  { path: '460_475_159', catId: 'gpu'     }, // NVIDIA Gamer
  { path: '460_475_602', catId: 'gpu'     }, // Intel Arc
  // CPU
  { path: '460_473_367', catId: 'cpu'     }, // AMD AM4
  { path: '460_473_591', catId: 'cpu'     }, // AMD TR5
  { path: '460_473_583', catId: 'cpu'     }, // Intel s1200
  { path: '460_473_588', catId: 'cpu'     }, // Intel s1700
  { path: '460_473_600', catId: 'cpu'     }, // Intel s1851
  // Placas Madre
  { path: '460_472_369', catId: 'mobo'    }, // AMD AM4
  { path: '460_472_590', catId: 'mobo'    }, // AMD AM5
  { path: '460_472_584', catId: 'mobo'    }, // Intel s1200
  { path: '460_472_589', catId: 'mobo'    }, // Intel s1700
  { path: '460_472_599', catId: 'mobo'    }, // Intel s1851
  // RAM
  { path: '72_126',      catId: 'ram'     }, // Memorias PC
  // Almacenamiento
  { path: '62_331_406',  catId: 'storage' }, // SSD M.2
  { path: '62_331_407',  catId: 'storage' }, // SSD SATA
  { path: '62_331_408',  catId: 'storage' }, // SSD NVMe PCIe
  { path: '62_413_101',  catId: 'storage' }, // HDD PC
  // Fuentes
  { path: '460_461_118', catId: 'psu'     }, // Estándar
  { path: '460_461_279', catId: 'psu'     }, // Certificadas
  // Gabinetes
  { path: '460_462_119', catId: 'case'    }, // Básicos
  { path: '460_462_120', catId: 'case'    }, // Gamer
  // Refrigeración
  { path: '460_473_169', catId: 'cooling' }, // Ventilación CPU
];

const CARD_SURCHARGE = 1.03;

class PCExpressScraper extends BaseScraper {
  constructor() { super('pcexpress', 'PC-Express'); }

  async scrapeAll() {
    this.seenUrls = new Set();
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(1500, 2500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error ${cat.catId} (${cat.path}): ${err.message}`);
      }
    }
  }

  async scrapeCategory({ path, catId }) {
    let page = 1;

    while (page <= 10) {
      // Intentar con el endpoint de búsqueda por categoría
      const url = `${BASE_URL}/index.php?route=product/category&path=${path}&limit=100&sort=p.price&order=ASC&page=${page}`;
      this.log('info', `[pcx] ${catId} path=${path} pág ${page}`);

      try {
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://tienda.pc-express.cl/',
          }
        });

        const $ = cheerio.load(res.data);

        // Intentar múltiples selectores de OpenCart
        let items = $('.product-layout');
        if (!items.length) items = $('.product-thumb');
        if (!items.length) items = $('[class*="product-layout"]');

        let newInPage = 0;

        if (items.length) {
          items.each((_, el) => {
            try {
              const $el = $(el);
              const productUrl = $el.find('a[href*="product_id"]').first().attr('href') || '';
              if (!productUrl) return;
              if (this.seenUrls.has(productUrl)) return;
              this.seenUrls.add(productUrl);

              const name = $el.find('h4 a, .caption h4 a').first().text().trim()
                        || $el.find('img').first().attr('alt') || '';
              if (!name || name.length < 3) return;

              const priceRaw = $el.find('.price-new').first().text().trim()
                            || $el.find('.price').first().text().trim();
              const price = this.parsePrice(priceRaw);
              if (!price || price < 1000) return;

              const priceOldRaw = $el.find('.price-old').first().text().trim();
              const regularPrice = priceOldRaw ? this.parsePrice(priceOldRaw) : null;
              const priceCard = Math.round(price * CARD_SURCHARGE);
              const imageUrl = $el.find('img').first().attr('src') || null;

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
                  stock: 'in_stock', url: productUrl }
              );
            } catch(e) { this.log('warn', `[pcx] Error item: ${e.message}`); }
          });

          this.log('info', `[pcx] ✓ ${catId} path=${path} pág ${page}: ${newInPage} nuevos`);
          if (items.length < 100) break;

        } else {
          // Fallback: buscar h4 con links directos a productos
          $('h4 a[href*="product_id"]').each((_, el) => {
            const $a = $(el);
            const productUrl = $a.attr('href') || '';
            if (this.seenUrls.has(productUrl)) return;
            this.seenUrls.add(productUrl);

            const name = $a.text().trim();
            if (!name || name.length < 3) return;

            const $container = $a.closest('div');
            const priceRaw = $container.find('[class*="price"]').first().text().trim();
            const price = this.parsePrice(priceRaw);
            if (!price || price < 1000) return;

            const priceCard = Math.round(price * CARD_SURCHARGE);
            const imageUrl = $container.find('img').first().attr('src') || null;

            this.stats.found++;
            newInPage++;
            this.saveProduct(
              { name, category: catId, brand: this.extractBrand(name), imageUrl,
                specs: {
                  'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
                  'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
                }
              },
              { current: price, normal: null, discount: null,
                stock: 'in_stock', url: productUrl }
            );
          });

          this.log('info', `[pcx] ✓ ${catId} path=${path} pág ${page}: ${newInPage} (fallback)`);
          if (!newInPage) break;
        }

        page++;
        await this.delay(1000, 2000);

      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[pcx] Error HTTP path=${path} pág ${page}: ${err.message}`);
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
