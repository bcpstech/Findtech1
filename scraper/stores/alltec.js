/**
 * scraper/stores/alltec.js
 * Alltec — PrestaShop, categorías por ID numérico
 */
require('dotenv').config();
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE       = 'https://www.alltec.cl';
const PROXY_URL  = process.env.CF_PROXY_URL    || '';
const PROXY_KEY  = process.env.CF_PROXY_SECRET || '';
const FACTOR     = 1.03;

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

// IDs de categoría PrestaShop verificados en alltec.cl
const CATEGORIES = [
  { url: '/63-amd',                        catId: 'gpu',     sub: 'amd'    },
  { url: '/64-nvidia',                     catId: 'gpu',     sub: 'nvidia' },
  { url: '/28-amd',                        catId: 'cpu',     sub: 'amd'    },
  { url: '/29-intel',                      catId: 'cpu',     sub: 'intel'  },
  { url: '/31-para-amd',                   catId: 'mobo',    sub: 'am4'    },
  { url: '/79-para-intel',                 catId: 'mobo',    sub: 'lga1700'},
  { url: '/37-ddr4',                       catId: 'ram',     sub: 'ddr4'   },
  { url: '/118-ddr5',                      catId: 'ram',     sub: 'ddr5'   },
  { url: '/34-ssd',                        catId: 'storage'                },
  { url: '/33-mecanicos-rigidos',          catId: 'storage', sub: 'hdd'    },
  { url: '/92-water-cooling',              catId: 'cooling', sub: 'liquida'},
  { url: '/93-cpu-cooler',                 catId: 'cooling', sub: 'aire'   },
  { url: '/38-potencia-nominal-estandar',  catId: 'psu'                    },
  { url: '/80-potencia-real-certificadas', catId: 'psu',     sub: 'certificada'},
  { url: '/81-sin-fuente-de-poder',        catId: 'case'                   },
  { url: '/82-con-fuente-de-poder',        catId: 'case'                   },
];

const OUT_OF_STOCK = ['sin stock','agotado','out of stock','no disponible','sold out'];

function parsePrice(str) {
  if (!str) return null;
  const n = parseInt(String(str).replace(/[^\d]/g, ''));
  return n > 1000 && n < 100000000 ? n : null;
}

function extractText($el, selectors) {
  for (const sel of selectors) {
    const t = $el.find(sel).first().text().trim();
    if (t) return t;
  }
  return '';
}

class AlltecScraper extends BaseScraper {
  constructor() {
    super('alltec', 'Alltec');
    this.seenUrls = new Set();
  }

  async scrapeAll() {
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[alltec] Error ${cat.catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(cat) {
    let page = 1;
    let total = 0;

    while (page <= 20) {
      const pageUrl = proxify(`${BASE}${cat.url}?page=${page}`);
      this.log('info', `[alltec] ${cat.catId} ${cat.url} pág ${page}`);

      let $;
      try {
        const res = await this.client.get(pageUrl, {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          timeout: 25000,
        });
        $ = cheerio.load(res.data);
      } catch (err) {
        this.log('warn', `[alltec] HTTP error: ${err.message}`);
        break;
      }

      // PrestaShop: article.product-miniature
      const items = $('article.product-miniature, .ajax_block_product, ul.product_list li');
      if (!items.length) {
        this.log('info', `[alltec] Sin productos pág ${page}`);
        break;
      }

      let newInPage = 0;
      for (const el of items.toArray()) {
        try {
          const $el = $(el);

          const productUrl = $el.find('a.product-thumbnail, .product-name a, h3 a').first().attr('href') || '';
          if (!productUrl || this.seenUrls.has(productUrl)) continue;
          this.seenUrls.add(productUrl);

          const name = extractText($el, [
            '.product-title a', '.product-name a', 'h3 a', 'a[title]',
          ]) || $el.find('a[title]').first().attr('title') || '';
          if (!name || name.length < 4) continue;

          // PrestaShop: precio con descuento en .price, precio normal en .regular-price
          const priceRaw  = extractText($el, ['.price', '.product-price-and-shipping .price', '[itemprop="price"]']);
          const price = parsePrice(priceRaw);
          if (!price) continue;

          const normalRaw = extractText($el, ['.regular-price', '.old-price', '.price-old']);
          const priceNormal = normalRaw ? parsePrice(normalRaw) : null;
          const priceCard   = Math.round(price * FACTOR);
          const discount    = priceNormal && priceNormal > price
            ? Math.round((1 - price / priceNormal) * 100) : null;

          // Stock
          const txt = $el.text().toLowerCase();
          const stock = OUT_OF_STOCK.some(p => txt.includes(p)) ||
            $el.find('.product-unavailable,.out-of-stock').length
            ? 'out_of_stock' : 'in_stock';

          const imageUrl = $el.find('img').first().attr('data-src')
                        || $el.find('img').first().attr('src') || null;

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
            { current: price, normal: priceNormal, discount, stock, url: productUrl }
          );
        } catch (err) {
          this.log('warn', `[alltec] item error: ${err.message}`);
        }
      }

      total += newInPage;
      this.log('info', `[alltec] ✓ ${cat.url} pág ${page}: ${newInPage}`);
      if (items.length < 6 || newInPage === 0) break;
      page++;
      await this.delay(1500, 2500);
    }

    this.log('info', `[alltec] ✓ ${cat.url}: ${total} total`);
  }
}

if (require.main === module) {
  new AlltecScraper().run().then(r => {
    console.log('Alltec:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = AlltecScraper;
