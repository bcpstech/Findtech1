/**
 * scraper/stores/megadrive.js
 * MegaDrive.cl — WooCommerce HTML scraping via proxy
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL     = 'https://www.megadrive.cl';
const PROXY_URL    = process.env.CF_PROXY_URL    || '';
const PROXY_SECRET = process.env.CF_PROXY_SECRET || '';

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_SECRET}`;
}

const SEARCHES = [
  { query: 'rtx',          catId: 'gpu',     minPrice: 80000 },
  { query: 'radeon rx',    catId: 'gpu',     minPrice: 80000 },
  { query: 'ryzen',        catId: 'cpu',     minPrice: 20000 },
  { query: 'core i',       catId: 'cpu',     minPrice: 20000 },
  { query: 'placa madre',  catId: 'mobo',    minPrice: 30000 },
  { query: 'memoria ddr',  catId: 'ram',     minPrice: 10000 },
  { query: 'ssd nvme',     catId: 'storage', minPrice: 15000 },
  { query: 'fuente poder', catId: 'psu',     minPrice: 20000 },
  { query: 'gabinete',     catId: 'case',    minPrice: 20000 },
];

const OUT_OF_STOCK = ['sin stock','agotado','out of stock','no disponible'];

class MegaDriveScraper extends BaseScraper {
  constructor() { super('megadrive', 'MegaDrive'); }

  async scrapeAll() {
    this.seenUrls = new Set();
    for (const cat of SEARCHES) {
      try {
        await this.scrapeSearch(cat);
        await this.delay(2000, 3000);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error ${cat.catId}: ${err.message}`);
      }
    }
  }

  async scrapeSearch({ query, catId, minPrice }) {
    const directUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}&post_type=product`;
    const url = proxify(directUrl);
    this.log('info', `[megadrive] ${catId} "${query}"`);
    try {
      const res = await this.client.get(url, {
        headers: { 'Accept': 'text/html', 'Accept-Language': 'es-CL,es;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36' }
      });
      const $ = cheerio.load(res.data);
      const items = $('ul.products li.product, .products .product');
      let newItems = 0;

      for (const el of items.toArray()) {
        try {
          const $el = $(el);
          const productUrl = $el.find('a').first().attr('href') || '';
          if (!productUrl || this.seenUrls.has(productUrl)) continue;
          this.seenUrls.add(productUrl);

          const name = $el.find('.woocommerce-loop-product__title, h2, h3').first().text().trim();
          if (!name || name.length < 5) continue;

          const priceRaw = $el.find('.price ins .amount, .price .amount').first().text()
                        || $el.find('.price').first().text();
          const price = this.parsePrice(priceRaw);
          if (!price || price < minPrice) continue;

          const stockTxt = $el.text().toLowerCase();
          const stock = OUT_OF_STOCK.some(s => stockTxt.includes(s)) || $el.find('.out-of-stock').length
            ? 'out_of_stock' : 'in_stock';

          this.stats.found++;
          newItems++;
          await this.saveProductWithR2(
            { name, category: catId, brand: this.extractBrand(name),
              imageUrl: $el.find('img').first().attr('src') || null,
              specs: { 'Precio': `$${price.toLocaleString('es-CL')}` }
            },
            { current: price, normal: null, discount: null, stock, url: productUrl }
          );
        } catch(e) {}
      }
      this.log('info', `[megadrive] ✓ "${query}": ${newItems} productos`);
    } catch(err) {
      this.stats.errors++;
      this.log('warn', `[megadrive] Error "${query}": ${err.message}`);
    }
  }
}

if (require.main === module) {
  new MegaDriveScraper().run().then(r => { console.log('MegaDrive:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = MegaDriveScraper;
