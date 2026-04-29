/**
 * scraper/stores/myshop.js
 * MyShop — scraping via proxy + Cheerio
 *
 * Precios: factor 1.03 (tarjeta)
 * Plataforma: custom (filtros por query string)
 */

require('dotenv').config();
const cheerio = require('cheerio');
const BaseScraper = require('../base-scraper');

const BASE       = 'https://www.myshop.cl';
const PROXY_URL  = process.env.CF_PROXY_URL    || '';
const PROXY_KEY  = process.env.CF_PROXY_SECRET || '';
const FACTOR     = 1.03;

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

// ── Categorías ────────────────────────────────────────────────────────────
const CATEGORY_URLS = [
  // PCs Armados (clasificar AMD/Intel por nombre)
  { url: '/pc-de-escritorio',                                                                                         catId: 'pc' },

  // Procesadores
  { url: '/partes-y-piezas-procesadores-procesadores-amd',                                                            catId: 'cpu', sub: 'amd'   },
  { url: '/partes-y-piezas-procesadores-procesadores-intel',                                                          catId: 'cpu', sub: 'intel' },

  // Tarjetas de Video
  { url: '/partes-y-piezas-tarjetas-de-video?filtro_tab_fabricante=%5B%22AMD%22%5D',                                  catId: 'gpu', sub: 'amd'    },
  { url: '/partes-y-piezas-tarjetas-de-video?filtro_tab_fabricante=%5B%22Nvidia%22%5D',                               catId: 'gpu', sub: 'nvidia' },

  // Placas Madre
  { url: '/partes-y-piezas-placas-madres-placas-intel',                                                               catId: 'mobo', sub: 'intel' },
  { url: '/partes-y-piezas-placas-madres-placas-amd',                                                                 catId: 'mobo', sub: 'amd'   },

  // Almacenamiento
  { url: '/partes-y-piezas-discos-ssd-internos-discos-ssd-m2',                                                        catId: 'storage', sub: 'nvme' },
  { url: '/partes-y-piezas-discos-ssd-internos-discos-ssd-sata-25',                                                   catId: 'storage', sub: 'sata' },

  // Refrigeración
  { url: '/partes-y-piezas-refrigeracion?filtro_categoria=%5B%22151%22%5D',                                           catId: 'cooling', sub: 'liquida' },
  { url: '/partes-y-piezas-refrigeracion-ventilador-cpu',                                                              catId: 'cooling', sub: 'aire'    },
  { url: '/partes-y-piezas-refrigeracion-ventilador-gabinete',                                                         catId: 'cooling', sub: 'fans'    },
  { url: '/partes-y-piezas-refrigeracion-pasta-disipadora',                                                            catId: 'cooling', sub: 'pasta'   },

  // Memorias RAM
  { url: '/partes-y-piezas-memorias-ram-memorias-pc?filtro_tab_tipo-de-memoria=%5B%22DDR4%20DIMM%22%5D',              catId: 'ram', sub: 'ddr4' },
  { url: '/partes-y-piezas-memorias-ram-memorias-pc?filtro_tab_tipo-de-memoria=%5B%22DDR5%20DIMM%22%5D',              catId: 'ram', sub: 'ddr5' },

  // Gabinetes
  { url: '/partes-y-piezas-gabinetes?filtro_tab_factor-de-forma=%5B%22ATX%22%5D',                                     catId: 'case', sub: 'atx'  },
  { url: '/partes-y-piezas-gabinetes?filtro_tab_factor-de-forma=%5B%22Micro%20ATX%22%5D',                             catId: 'case', sub: 'matx' },
  { url: '/partes-y-piezas-gabinetes?filtro_tab_factor-de-forma=%5B%22Mini-ITX%22%5D',                                catId: 'case', sub: 'itx'  },
  { url: '/partes-y-piezas-gabinetes?filtro_tab_factor-de-forma=%5B%22E-ATX%22%5D',                                   catId: 'case', sub: 'eatx' },
];

// ── Selectores ────────────────────────────────────────────────────────────
const SEL = {
  // Grid de productos
  productCard:  '.product-card, .producto-item, article.product, .item-producto, [class*="product-card"], [class*="ProductCard"]',
  name:         '.product-title, .product-name, h2, h3, [class*="product-title"], [class*="ProductTitle"]',
  price:        '.price, .precio, [class*="price"], [class*="Price"]',
  link:         'a[href]',
  img:          'img',
  outOfStock:   '.out-of-stock, .sin-stock, .agotado, [class*="out-of-stock"]',
  pagination:   'a[aria-label="Next"], .pagination .next, a.next, [class*="next-page"]',
};

function parsePrice(raw) {
  if (!raw) return null;
  const n = parseInt(String(raw).replace(/[^\d]/g, ''));
  return (!n || n < 1000 || n > 100000000) ? null : n;
}

function classifyMoboSocket(name) {
  const n = name.toUpperCase();
  if (/LGA\s*1851|Z890|B860|H810/.test(n)) return 'lga1851';
  if (/LGA\s*1700|Z790|B760|H770|Z690|B660/.test(n)) return 'lga1700';
  if (/AM5|B650|X670|B850|X870/.test(n)) return 'am5';
  if (/AM4|B550|X570|B450/.test(n)) return 'am4';
  return null;
}

class MyShopScraper extends BaseScraper {
  constructor() {
    super('myshop', 'MyShop');
    this.seenUrls = new Set();
  }

  async fetchPage(url) {
    const res = await this.client.get(proxify(url), {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        'Referer': BASE + '/',
      },
      timeout: 30000,
    });
    return cheerio.load(res.data);
  }

  async scrapeAll() {
    for (const cat of CATEGORY_URLS) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[myshop] Error cat ${cat.url}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(cat) {
    let page = 1;
    let total = 0;

    while (page <= 30) {
      // MyShop uses ?pagina=N for pagination
      const sep = cat.url.includes('?') ? '&' : '?';
      const pageUrl = page === 1
        ? `${BASE}${cat.url}`
        : `${BASE}${cat.url}${sep}pagina=${page}`;

      this.log('info', `[myshop] ${cat.catId}${cat.sub?'/'+cat.sub:''} pág ${page}`);

      let $;
      try {
        $ = await this.fetchPage(pageUrl);
      } catch (err) {
        this.log('warn', `[myshop] HTTP error ${pageUrl}: ${err.message}`);
        break;
      }

      // Try multiple selectors for product cards
      let items = $(SEL.productCard);
      if (!items.length) {
        // Fallback: any element with product-like class
        items = $('[class*="product"]:has(a):has(img)');
      }
      if (!items.length) {
        this.log('info', `[myshop] Sin productos en pág ${page} (${pageUrl})`);
        break;
      }

      let newInPage = 0;
      for (const el of items.toArray()) {
        const $el = $(el);
        try {
          // Name
          const name = $el.find(SEL.name).first().text().trim()
            || $el.find('h2,h3,h4').first().text().trim();
          if (!name || name.length < 4) continue;

          // Link
          const href = $el.find('a').first().attr('href') || '';
          const productUrl = href.startsWith('http') ? href : `${BASE}${href}`;
          if (!productUrl || productUrl === BASE || this.seenUrls.has(productUrl)) continue;
          this.seenUrls.add(productUrl);

          // Price — find largest number that looks like a price
          let price = null;
          $el.find('[class*="price"],[class*="Price"],[class*="precio"],[class*="Precio"]').each((_, priceEl) => {
            const txt = $(priceEl).text();
            const p = parsePrice(txt);
            if (p && (!price || p < price)) price = p; // take lowest (cash price)
          });
          if (!price) {
            // Fallback: look for $ followed by numbers
            const txt = $el.text();
            const m = txt.match(/\$[\s]*([\d.,]+)/);
            if (m) price = parsePrice(m[1]);
          }
          if (!price) {
            this.log('warn', `[myshop] Sin precio: ${name.slice(0, 50)}`);
            continue;
          }

          const priceCard = Math.round(price * FACTOR);

          // Stock
          const stock = $el.find(SEL.outOfStock).length ? 'out_of_stock' : 'in_stock';

          // Image
          const imgEl = $el.find('img').first();
          const imageUrl = imgEl.attr('data-src') || imgEl.attr('src') || null;

          // Sub-classification for mobo
          let sub = cat.sub || null;
          if (cat.catId === 'mobo' && !sub) {
            sub = classifyMoboSocket(name);
          }
          if (cat.catId === 'storage' && !sub) {
            sub = /m\.2|nvme|pcie/i.test(name) ? 'nvme' : 'sata';
          }

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
            {
              current:  price,
              normal:   priceCard,
              discount: null,
              stock,
              url: productUrl,
            }
          );
        } catch (err) {
          this.log('warn', `[myshop] Error item: ${err.message}`);
        }
      }

      total += newInPage;
      this.log('info', `[myshop] ✓ pág ${page}: ${newInPage} productos`);

      // Check next page
      const hasNext = $(SEL.pagination).length > 0
        || $('a:contains("Siguiente"), a:contains("›"), a[rel="next"]').length > 0;
      if (!hasNext || newInPage === 0) break;
      page++;
      await this.delay(1500, 2500);
    }

    this.log('info', `[myshop] ✓ ${cat.url}: ${total} total`);
  }
}

if (require.main === module) {
  new MyShopScraper().run().then(r => {
    console.log('MyShop:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = MyShopScraper;
