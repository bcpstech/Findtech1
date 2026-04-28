/**
 * scraper/stores/n1g.js
 * N1G — PrestaShop scraping por categorías exactas
 *
 * Reglas:
 * - NO publicar productos sin stock (se guardan en DB con out_of_stock)
 * - Gabinetes: solo categoría principal, excluir accesorios (cat 138)
 * - RAM DDR5 Server (cat 106) → guardar como ram pero no publicar si out_of_stock
 */

require('dotenv').config();
const cheerio = require('cheerio');
const BaseScraper = require('../base-scraper');

const BASE       = 'https://n1g.cl';
const PROXY_URL  = process.env.CF_PROXY_URL    || '';
const PROXY_KEY  = process.env.CF_PROXY_SECRET || '';
const CARD_FACTOR = 1.03;

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

// ── Mapa de categorías: URL → { catId, subcat, exclude } ──────────────────
const CATEGORIES = [
  // PROCESADORES
  { url: '/Home/71-amd-cpu',   catId: 'cpu', sub: 'amd'   },
  { url: '/Home/72-intel-cpu', catId: 'cpu', sub: 'intel' },

  // TARJETAS GRÁFICAS
  { url: '/Home/110-nvidia', catId: 'gpu', sub: 'nvidia' },
  { url: '/Home/111-amd',    catId: 'gpu', sub: 'amd'    },
  { url: '/Home/130-intel',  catId: 'gpu', sub: 'intel'  },

  // GABINETES (solo principal, excluir accesorios /138)
  { url: '/Home/24-gabinetes', catId: 'case', excludeUrls: ['/Home/138'] },

  // FUENTES DE PODER
  { url: '/Home/57-fuentes-certificadas-modular',    catId: 'psu', sub: 'modular'    },
  { url: '/Home/58-fuentes-certificadas-no-modular', catId: 'psu', sub: 'certificada' },

  // ALMACENAMIENTO
  { url: '/Home/54-discos-ssd', catId: 'storage', sub: 'sata'    },
  { url: '/Home/55-discos-hdd', catId: 'storage', sub: 'hdd'     },
  { url: '/Home/56-discos-25',  catId: 'storage', sub: 'sata'    },
  { url: '/Home/141-ssd-macbook', catId: 'storage', sub: 'nvme'  },

  // MEMORIAS RAM
  { url: '/Home/77-ddr5-pc',     catId: 'ram', sub: 'ddr5' },
  { url: '/Home/69-ddr4-pc',     catId: 'ram', sub: 'ddr4' },
  { url: '/Home/106-ddr5-server',catId: 'ram', sub: 'ddr5' },

  // PLACAS MADRE
  { url: '/Home/50-placa-madre-amd',   catId: 'mobo', sub: 'am5'    },
  { url: '/Home/51-placa-madre-intel', catId: 'mobo', sub: 'lga1700' },

  // REFRIGERACIÓN
  { url: '/Home/61-disipador-por-aire', catId: 'cooling', sub: 'aire'    },
  { url: '/Home/63-ventiladores',       catId: 'cooling', sub: 'fans'    },
  { url: '/Home/62-watercooling',       catId: 'cooling', sub: 'liquida' },

  // PCs ARMADOS
  { url: '/Home/26-computadores-armados', catId: 'pc' },
];

// Selectores PrestaShop N1G
const SEL = {
  products:    'article.product-miniature, .product-miniature',
  name:        '.product-title a, h2.product-title a',
  price:       '.price',
  priceOld:    '.regular-price',
  link:        '.product-title a, .thumbnail-container a',
  img:         'img.lazyload, img[data-src], .thumbnail img',
  outOfStock:  '.product-unavailable, .out-of-stock',
  nextPage:    'a[rel="next"], .next a, li.next a',
};

function parsePrice(raw) {
  if (!raw) return null;
  const n = parseInt(String(raw).replace(/[^\d]/g, ''));
  return (!n || n < 1000 || n > 100000000) ? null : n;
}

function detectStock($el) {
  if ($el.find(SEL.outOfStock).length) return 'out_of_stock';
  const cls = ($el.attr('class') || '').toLowerCase();
  if (cls.includes('unavailable') || cls.includes('out-of-stock')) return 'out_of_stock';
  // N1G a veces pone "Sin stock" en el título del botón
  if ($el.find('[title*="stock"], [title*="Stock"]').length) return 'out_of_stock';
  return 'in_stock';
}

class N1GScraper extends BaseScraper {
  constructor() {
    super('n1g', 'N1G');
  }

  async scrapeAll() {
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error en ${cat.url}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(cat) {
    let page = 1;
    let totalNew = 0;

    while (page <= 30) {
      const pageUrl = `${BASE}${cat.url}${page > 1 ? `?page=${page}` : ''}`;
      this.log('info', `[n1g] ${cat.catId}${cat.sub ? '/'+cat.sub : ''} pág ${page}`);

      const url = proxify(pageUrl);
      let $;
      try {
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
            'Referer': BASE + '/',
          },
          timeout: 25000,
        });
        $ = cheerio.load(res.data);
      } catch (err) {
        this.log('warn', `[n1g] HTTP error ${pageUrl}: ${err.message}`);
        break;
      }

      const items = $(SEL.products);
      if (!items.length) {
        this.log('info', `[n1g] Sin productos en pág ${page}`);
        break;
      }

      let newInPage = 0;
      for (const el of items.toArray()) {
        try {
          const $el = $(el);

          // Obtener URL del producto
          const productUrl = $el.find(SEL.link).first().attr('href') || '';
          if (!productUrl) continue;

          // Excluir categorías no deseadas (ej: accesorios gabinetes)
          if (cat.excludeUrls?.some(ex => productUrl.includes(ex))) continue;

          // Nombre
          const name = $el.find(SEL.name).first().text().trim();
          if (!name || name.length < 3) continue;

          // Precio
          const priceRaw = $el.find(SEL.price).first().text().trim();
          const price = parsePrice(priceRaw);
          if (!price) {
            this.log('warn', `[n1g] Sin precio: ${name.slice(0, 50)}`);
            continue;
          }

          // Precio normal (antes de descuento)
          const oldRaw = $el.find(SEL.priceOld).first().text().trim();
          const priceNormal = oldRaw ? parsePrice(oldRaw) : null;
          const discount = priceNormal && priceNormal > price
            ? Math.round((1 - price / priceNormal) * 100) : null;

          // Precio tarjeta
          const priceCard = Math.round(price * CARD_FACTOR);

          // Stock
          const stock = detectStock($el);

          // Imagen
          const imgEl = $el.find(SEL.img).first();
          const imageUrl = imgEl.attr('data-src') || imgEl.attr('src') || null;

          // Marca
          const brand = this.extractBrand(name);

          this.stats.found++;
          newInPage++;

          await this.saveProductWithR2(
            {
              name,
              category: cat.catId,
              brand,
              imageUrl,
              specs: {
                'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
                'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
              },
            },
            {
              current:  price,
              normal:   priceNormal,
              discount,
              stock,
              url: productUrl.startsWith('http') ? productUrl : BASE + productUrl,
            }
          );
        } catch (err) {
          this.log('warn', `[n1g] Error producto: ${err.message}`);
        }
      }

      totalNew += newInPage;
      this.log('info', `[n1g] ✓ ${cat.catId} pág ${page}: ${newInPage} productos`);

      // ¿Hay página siguiente?
      const hasNext = $(SEL.nextPage).length > 0;
      if (!hasNext || newInPage === 0) break;
      page++;
      await this.delay(1500, 2500);
    }

    this.log('info', `[n1g] ✓ ${cat.url}: ${totalNew} total`);
  }
}

if (require.main === module) {
  new N1GScraper().run().then(r => {
    console.log('N1G:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = N1GScraper;
