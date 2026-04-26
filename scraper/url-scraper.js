/**
 * scraper/url-scraper.js
 * Scraper basado en URLs directas desde planilla CSV/JSON.
 * Lee scraper/data/product-urls.json y visita cada URL para extraer
 * precio, stock y specs reales.
 *
 * Uso: node scraper/url-scraper.js
 *      node scraper/url-scraper.js --store n1g
 *      node scraper/url-scraper.js --category cpu
 */

require('dotenv').config();
const fs      = require('fs');
const path    = require('path');
const cheerio = require('cheerio');
const BaseScraper = require('./base-scraper');

const PROXY_URL    = process.env.CF_PROXY_URL    || '';
const PROXY_SECRET = process.env.CF_PROXY_SECRET || '';

function proxify(url, storeId) {
  // N1G y Alltec requieren proxy
  const PROXY_STORES = ['n1g', 'alltec', 'winpy', 'sipo', 'megadrive', 'centrale', 'cg', 'pcexpress'];
  if (!PROXY_URL || !PROXY_STORES.includes(storeId)) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_SECRET}`;
}

// ── Extractores de precio por plataforma ──────────────────────────────────

function extractPrestaShop($, storeId) {
  // Intentar múltiples selectores de precio PrestaShop
  const priceSelectors = [
    '[itemprop="price"]',
    '.current-price-value',
    '.product-price-and-shipping .price',
    '.price-final_price',
    '#js-product-prices-block .price',
    '.product-price .price',
    'span.price',
  ];
  let price = null;
  for (const sel of priceSelectors) {
    const el = $(sel).first();
    const raw = el.attr('content') || el.text().trim();
    price = parsePrice(raw);
    if (price) break;
  }

  // Precio normal (antes del descuento)
  const oldRaw = $('.price-old, .regular-price, .crossed-out .current-price-value, del .price').first().text().trim();
  const regularPrice = oldRaw ? parsePrice(oldRaw) : null;

  // Stock
  // Solo marcar out_of_stock con evidencia explícita — evitar falsos negativos
  const unavailable = $('.product-unavailable, .out-of-stock, #product-availability .out-of-stock').length;
  // Solo leer elementos específicos de disponibilidad, NO [class*="stock"] genérico
  const availText = $('#product-availability .availability-msg, .product-availability, .availability-ooc')
    .text().toLowerCase();
  const metaAvail = $('[itemprop="availability"]').attr('content') || '';
  const stock = unavailable
    || metaAvail.includes('OutOfStock')
    || availText.includes('agotado')
    || availText.includes('sin stock')
    || availText.includes('no disponible')
    || availText.includes('out of stock')
    ? 'out_of_stock' : 'in_stock';

  // Specs: tabla de características PrestaShop
  const specs = {};
  $('section.product-features dl.data-sheet dt, .product-features .name').each((_, el) => {
    const key = $(el).text().trim();
    const val = $(el).next('dd, .value').text().trim();
    if (key && val && key.length < 80) specs[key] = val;
  });
  if (!Object.keys(specs).length) {
    $('table.table-data-sheet tr, #product-details table tr, .features-table tr').each((_, el) => {
      const cols = $(el).find('td, th');
      if (cols.length >= 2) {
        const k = $(cols[0]).text().trim();
        const v = $(cols[1]).text().trim();
        if (k && v && k.length < 80) specs[k] = v;
      }
    });
  }
  // Alltec usa un formato diferente — buscar en divs
  if (!Object.keys(specs).length) {
    $('.product-information .row, .product-desc .row').each((_, el) => {
      const k = $(el).find('label, .label, strong').first().text().trim();
      const v = $(el).find('span, p').last().text().trim();
      if (k && v && k !== v && k.length < 80) specs[k] = v;
    });
  }

  const imageUrl = $('img.js-qv-product-cover, .product-cover img, #product-cover img').first().attr('src')
               || $('[itemprop="image"]').first().attr('src')
               || $('.product-images img, .slick-slide img').first().attr('src') || null;
  const name = $('h1.product-detail-name, h1[itemprop="name"], h1.page-title, h1').first().text().trim();
  const brand = $('[itemprop="brand"] [itemprop="name"], .manufacturer-name, .brand-name').first().text().trim();

  return { price, regularPrice, stock, specs, imageUrl, name, brand };
}

function extractWooCommerce($, storeId) {
  // WooCommerce: Centrale, SPDigital, etc.
  // Intentar múltiples selectores
  const priceSelectors = [
    '.price ins .woocommerce-Price-amount',
    '.price .woocommerce-Price-amount',
    '[itemprop="price"]',
    '.woocommerce-Price-amount.amount',
    '.price ins .amount',
    '.price .amount',
    '.entry-summary .price',
  ];
  let price = null;
  for (const sel of priceSelectors) {
    const el = $(sel).first();
    const raw = el.attr('content') || el.text().trim();
    price = parsePrice(raw);
    if (price) break;
  }

  const oldRaw = $('.price del .amount').first().text().trim();
  const regularPrice = oldRaw ? parsePrice(oldRaw) : null;

  const stockEl = $('.stock, .in-stock, .out-of-stock');
  const stockText = stockEl.text().toLowerCase() + ' ' + $('[class*="stock"]').text().toLowerCase();
  const stock = stockEl.hasClass('out-of-stock') || stockText.includes('agotado') || stockText.includes('sin stock')
    ? 'out_of_stock' : 'in_stock';

  // Specs WooCommerce: tabla de atributos
  const specs = {};
  $('table.woocommerce-product-attributes tr, .shop_attributes tr').each((_, el) => {
    const k = $(el).find('th').text().trim();
    const v = $(el).find('td').text().replace(/\s+/g,' ').trim();
    if (k && v && k.length < 80) specs[k] = v;
  });
  // Specs adicionales en descripción corta
  if (!Object.keys(specs).length) {
    $('.woocommerce-product-details__short-description ul li').each((_, el) => {
      const txt = $(el).text().trim();
      const colon = txt.indexOf(':');
      if (colon > 0 && colon < 50) {
        specs[txt.slice(0,colon).trim()] = txt.slice(colon+1).trim();
      }
    });
  }

  const imageUrl = $('.woocommerce-product-gallery img').first().attr('src')
               || $('[itemprop="image"]').first().attr('src') || null;
  const name = $('h1.product_title, h1[itemprop="name"]').first().text().trim();
  const brand = $('[itemprop="brand"], .brand').first().text().trim();

  return { price, regularPrice, stock, specs, imageUrl, name, brand };
}

function extractGeneric($) {
  const priceRaw = $('[itemprop="price"]').attr('content')
               || $('[itemprop="price"]').first().text()
               || $('.price, [class*="price"]').first().text();
  const price = parsePrice(priceRaw);

  const stockMeta = $('[itemprop="availability"]').attr('content') || '';
  const stock = stockMeta.includes('OutOfStock') ? 'out_of_stock' : 'in_stock';

  const specs = {};
  $('table tr').each((_, el) => {
    const cols = $(el).find('td');
    if (cols.length === 2) {
      const k = $(cols[0]).text().trim();
      const v = $(cols[1]).text().trim();
      if (k && v && k.length < 80 && !k.match(/precio|price|\$/i)) specs[k] = v;
    }
  });

  const imageUrl = $('[itemprop="image"]').attr('src')
               || $('meta[property="og:image"]').attr('content') || null;
  const name = $('[itemprop="name"], h1').first().text().trim();
  const brand = $('[itemprop="brand"]').first().text().trim();

  return { price, regularPrice: null, stock, specs, imageUrl, name, brand };
}

function detectPlatform(html, storeId) {
  if (['n1g','alltec'].includes(storeId)) return 'prestashop';
  if (['centrale','cg','spdigital','myshop','progaming','dust2','tytgamer',
       'mybox','megabytes','sandos','trulustore','sipo','megadrive'].includes(storeId)) return 'woocommerce';
  // Autodetect
  if (html.includes('PrestaShop') || html.includes('prestashop')) return 'prestashop';
  if (html.includes('woocommerce') || html.includes('WooCommerce')) return 'woocommerce';
  return 'generic';
}

function parsePrice(raw) {
  if (!raw) return null;
  const clean = String(raw).replace(/[^\d]/g,'');
  const num = parseInt(clean, 10);
  if (isNaN(num) || num < 1000 || num > 100000000) return null;
  return num;
}

// ── Clase principal ───────────────────────────────────────────────────────

class UrlScraper extends BaseScraper {
  constructor() {
    super('url-scraper', 'URL Scraper');
    this.urlData = null;
  }

  loadUrls() {
    const dataPath = path.join(__dirname, 'data', 'product-urls.json');
    if (!fs.existsSync(dataPath)) {
      throw new Error(`No se encontró ${dataPath}. Ejecuta primero: node scraper/import-csv.js`);
    }
    this.urlData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  }

  async scrapeAll() {
    this.loadUrls();

    // Filtrar por --store o --category si se pasan como args
    const storeArg = process.argv.find(a => a.startsWith('--store='))?.replace('--store=','')
                  || (process.argv.includes('--store') ? process.argv[process.argv.indexOf('--store')+1] : null);
    const catArg   = process.argv.find(a => a.startsWith('--category='))?.replace('--category=','')
                  || (process.argv.includes('--category') ? process.argv[process.argv.indexOf('--category')+1] : null);

    let entries = this.urlData;
    if (storeArg) entries = entries.filter(e => e.store_id === storeArg);
    if (catArg)   entries = entries.filter(e => e.category === catArg);

    // Solo procesar IN STOCK (los OUT STOCK se guardan como out_of_stock directo)
    this.log('info', `Procesando ${entries.length} URLs (${storeArg||'todas las tiendas'}, ${catArg||'todas las categorías'})`);

    for (const entry of entries) {
      try {
        await this.scrapeUrl(entry);
        await this.delay(800, 1500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error ${entry.url}: ${err.message}`);
      }
    }
  }

  async scrapeUrl(entry) {
    const { store_id, store_name, category, url, stock: csvStock } = entry;

    // Si el CSV dice OUT STOCK, forzar stock = 'out_of_stock' pero
    // igualmente visitar la página para obtener nombre, precio e imagen
    // (el export-json los excluye del frontend pero quedan en la DB)
    const forceOutOfStock = csvStock === 'out_of_stock';

    const fetchUrl = proxify(url, store_id);
    this.log('info', `[${store_id}] ${url.slice(-50)}`);

    const origin = new URL(url).origin;
    const res = await this.client.get(fetchUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9,en-US;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': origin + '/',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: 25000,
    });

    const $ = cheerio.load(res.data);
    const platform = detectPlatform(res.data, store_id);

    let extracted;
    if (platform === 'prestashop')  extracted = extractPrestaShop($, store_id);
    else if (platform === 'woocommerce') extracted = extractWooCommerce($, store_id);
    else extracted = extractGeneric($);

    if (!extracted.price) {
      this.log('warn', `[${store_id}] Sin precio en ${url}`);
      return;
    }

    // Calcular precio tarjeta según tienda
    const CARD_FACTORS = {
      n1g: 1.03, alltec: 1.03, centrale: 1.055, cg: 1.0526,
      pcexpress: 1.03, spdigital: 1.03,
    };
    const factor = CARD_FACTORS[store_id] || 1.03;
    const priceCard = Math.round(extracted.price * factor);

    const name = extracted.name || path.basename(url).replace(/-/g,' ').replace(/\.\w+$/,'').slice(0,100);
    const brand = extracted.brand || this.extractBrand(name);

    // Agregar precios a specs
    const priceSpecs = {};
    if (store_id === 'centrale') {
      priceSpecs['Transferencia / Efectivo']     = `$${extracted.price.toLocaleString('es-CL')}`;
      priceSpecs['Tarjetas de Crédito / Débito'] = `$${priceCard.toLocaleString('es-CL')}`;
    } else {
      priceSpecs['Efectivo/Transferencia'] = `$${extracted.price.toLocaleString('es-CL')}`;
      priceSpecs['Tarjeta crédito/débito'] = `$${priceCard.toLocaleString('es-CL')}`;
    }

    // Usar el store_id real del CSV para guardar el precio correctamente
    const originalStoreId = this.storeId;
    this.storeId = store_id;

    this.stats.found++;
    await this.saveProductWithR2(
      {
        name,
        category,
        brand,
        imageUrl: extracted.imageUrl || null,
        specs: { ...extracted.specs, ...priceSpecs },
      },
      {
        current:  extracted.price,
        normal:   extracted.regularPrice > extracted.price ? extracted.regularPrice : null,
        discount: extracted.regularPrice > extracted.price
          ? Math.round((1 - extracted.price / extracted.regularPrice) * 100) : null,
        stock:    forceOutOfStock ? 'out_of_stock' : extracted.stock,
        url,
      }
    );

    this.storeId = originalStoreId; // restaurar
  }
}

// Override run() para evitar foreign key constraint en scrape_logs
UrlScraper.prototype.run = async function() {
  const startTime = Date.now();
  const logger = require('./logger');
  logger.info('Iniciando URL Scraper (axios+cheerio)', { store: 'url-scraper' });
  try {
    await this.scrapeAll();
    const duration = Date.now() - startTime;
    logger.info(`Completado en ${(duration/1000).toFixed(1)}s - ${this.stats.updated} productos`, { store: 'url-scraper' });
    return { success: true, ...this.stats, duration };
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error(`Error fatal: ${err.message}`, { store: 'url-scraper' });
    return { success: false, error: err.message, ...this.stats };
  }
};

if (require.main === module) {
  new UrlScraper().run().then(r => {
    console.log('URL Scraper:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = UrlScraper;
