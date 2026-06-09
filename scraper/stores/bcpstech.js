/**
 * scraper/stores/bcpstech.js
 * BCPS Tech — WooCommerce HTML scraping
 * Base: bcpstech.cl
 * Categorías vía /categoria-producto/componentes-de-pc/...
 */
require('dotenv').config();
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE       = 'https://bcpstech.cl';
const PROXY_URL  = process.env.CF_PROXY_URL    || '';
const PROXY_KEY  = process.env.CF_PROXY_SECRET || '';
const CARD_FACTOR = 1.03;

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

// ── Categorías — URLs verificadas desde el sitio ──────────────────────────
const CATEGORIES = [
  // PROCESADORES
  { url: '/?product_cat=procesadores-amd',   catId: 'cpu', sub: 'amd'   },
  { url: '/?product_cat=procesadores-intel', catId: 'cpu', sub: 'intel' },

  // TARJETAS DE VIDEO
  { url: '/?product_cat=tarjetas-de-video-nvidia', catId: 'gpu', sub: 'nvidia' },
  { url: '/?product_cat=tarjetas-de-video-amd',    catId: 'gpu', sub: 'amd'    },

  // PLACAS MADRE
  { url: '/?product_cat=placas-madre-am5',    catId: 'mobo', sub: 'am5'    },
  { url: '/?product_cat=placas-madre-am4',    catId: 'mobo', sub: 'am4'    },
  { url: '/?product_cat=placas-madre-lga1700', catId: 'mobo', sub: 'lga1700' },
  { url: '/?product_cat=placas-madre-lga1851', catId: 'mobo', sub: 'lga1851' },

  // MEMORIAS RAM
  { url: '/?product_cat=memorias-ddr5', catId: 'ram', sub: 'ddr5' },
  { url: '/?product_cat=memorias-ddr4', catId: 'ram', sub: 'ddr4' },

  // ALMACENAMIENTO
  { url: '/?product_cat=discos-ssd', catId: 'storage', sub: 'nvme' },
  { url: '/?product_cat=discos-duro', catId: 'storage', sub: 'hdd'  },

  // REFRIGERACIÓN
  { url: '/?product_cat=refrigeracion-liquida',  catId: 'cooling', sub: 'liquida' },
  { url: '/?product_cat=refrigeracion-por-aire', catId: 'cooling', sub: 'aire'    },
  { url: '/?product_cat=ventiladores-fans',       catId: 'cooling', sub: 'fans'    },

  // FUENTES DE PODER
  { url: '/?product_cat=fuentes-modulares',   catId: 'psu', sub: 'modular'    },
  { url: '/?product_cat=fuentes-certificadas', catId: 'psu', sub: 'certificada' },

  // GABINETES
  { url: '/?product_cat=gabinetes-atx',          catId: 'case', sub: 'atx'  },
  { url: '/?product_cat=gabinetes-micro-atx',    catId: 'case', sub: 'matx' },
  { url: '/?product_cat=gabinetes-mini-itx',     catId: 'case', sub: 'itx'  },
  { url: '/?product_cat=gabinetes-extended-atx', catId: 'case', sub: 'eatx' },
];

const OUT_OF_STOCK = ['sin stock', 'agotado', 'out of stock', 'no disponible'];

function parsePrice(str) {
  if (!str) return null;
  const n = parseInt(String(str).replace(/[^\d]/g, ''));
  return n > 1000 && n < 100000000 ? n : null;
}

class BcpsTechScraper extends BaseScraper {
  constructor() {
    super('bcpstech', 'BCPS Tech');
    this.seenUrls = new Set();
  }

  async scrapeAll() {
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[bcpstech] Error ${cat.catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(cat) {
    let page = 1;
    let total = 0;

    while (page <= 20) {
      const pageUrl = proxify(
        page === 1
          ? `${BASE}${cat.url}`
          : `${BASE}${cat.url}&paged=${page}`
      );
      this.log('info', `[bcpstech] ${cat.catId}/${cat.sub} pág ${page}`);

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
        this.log('warn', `[bcpstech] HTTP: ${err.message}`);
        break;
      }

      // WooCommerce estándar
      const items = $('ul.products li.product, .products .product');
      if (!items.length) {
        this.log('info', `[bcpstech] Sin productos pág ${page}`);
        break;
      }

      let newInPage = 0;
      for (const el of items.toArray()) {
        try {
          const $el = $(el);

          // URL
          const productUrl = $el.find('a.woocommerce-loop-product__link, a').first().attr('href') || '';
          if (!productUrl || this.seenUrls.has(productUrl)) continue;
          this.seenUrls.add(productUrl);

          // Nombre
          const name = $el.find('.woocommerce-loop-product__title, h2').first().text().trim();
          if (!name || name.length < 4) continue;

          // Precio — precio con descuento (ins) o precio normal
          const priceRaw = $el.find('.price ins .amount').first().text()
                        || $el.find('.price .amount').first().text()
                        || $el.find('.price').first().text();
          const price = parsePrice(priceRaw);
          if (!price) continue;

          // Precio normal tachado
          const normalRaw  = $el.find('.price del .amount').first().text();
          const priceNormal = normalRaw ? parsePrice(normalRaw) : null;
          const discount    = priceNormal && priceNormal > price
            ? Math.round((1 - price / priceNormal) * 100) : null;

          const priceCard = Math.round(price * CARD_FACTOR);

          // Stock
          const txt   = $el.text().toLowerCase();
          const stock = OUT_OF_STOCK.some(p => txt.includes(p)) || $el.find('.out-of-stock').length
            ? 'out_of_stock' : 'in_stock';

          // Imagen — lazy loading
          const imgEl    = $el.find('img').first();
          let   imageUrl = imgEl.attr('data-lazy-src')
                        || imgEl.attr('data-src')
                        || imgEl.attr('src')
                        || null;
          if (imageUrl?.startsWith('data:') || (imageUrl?.length || 0) < 20) imageUrl = null;

          this.stats.found++;
          newInPage++;

          await this.saveProductWithR2(
            {
              name,
              category: cat.catId,
              brand:    this.extractBrand(name),
              imageUrl,
              specs: {
                'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
                'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
              },
            },
            {
              current:  price,
              card:     priceCard,
              normal:   priceNormal && priceNormal > price ? priceNormal : null,
              discount,
              stock,
              url: productUrl,
            }
          );
        } catch (err) {
          this.log('warn', `[bcpstech] item: ${err.message}`);
        }
      }

      total += newInPage;
      this.log('info', `[bcpstech] ✓ pág ${page}: ${newInPage}`);

      // Siguiente página
      const hasNext = $('a.next.page-numbers, .woocommerce-pagination a.next').length > 0;
      if (!hasNext || newInPage === 0) break;
      page++;
      await this.delay(1500, 2500);
    }

    this.log('info', `[bcpstech] ✓ ${cat.url}: ${total} total`);
  }
}

if (require.main === module) {
  new BcpsTechScraper().run().then(r => {
    console.log('BCPS Tech:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = BcpsTechScraper;
