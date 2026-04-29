/**
 * scraper/stores/myshop.js
 * MyShop — Jumpseller platform, via proxy
 * Factor tarjeta: 1.03
 */
require('dotenv').config();
const cheerio = require('cheerio');
const BaseScraper = require('../base-scraper');

const BASE      = 'https://www.myshop.cl';
const PROXY_URL = process.env.CF_PROXY_URL    || '';
const PROXY_KEY = process.env.CF_PROXY_SECRET || '';
const FACTOR    = 1.03;

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

// URLs limpias sin filtros JS (clasificar por nombre)
const CATEGORY_URLS = [
  { url: '/pc-de-escritorio',                                         catId: 'pc'      },
  { url: '/partes-y-piezas-procesadores-procesadores-amd',            catId: 'cpu',     sub: 'amd'    },
  { url: '/partes-y-piezas-procesadores-procesadores-intel',          catId: 'cpu',     sub: 'intel'  },
  { url: '/partes-y-piezas-tarjetas-de-video',                        catId: 'gpu'      },
  { url: '/partes-y-piezas-placas-madres-placas-amd',                 catId: 'mobo',    sub: 'amd'    },
  { url: '/partes-y-piezas-placas-madres-placas-intel',               catId: 'mobo',    sub: 'intel'  },
  { url: '/partes-y-piezas-memorias-ram-memorias-pc',                 catId: 'ram'      },
  { url: '/partes-y-piezas-discos-ssd-internos-discos-ssd-m2',        catId: 'storage', sub: 'nvme'   },
  { url: '/partes-y-piezas-discos-ssd-internos-discos-ssd-sata-25',   catId: 'storage', sub: 'sata'   },
  { url: '/partes-y-piezas-refrigeracion-ventilador-cpu',             catId: 'cooling', sub: 'aire'   },
  { url: '/partes-y-piezas-refrigeracion-ventilador-gabinete',        catId: 'cooling', sub: 'fans'   },
  { url: '/partes-y-piezas-refrigeracion-pasta-disipadora',           catId: 'cooling', sub: 'pasta'  },
  { url: '/partes-y-piezas-refrigeracion',                            catId: 'cooling'  },
  { url: '/partes-y-piezas-gabinetes',                                catId: 'case'     },
  { url: '/partes-y-piezas-fuentes-de-poder',                         catId: 'psu'      },
];

function parsePrice(raw) {
  if (!raw) return null;
  const n = parseInt(String(raw).replace(/[^\d]/g, ''));
  return n > 1000 && n < 100000000 ? n : null;
}

function classifyGpu(name) {
  const n = name.toUpperCase();
  if (/RTX|GTX|GEFORCE|NVIDIA/.test(n)) return 'nvidia';
  if (/RADEON|RX\s+\d|AMD.*GPU/.test(n))  return 'amd';
  return null;
}

function classifyRam(name) {
  const n = name.toUpperCase();
  if (/DDR5/.test(n)) return 'ddr5';
  if (/DDR4/.test(n)) return 'ddr4';
  return null;
}

function classifyCase(name) {
  const n = name.toUpperCase();
  if (/E-?ATX|EXTENDED|FULL.TOWER/.test(n)) return 'eatx';
  if (/MICRO.?ATX|M-?ATX/.test(n))          return 'matx';
  if (/MINI.?ITX/.test(n))                   return 'itx';
  if (/\bATX\b/.test(n))                     return 'atx';
  return null;
}

function classifyMobo(name) {
  const n = name.toUpperCase();
  if (/LGA.?1851|Z890|B860/.test(n))         return 'lga1851';
  if (/LGA.?1700|Z790|B760|Z690|B660/.test(n)) return 'lga1700';
  if (/AM5|B650|X670|B850|X870/.test(n))     return 'am5';
  if (/AM4|B550|X570|B450/.test(n))          return 'am4';
  return null;
}

function classifyPsu(name) {
  const n = name.toLowerCase();
  if (/modular/.test(n))                      return 'modular';
  if (/gold|platinum|bronze|80\+/.test(n))    return 'certificada';
  return null;
}

class MyShopScraper extends BaseScraper {
  constructor() {
    super('myshop', 'MyShop');
    this.seenUrls = new Set();
    this.seenNames = new Set();
  }

  async fetchPage(url) {
    const res = await this.client.get(proxify(url), {
      headers: {
        'Accept':          'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Language': 'es-CL,es;q=0.9',
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        'Referer':         BASE + '/',
        'Cache-Control':   'no-cache',
      },
      timeout: 30000,
    });
    return cheerio.load(res.data);
  }

  async scrapeAll() {
    for (const cat of CATEGORY_URLS) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(2500, 4000);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[myshop] Error cat ${cat.url}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(cat) {
    let page = 1;
    let total = 0;

    while (page <= 20) {
      const pageUrl = page === 1
        ? `${BASE}${cat.url}`
        : `${BASE}${cat.url}?page=${page}`;

      this.log('info', `[myshop] ${cat.catId}${cat.sub ? '/'+cat.sub : ''} pág ${page}`);

      let $;
      try {
        $ = await this.fetchPage(pageUrl);
      } catch (err) {
        this.log('warn', `[myshop] HTTP ${pageUrl}: ${err.message}`);
        break;
      }

      // Jumpseller typical selectors
      const selectors = [
        '.products-listing .product',
        '.product-listing .product-item',
        '.product-grid .product-item',
        '.products .product',
        'ul.products li',
        '[class*="product-item"]',
        '[class*="product-card"]',
        '.col-product',
      ];

      let items = $([]);
      for (const sel of selectors) {
        const found = $(sel);
        if (found.length > 0) { items = found; break; }
      }

      // Final fallback: any element with both a link and a price
      if (!items.length) {
        items = $('*').filter((i, el) => {
          const $el = $(el);
          return $el.find('a[href*="/producto/"], a[href*="/product/"]').length > 0 &&
                 $el.text().includes('$');
        });
      }

      if (!items.length) {
        this.log('info', `[myshop] Sin productos pág ${page} — ${pageUrl}`);
        break;
      }

      let newInPage = 0;
      for (const el of items.toArray()) {
        const $el = $(el);
        try {
          // Name — multiple fallbacks
          const nameEl = $el.find('.product-name, .product-title, h2, h3, .name').first();
          const name = nameEl.text().trim() || $el.find('a').first().attr('title') || '';
          if (!name || name.length < 5) continue;

          // Normalize name key to detect true duplicates
          const nameKey = name.toLowerCase().replace(/\s+/g, ' ').trim();
          if (this.seenNames.has(nameKey)) continue;
          this.seenNames.add(nameKey);

          // URL
          const href = $el.find('a[href]').first().attr('href') || '';
          const productUrl = href.startsWith('http') ? href
            : href.startsWith('/') ? `${BASE}${href}` : `${BASE}/${href}`;
          if (!productUrl || this.seenUrls.has(productUrl)) continue;
          this.seenUrls.add(productUrl);

          // Price — find the lowest number that looks like a CLP price
          let price = null;
          $el.find('*').each((_, prEl) => {
            const txt = $(prEl).text();
            if (!txt.includes('$')) return;
            const p = parsePrice(txt);
            if (p && (!price || p < price)) price = p;
          });
          if (!price) continue;

          const priceCard = Math.round(price * FACTOR);

          // Stock
          const txt = $el.text().toLowerCase();
          const stock = /agotado|sin stock|out of stock/.test(txt) ? 'out_of_stock' : 'in_stock';

          // Image
          const imgEl = $el.find('img').first();
          const imageUrl = imgEl.attr('data-src') || imgEl.attr('src') || null;
          const cleanImg = imageUrl && !imageUrl.includes('placeholder') ? imageUrl : null;

          // Sub-classify
          let sub = cat.sub || null;
          if (!sub) {
            if (cat.catId === 'gpu')     sub = classifyGpu(name);
            if (cat.catId === 'ram')     sub = classifyRam(name);
            if (cat.catId === 'case')    sub = classifyCase(name);
            if (cat.catId === 'mobo')    sub = classifyMobo(name);
            if (cat.catId === 'psu')     sub = classifyPsu(name);
          }

          this.stats.found++;
          newInPage++;

          await this.saveProductWithR2(
            {
              name,
              category: cat.catId,
              brand: this.extractBrand(name),
              imageUrl: cleanImg,
              specs: {
                'Efectivo / Transferencia': `$${price.toLocaleString('es-CL')}`,
                'Tarjeta crédito/débito':   `$${priceCard.toLocaleString('es-CL')}`,
              },
            },
            { current: price, normal: priceCard, discount: null, stock, url: productUrl }
          );
        } catch (err) {
          this.log('warn', `[myshop] item error: ${err.message}`);
        }
      }

      total += newInPage;
      this.log('info', `[myshop] ✓ pág ${page}: ${newInPage}`);

      const hasNext = $('a[rel="next"], .pagination .next, a:contains("Siguiente")').length > 0;
      if (!hasNext || newInPage === 0) break;
      page++;
      await this.delay(2000, 3000);
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
