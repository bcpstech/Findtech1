/**
 * scraper/stores/alltec.js
 * Alltec — PrestaShop con tema personalizado
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL      = 'https://www.alltec.cl';
const PROXY_URL     = process.env.CF_PROXY_URL    || '';
const PROXY_SECRET  = process.env.CF_PROXY_SECRET || '';

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_SECRET}`;
}

const CATEGORIES = [
  { url: '/63-amd',                        catId: 'gpu'     },
  { url: '/64-nvidia',                     catId: 'gpu'     },
  { url: '/28-amd',                        catId: 'cpu'     },
  { url: '/29-intel',                      catId: 'cpu'     },
  { url: '/31-para-amd',                   catId: 'mobo'    },
  { url: '/79-para-intel',                 catId: 'mobo'    },
  { url: '/37-ddr4',                       catId: 'ram'     },
  { url: '/118-ddr5',                      catId: 'ram'     },
  { url: '/34-ssd',                        catId: 'storage' },
  { url: '/33-mecanicos-rigidos',          catId: 'storage' },
  { url: '/92-water-cooling',              catId: 'cooling' },
  { url: '/93-cpu-cooler',                 catId: 'cooling' },
  { url: '/38-potencia-nominal-estandar',  catId: 'psu'     },
  { url: '/80-potencia-real-certificadas', catId: 'psu'     },
  { url: '/81-sin-fuente-de-poder',        catId: 'case'    },
  { url: '/82-con-fuente-de-poder',        catId: 'case'    },
];

const CARD_SURCHARGE = 1.03;

const PRODUCT_SELECTORS = [
  'ul.products li.product',
  'ul.product_list li',
  '.products-grid .product-container',
  'article.product-miniature',
  '.ajax_block_product',
];

// Frases PrestaShop que indican sin stock
const OUT_OF_STOCK_PHRASES = [
  'sin stock', 'agotado', 'out of stock', 'no disponible',
  'sold out', 'unavailable', 'no hay stock',
];

function findProducts($) {
  for (const sel of PRODUCT_SELECTORS) {
    const items = $(sel);
    if (items.length > 0) return items;
  }
  return $([]);
}

function detectStock($el) {
  // PrestaShop: clase específica de sin stock
  if ($el.find('.product-unavailable, .out-of-stock, .product-out-of-stock').length) {
    return 'out_of_stock';
  }
  // Buscar texto de disponibilidad
  const availText = $el.find(
    '.availability, .product-availability, [class*="stock"], .label-danger'
  ).text().toLowerCase();
  if (OUT_OF_STOCK_PHRASES.some(p => availText.includes(p))) return 'out_of_stock';

  // Buscar en el texto completo del card (más amplio)
  const fullText = $el.text().toLowerCase();
  if (OUT_OF_STOCK_PHRASES.some(p => fullText.includes(p))) return 'out_of_stock';

  // Botón "Agregar" deshabilitado
  const addBtn = $el.find('button, .add-to-cart, [class*="add_to_cart"]');
  if (addBtn.length && addBtn.attr('disabled') !== undefined) return 'out_of_stock';

  return 'in_stock';
}

function extractPrice($el) {
  const candidates = [
    $el.find('.price-box span.price').first().text(),
    $el.find('.product-price-and-shipping .price').first().text(),
    $el.find('[itemprop="price"]').attr('content'),
    $el.find('[itemprop="price"]').first().text(),
    $el.find('.price').first().text(),
    $el.find('[class*="price"]').first().text(),
  ];
  for (const raw of candidates) {
    if (raw && raw.trim()) return raw.trim();
  }
  return '';
}

function extractName($el) {
  const candidates = [
    $el.find('.product-name').text(),
    $el.find('.product-title a').text(),
    $el.find('h3 a').first().text(),
    $el.find('h2 a').first().text(),
    $el.find('a[title]').attr('title'),
    $el.find('a').first().attr('title'),
  ];
  for (const raw of candidates) {
    const name = (raw || '').trim();
    if (name.length > 3) return name;
  }
  return '';
}

function extractUrl($el) {
  return $el.find('a.products-block-image').attr('href')
    || $el.find('.product-name a').attr('href')
    || $el.find('h3 a').first().attr('href')
    || $el.find('a').first().attr('href')
    || '';
}

function extractImage($el) {
  return $el.find('img.img-responsive').attr('src')
    || $el.find('img').first().attr('data-src')
    || $el.find('img').first().attr('src')
    || null;
}

class AlltecScraper extends BaseScraper {
  constructor() { super('alltec', 'Alltec'); }

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

  async scrapeCategory({ url: categoryPath, catId }) {
    let page = 1;

    while (page <= 20) {
      const directUrl = `${BASE_URL}${categoryPath}?page=${page}`;
      const url = proxify(directUrl);
      this.log('info', `[alltec] ${catId} ${categoryPath} pág ${page}`);

      try {
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          }
        });

        const $ = cheerio.load(res.data);
        const items = findProducts($);

        if (!items.length) {
          const bodySnippet = res.data?.slice?.(0, 500) || '';
          this.log('info', `[alltec] Sin productos pág ${page} — HTML: ${bodySnippet.replace(/\s+/g,' ').slice(0,200)}`);
          break;
        }

        let newInPage = 0;
        for (const el of items.toArray()) {
          try {
            const $el = $(el);
            const productUrl = extractUrl($el);
            if (this.seenUrls.has(productUrl)) continue;
            this.seenUrls.add(productUrl);

            const name = extractName($el);
            if (!name) continue;

            const priceRaw = extractPrice($el);
            const price = this.parseAlltecPrice(priceRaw);
            if (!price || price < 1000) continue;

            // FIX: detectar stock real
            const stock = detectStock($el);

            const oldRaw = $el.find('.price-box .old-price, .regular-price, .old-price').text().trim();
            const regularPrice = oldRaw ? this.parseAlltecPrice(oldRaw) : null;
            const priceCard = Math.round(price * CARD_SURCHARGE);
            const imageUrl = extractImage($el);

            this.stats.found++;
            newInPage++;
            await this.saveProductWithR2(
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
                stock,    // FIX: valor real
                url:      productUrl || null,
              }
            );
          } catch (err) {
            this.log('warn', `[alltec] Error item: ${err.message}`);
          }
        }

        this.log('info', `[alltec] ✓ ${catId} pág ${page}: ${newInPage} nuevos`);
        if (items.length < 8) break;
        page++;
        await this.delay(1000, 2000);

      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[alltec] Error HTTP ${categoryPath} pág ${page}: ${err.message}`);
        break;
      }
    }
    this.log('info', `✓ alltec ${catId} total: ${this.stats.found}`);
  }

  parseAlltecPrice(str) {
    if (!str) return null;
    const clean = str.replace(/\$/g, '').replace(/\./g, '').replace(/,/g, '').replace(/\s/g, '');
    const num = parseInt(clean);
    if (isNaN(num) || num < 1000 || num > 100000000) return null;
    return num;
  }
}

if (require.main === module) {
  new AlltecScraper().run().then(r => {
    console.log('Alltec:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = AlltecScraper;
