/**
 * scraper/stores/winpy.js
 * Winpy.cl — plataforma propia
 * Estructura verificada: section#productos.page_categoria > article
 * Precio: div.valor > $ 69.920
 * Producto URL: a[href*="/venta/"]
 */
require('dotenv').config();
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE      = 'https://www.winpy.cl';
const PROXY_URL = process.env.CF_PROXY_URL    || '';
const PROXY_KEY = process.env.CF_PROXY_SECRET || '';
const FACTOR    = 1.03;

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

const CATEGORIES = [
  { url: '/partes-y-piezas/tarjetas-graficas/',  catId: 'gpu'     },
  { url: '/partes-y-piezas/procesadores/',        catId: 'cpu'     },
  { url: '/partes-y-piezas/placas-madres/',       catId: 'mobo'    },
  { url: '/partes-y-piezas/memorias-ram/',        catId: 'ram'     },
  { url: '/almacenamiento/',                      catId: 'storage' },
  { url: '/partes-y-piezas/refrigeracion/',       catId: 'cooling' },
  { url: '/partes-y-piezas/fuentes-de-poder/',    catId: 'psu'     },
  { url: '/partes-y-piezas/gabinetes/',           catId: 'case'    },
];

const OUT_OF_STOCK = ['sin stock', 'agotado', 'no disponible'];

function parsePrice(str) {
  if (!str) return null;
  const n = parseInt(String(str).replace(/[^\d]/g, ''));
  return n > 1000 && n < 100000000 ? n : null;
}

class WinpyScraper extends BaseScraper {
  constructor() {
    super('winpy', 'Winpy');
    this.seenUrls = new Set();
  }

  async scrapeAll() {
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[winpy] Error ${cat.catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(cat) {
    let page  = 1;
    let total = 0;

    while (page <= 20) {
      const pageUrl = proxify(
        page === 1
          ? `${BASE}${cat.url}`
          : `${BASE}${cat.url}?paged=${page}`
      );
      this.log('info', `[winpy] ${cat.catId} pág ${page}`);

      let $;
      try {
        const res = await this.client.get(pageUrl, {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
            Referer: BASE,
          },
          timeout: 25000,
        });
        $ = cheerio.load(res.data);
      } catch (err) {
        this.log('warn', `[winpy] HTTP error: ${err.message}`);
        break;
      }

      // Estructura verificada: section#productos.page_categoria > article
      const items = $('section#productos article, section.page_categoria article');

      if (!items.length) {
        this.log('info', `[winpy] Sin productos pág ${page}`);
        break;
      }

      let newInPage = 0;
      for (const el of items.toArray()) {
        try {
          const $el = $(el);

          // URL del producto
          let productUrl = $el.find('a[href*="/venta/"]').first().attr('href')
                        || $el.find('a').first().attr('href') || '';
          if (!productUrl) continue;
          if (!productUrl.startsWith('http')) productUrl = `${BASE}${productUrl}`;
          if (this.seenUrls.has(productUrl)) continue;
          this.seenUrls.add(productUrl);

          // Nombre desde el title del link o h2/h3
          const name = $el.find('a[href*="/venta/"]').first().attr('title')
                    || $el.find('p.model, .nombre, h2, h3').first().text().trim()
                    || $el.find('a').first().attr('title') || '';
          if (!name || name.length < 4) continue;

          // Filtrar productos que no corresponden a la categoría
          const nameLow = name.toLowerCase();
          if (cat.catId === 'ram' && !/ddr[345]|ram|dimm|memoria/.test(nameLow)) continue;
          if (cat.catId === 'gpu' && !/rtx|gtx|radeon|rx\s*\d|arc\s+[ab]|geforce|gráfica|video/.test(nameLow)) continue;
          if (cat.catId === 'cpu' && !/ryzen|intel|core|procesador|celeron|xeon|athlon/.test(nameLow)) continue;
          if (cat.catId === 'case' && !/gabinete|case|torre|chasis/.test(nameLow)) continue;
          if (cat.catId === 'psu' && !/fuente|psu|poder|power/.test(nameLow)) continue;

          // Precio: div.valor contiene "$ 69.920"
          const priceRaw = $el.find('.valor, div.valor, p.valor').first().text().trim()
                        || $el.find('[class*="price"],[class*="precio"]').first().text().trim();
          const price = parsePrice(priceRaw);
          if (!price) continue;

          const priceCard = Math.round(price * FACTOR);

          // Stock
          const txt = $el.text().toLowerCase();
          const stock = OUT_OF_STOCK.some(p => txt.includes(p)) ? 'out_of_stock' : 'in_stock';

          // Imagen — Winpy usa lazy loading: data-src o data-lazy-src tiene la imagen real
          // src puede ser un placeholder genérico, ignorarlo si es pequeño o data:
          const imgEl = $el.find('img').first();
          let imageUrl = imgEl.attr('data-lazy-src')
                      || imgEl.attr('data-src')
                      || imgEl.attr('data-original')
                      || imgEl.attr('src')
                      || null;
          // Descartar placeholders (data:image, svg, o URLs muy cortas)
          if (imageUrl && (imageUrl.startsWith('data:') || imageUrl.includes('placeholder') || imageUrl.length < 20)) {
            imageUrl = null;
          }
          // Asegurar URL absoluta
          if (imageUrl && !imageUrl.startsWith('http')) {
            imageUrl = BASE + imageUrl;
          }

          // Descuento — hay p.descuento con "-12%"
          const discountRaw = $el.find('p.descuento, .descuento').first().text().trim();
          const discount = discountRaw ? parseInt(discountRaw.replace(/[^\d]/g, '')) || null : null;

          this.stats.found++;
          newInPage++;

          await this.saveProductWithR2(
            {
              name,
              category: cat.catId,
              brand: this.extractBrand(name),
              imageUrl,
              specs: {
                'Efectivo / Transferencia': `$${price.toLocaleString('es-CL')}`,
                'Tarjeta crédito/débito':   `$${priceCard.toLocaleString('es-CL')}`,
              },
            },
            { current: price, card: priceCard, normal: null, discount, stock, url: productUrl }
          );
        } catch (err) {
          this.log('warn', `[winpy] item error: ${err.message}`);
        }
      }

      total += newInPage;
      this.log('info', `[winpy] ✓ ${cat.catId} pág ${page}: ${newInPage}`);

      const hasNext = $('a[rel="next"], a.siguiente, li.siguiente a').length > 0;
      if (!hasNext || newInPage === 0) break;
      page++;
      await this.delay(1500, 2500);
    }

    this.log('info', `[winpy] ✓ ${cat.catId}: ${total} total`);
  }
}

if (require.main === module) {
  new WinpyScraper().run().then(r => {
    console.log('Winpy:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = WinpyScraper;
