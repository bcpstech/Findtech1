/**
 * scraper/stores/n1g.js
 * N1G PrestaShop — categorías específicas verificadas
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL = 'https://n1g.cl';

const PROXY_URL = process.env.CF_PROXY_URL || '';
const PROXY_SECRET = process.env.CF_PROXY_SECRET || '';

function getUrl(targetUrl) {
  if (PROXY_URL) {
    return `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}&secret=${PROXY_SECRET}`;
  }
  return targetUrl;
}


const CATEGORIES = [
  // GPU — subcategorías específicas
  { url: '/Home/111-amd',                       catId: 'gpu',     minPrice: 80000  },
  { url: '/Home/110-nvidia',                    catId: 'gpu',     minPrice: 80000  },
  // CPU — subcategorías AMD e Intel
  { url: '/Home/71-amd-cpu',                    catId: 'cpu',     minPrice: 20000  },
  { url: '/Home/72-intel-cpu',                  catId: 'cpu',     minPrice: 20000  },
  // Placas Madre
  { url: '/Home/33-placas-madre',               catId: 'mobo',    minPrice: 30000  },
  // RAM
  { url: '/Home/27-memorias',                   catId: 'ram',     minPrice: 10000  },
  // Almacenamiento
  { url: '/Home/22-almacenamiento',             catId: 'storage', minPrice: 10000  },
  // Refrigeración
  { url: '/Home/35-refrigeracion',              catId: 'cooling', minPrice: 8000   },
  // Fuentes — subcategorías específicas
  { url: '/Home/57-fuentes-certificadas-modular',     catId: 'psu', minPrice: 25000 },
  { url: '/Home/58-fuentes-certificadas-no-modular',  catId: 'psu', minPrice: 20000 },
  { url: '/Home/23-fuentes-de-poder',           catId: 'psu',     minPrice: 20000  },
  // Gabinetes — precio mínimo filtra accesorios
  { url: '/Home/24-gabinetes',                  catId: 'case',    minPrice: 25000  },
];

const EXCLUDE_KEYWORDS = [
  'cable', 'adaptador', 'bracket', 'tornillo', 'pasta termica', 'pasta térmica',
  'soporte', 'accesorio', 'herramienta', 'limpiador', 'teclado', 'mouse',
  'auricular', 'headset', 'parlante', 'silla', 'escritorio', 'pad', 'mousepad',
  'webcam', 'microfono', 'micrófono', 'joystick', 'cargador', 'hub usb',
  'thermal grease', 'thermal pad', 'backplate', 'riser', 'extension pcie',
  'ventilador', 'fan ', ' fan', 'rgb strip', 'tira led',
];

const CARD_SURCHARGE = 1.03;

class N1GScraper extends BaseScraper {
  constructor() { super('n1g', 'N1G'); }

  isExcluded(name) {
    const lower = name.toLowerCase();
    return EXCLUDE_KEYWORDS.some(kw => lower.includes(kw));
  }

  async scrapeAll() {
    this.seenUrls = new Set();
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(1500, 2500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error ${cat.catId} (${cat.url}): ${err.message}`);
      }
    }
  }

  async scrapeCategory({ url: categoryPath, catId, minPrice = 1000 }) {
    let page = 1;

    while (page <= 20) {
      const directUrl = `${BASE_URL}${categoryPath}?page=${page}`;
      const url = getUrl(directUrl);
      this.log('info', `[n1g] ${catId} ${categoryPath} pág ${page}`);

      try {
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-CL,es;q=0.9,en-US;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://n1g.cl/Home/',
            'Cache-Control': 'max-age=0',
          }
        });

        const $ = cheerio.load(res.data);
        const items = $('article.product-miniature');

        if (!items.length) {
          this.log('info', `[n1g] Sin productos pág ${page}`);
          break;
        }

        let newInPage = 0;
        for (const el of items.toArray()) {
          try {
            const $el = $(el);
            const productUrl = $el.find('h3.product-title a, h3.h3.product-title a').attr('href')
                            || $el.find('a').first().attr('href') || '';
            if (this.seenUrls.has(productUrl)) return;
            this.seenUrls.add(productUrl);

            const name = $el.find('h3.product-title a, h3.h3.product-title a').text().trim();
            if (!name || name.length < 3) return;
            if (this.isExcluded(name)) return;

            const priceRaw = $el.find('.price').first().text().trim();
            const price = this.parseN1GPrice(priceRaw);
            if (!price || price < minPrice) return;

            const oldRaw = $el.find('.regular-price, .old-price').first().text().trim();
            const regularPrice = oldRaw ? this.parseN1GPrice(oldRaw) : null;
            const priceCard = Math.round(price * CARD_SURCHARGE);

            const brand = $el.find('.pl_manufacturer strong').text().trim()
                       || this.extractBrand(name);
            const imageUrl = $el.find('.product-image-container img').attr('data-src')
                          || $el.find('.product-image-container img').attr('src')
                          || $el.find('img').first().attr('src') || null;

            this.stats.found++;
            newInPage++;
            await this.saveProductWithR2(
              { name, category: catId, brand, imageUrl,
                specs: {
                  'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
                  'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
                }
              },
              { current: price,
                normal: regularPrice > price ? regularPrice : null,
                discount: regularPrice > price ? Math.round((1-price/regularPrice)*100) : null,
                stock: $el.find('.product-unavailable').length ? 'out_of_stock' : 'in_stock',
                url: productUrl || null }
            );
          } catch (err) {
            this.log('warn', `[n1g] Error item: ${err.message}`);
          }
        }

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
