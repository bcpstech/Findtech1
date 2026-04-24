/**
 * scraper/stores/pcexpress.js
 * OpenCart HTML scraping — tienda.pc-express.cl
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL = 'https://tienda.pc-express.cl';

const SEARCHES = [
  { query: 'tarjeta de video',      catId: 'gpu'     },
  { query: 'procesador amd',        catId: 'cpu'     },
  { query: 'procesador intel',      catId: 'cpu'     },
  { query: 'placa madre',           catId: 'mobo'    },
  { query: 'memoria ram ddr',       catId: 'ram'     },
  { query: 'ssd nvme m.2',          catId: 'storage' },
  { query: 'ssd sata',              catId: 'storage' },
  { query: 'disco duro hdd',        catId: 'storage' },
  { query: 'fuente de poder',       catId: 'psu'     },
  { query: 'gabinete gamer',        catId: 'case'    },
  { query: 'cooler cpu',            catId: 'cooling' },
  { query: 'refrigeracion liquida', catId: 'cooling' },
];

const CARD_SURCHARGE = 1.03;

class PCExpressScraper extends BaseScraper {
  constructor() { super('pcexpress', 'PC-Express'); }

  isAccessory(name) {
    const lower = name.toLowerCase();
    const keywords = ['cable','adaptador','bracket','tornillo','pasta termica',
      'pasta térmica','soporte','accesorio','herramienta','teclado','mouse',
      'auricular','headset','parlante','silla','pad','mousepad','webcam',
      'microfono','micrófono','joystick','cargador','hub usb'];
    return keywords.some(kw => lower.includes(kw));
  }

  async scrapeAll() {
    this.seenUrls = new Set();
    for (const { query, catId } of SEARCHES) {
      try {
        await this.scrapeSearch(query, catId);
        await this.delay(1500, 2500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error ${catId} (${query}): ${err.message}`);
      }
    }
  }

  async scrapeSearch(query, catId) {
    let page = 1;

    while (page <= 10) {
      const url = `${BASE_URL}/index.php?route=product/search&search=${encodeURIComponent(query)}&sort=p.price&order=ASC&limit=25&page=${page}`;
      this.log('info', `[pcx] ${catId} "${query}" pág ${page}`);

      try {
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://tienda.pc-express.cl/',
          }
        });

        // Log HTML para debug
        this.log('info', `[pcx] HTML snippet: ${res.data.slice(200, 600)}`);

        const $ = cheerio.load(res.data);
        const items = $('.product-layout, .product-thumb');
        let newInPage = 0;

        if (items.length) {
          items.each((_, el) => {
            try {
              const $el = $(el);
              const productUrl = $el.find('a').first().attr('href') || '';
              if (!productUrl.includes('product_id=')) return;
              if (this.seenUrls.has(productUrl)) return;
              this.seenUrls.add(productUrl);

              const name = $el.find('h4 a, .name a, [class*="name"] a').first().text().trim()
                        || $el.find('img').first().attr('alt') || '';
              if (!name || name.length < 3) return;
              if (this.isAccessory(name)) return;

              const priceNew = $el.find('.price-new').first().text().trim()
                            || $el.find('.price').first().text().trim();
              const price = this.parsePrice(priceNew);
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

          this.log('info', `[pcx] ✓ "${query}" pág ${page}: ${newInPage} nuevos`);
          if (items.length < 25) break;

        } else {
          // Fallback: buscar h4 con links a productos
          let found = false;
          $('h4').each((_, el) => {
            const $h4 = $(el);
            const link = $h4.find('a[href*="product_id"]');
            if (!link.length) return;

            const productUrl = link.attr('href') || '';
            if (this.seenUrls.has(productUrl)) return;
            this.seenUrls.add(productUrl);

            const name = link.text().trim();
            if (!name || this.isAccessory(name)) return;

            const $container = $h4.closest('div');
            const priceRaw = $container.find('[class*="price"]').first().text().trim();
            const price = this.parsePrice(priceRaw);
            if (!price || price < 1000) return;

            const imageUrl = $container.find('img').first().attr('src') || null;
            const priceCard = Math.round(price * CARD_SURCHARGE);

            this.stats.found++;
            found = true;
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

          this.log('info', `[pcx] ✓ "${query}" pág ${page}: ${newInPage} nuevos (fallback)`);
          if (!found) break;
        }

        page++;
        await this.delay(1000, 2000);

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
  new PCExpressScraper().run().then(r => {
    console.log('PC-Express:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = PCExpressScraper;
