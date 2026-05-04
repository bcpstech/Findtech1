/**
 * scraper/base-scraper.js
 * Clase base con axios + cheerio (sin Puppeteer/Chromium)
 */

require('dotenv').config();
const axios   = require('axios');
const cheerio = require('cheerio');
const { upsertProduct, upsertPrice, logScrape } = require('../db/database');
const logger  = require('./logger');
const { mirrorImage } = require('./r2-images');

let axiosRetry;
try { axiosRetry = require('axios-retry'); } catch(e) {}

const TIMEOUT   = parseInt(process.env.SCRAPE_TIMEOUT   || 60000);
const DELAY_MIN = parseInt(process.env.SCRAPE_DELAY_MIN || 800);
const DELAY_MAX = parseInt(process.env.SCRAPE_DELAY_MAX || 2500);
const MAX_RETRY = parseInt(process.env.SCRAPE_MAX_RETRIES || 3);
const USE_R2    = !!process.env.R2_KEY_ID;

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'es-CL,es;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Cache-Control': 'max-age=0',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

class BaseScraper {
  constructor(storeId, storeName) {
    this.storeId   = storeId;
    this.storeName = storeName;
    this.stats     = { found: 0, updated: 0, errors: 0 };

    this.client = axios.create({
      timeout: TIMEOUT,
      headers: DEFAULT_HEADERS,
    });

    if (axiosRetry) {
      axiosRetry.default(this.client, {
        retries: MAX_RETRY,
        retryDelay: (count) => count * 2000,
        retryCondition: (err) =>
          axiosRetry.isNetworkOrIdempotentRequestError(err) ||
          (err.response && err.response.status >= 500),
      });
    }
  }

  delay(min = DELAY_MIN, max = DELAY_MAX) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(r => setTimeout(r, ms));
  }

  log(level, msg, extra = {}) {
    logger[level](msg, { store: this.storeId, ...extra });
  }

  parsePrice(raw) {
    if (!raw) return null;
    const cleaned = String(raw).replace(/[^\d]/g, '');
    const num = parseInt(cleaned, 10);
    if (isNaN(num) || num < 1000 || num > 100000000) return null;
    return num;
  }

  slugify(text) {
    return text.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100);
  }

  detectCategory(name) {
    const n = name.toLowerCase();
    if (/rtx|radeon rx|geforce|gpu|tarjeta (gr[aá]fica|de video)/i.test(n)) return 'gpu';
    if (/ryzen|core (ultra|i[3579])|procesador|cpu/i.test(n))               return 'cpu';
    if (/ddr[45]|\bram\b|memoria/i.test(n))                                  return 'ram';
    if (/nvme|m\.2|ssd|disco (s[oó]lido|duro)|hdd/i.test(n))               return 'storage';
    if (/refriger|cooling|disipador|aio|cooler|ventilador/i.test(n))        return 'cooling';
    if (/placa madre|motherboard|mainboard/i.test(n))                       return 'mobo';
    if (/fuente (de poder|de alimentaci[oó]n)|psu/i.test(n))                return 'psu';
    if (/gabinete|\bcase\b|torre/i.test(n))                                  return 'case';
    if (/monitor|pantalla/i.test(n))                                         return 'monitor';
    if (/teclado|mouse|headset|aud[ií]fonos|auricular/i.test(n))            return 'periph';
    return 'other';
  }

  async fetchPage(url) {
    try {
      const res = await this.client.get(url);
      return cheerio.load(res.data);
    } catch (err) {
      this.log('warn', `Error fetching ${url}: ${err.message}`);
      return null;
    }
  }

  /**
   * Extrae specs técnicas de una página de detalle HTML (PrestaShop / OpenCart / WooCommerce)
   * Retorna objeto {key: value} o {} si no encuentra nada útil
   */
  async fetchProductSpecs(productUrl, proxify) {
    if (!productUrl) return {};
    try {
      const fetchUrl = proxify ? proxify(productUrl) : productUrl;
      const res = await this.client.get(fetchUrl, { timeout: 20000 });
      const $ = cheerio.load(res.data);
      const specs = {};

      // ── PrestaShop: tabla de características ────────────────────────────
      // #product-details .product-features, .product-manufacturer
      $('section.product-features dl.data-sheet dt, .product-features .name').each((_, el) => {
        const key = $(el).text().trim();
        const val = $(el).next('dd, .value').text().trim();
        if (key && val && key.length < 60 && val.length < 120) specs[key] = val;
      });

      // PrestaShop alternativo: table rows
      if (!Object.keys(specs).length) {
        $('table.table-data-sheet tr, .features-table tr, #product-features tr').each((_, el) => {
          const cols = $(el).find('td, th');
          if (cols.length >= 2) {
            const key = $(cols[0]).text().trim();
            const val = $(cols[1]).text().trim();
            if (key && val && key.length < 60 && val.length < 120) specs[key] = val;
          }
        });
      }

      // ── WooCommerce: tabla de especificaciones ───────────────────────────
      if (!Object.keys(specs).length) {
        $('table.woocommerce-product-attributes tr, .shop_attributes tr').each((_, el) => {
          const key = $(el).find('th').text().trim();
          const val = $(el).find('td').text().trim().replace(/\s+/g, ' ');
          if (key && val && key.length < 60 && val.length < 120) specs[key] = val;
        });
      }

      // ── OpenCart: specs en divs/dl ───────────────────────────────────────
      if (!Object.keys(specs).length) {
        $('dl.dl-horizontal dt, .spec-name, [class*="spec"] dt').each((_, el) => {
          const key = $(el).text().trim();
          const val = $(el).next('dd, .spec-value').text().trim();
          if (key && val && key.length < 60 && val.length < 120) specs[key] = val;
        });
      }

      // ── Genérico: cualquier tabla con 2 columnas que parezca specs ───────
      if (!Object.keys(specs).length) {
        $('table tr').each((_, el) => {
          const cols = $(el).find('td');
          if (cols.length === 2) {
            const key = $(cols[0]).text().trim();
            const val = $(cols[1]).text().trim();
            if (key && val && key.length < 50 && val.length < 100 &&
                !key.toLowerCase().includes('precio') &&
                !key.toLowerCase().includes('$')) {
              specs[key] = val;
            }
          }
        });
      }

      // Filtrar specs de precio/stock que no son técnicas
      const SKIP = ['precio','price','stock','disponib','cantidad','referencia','sku','codigo','código'];
      return Object.fromEntries(
        Object.entries(specs).filter(([k]) => !SKIP.some(s => k.toLowerCase().includes(s)))
      );
    } catch (err) {
      this.log('warn', `[specs] Error fetching ${productUrl}: ${err.message}`);
      return {};
    }
  }

  /**
   * Extrae specs de la API WooCommerce Store (p.attributes[])
   */
  extractWooSpecs(p) {
    const specs = {};
    if (!p.attributes?.length) return specs;
    for (const attr of p.attributes) {
      const key = attr.name || attr.taxonomy || '';
      const val = Array.isArray(attr.terms)
        ? attr.terms.map(t => t.name).join(', ')
        : (attr.value || '');
      if (key && val && key.length < 60 && val.length < 120) {
        specs[key] = val;
      }
    }
    return specs;
  }

  async saveProductWithR2(product, price) {
    if (USE_R2 && product.imageUrl) {
      try {
        const slug = this.slugify(product.name);
        const r2Url = await mirrorImage(product.imageUrl, slug);
        if (r2Url) product.imageUrl = r2Url;
      } catch(e) {}
    }
    return this.saveProduct(product, price);
  }

  saveProduct(product, price) {
    try {
      // Si viene partNumber, usarlo como external_id compartido entre tiendas
      // Así el mismo producto de distintas tiendas se agrupa en un solo registro
      const pnClean = product.partNumber
        ? product.partNumber.toLowerCase().replace(/[^a-z0-9]/g, '')
        : null;
      const external_id = pnClean
        ? `pn_${pnClean}`
        : `${this.storeId}_${this.slugify(product.name)}`;

      // Slug único: con partno es compartido, sin partno incluye storeId
      const slug = pnClean
        ? this.slugify(product.name).slice(0, 95)
        : `${this.storeId}-${this.slugify(product.name)}`.slice(0, 100);

      const row = upsertProduct({
        external_id,
        category_id: product.category || this.detectCategory(product.name),
        brand:       product.brand || this.extractBrand(product.name),
        name:        product.name,
        slug,
        image_url:   product.imageUrl || null,
        specs:       product.specs ? JSON.stringify(product.specs) : null,
        tags:        product.tags  ? JSON.stringify(product.tags)  : null,
      });
      if (!row || !row.id) return;

      upsertPrice({
        product_id:   row.id,
        store_id:     this.storeId,
        price:        price.current,
        price_card:   price.card || null,
        price_normal: price.normal || null,
        discount_pct: price.discount || null,
        stock:        price.stock || 'in_stock',
        product_url:  price.url || null,
      });
      this.stats.updated++;
    } catch (err) {
      this.stats.errors++;
      this.log('error', `Error guardando: ${err.message}`, { name: product.name });
    }
  }

  extractBrand(name) {
    const brands = ['NVIDIA','AMD','Intel','Samsung','WD','Western Digital','Seagate',
      'Corsair','G.Skill','Kingston','Crucial','ASUS','MSI','Gigabyte','ASRock',
      'Noctua','Arctic','be quiet!','Seasonic','EVGA','Cooler Master','NZXT',
      'LG','BenQ','AOC','Acer','Dell','Logitech','Razer','SteelSeries','HyperX',
      'Thermaltake','Lian Li','Fractal','DeepCool','Phanteks','Antec','Zotac',
      'PowerColor','Sapphire','XFX','PNY','Palit','Gainward'];
    const upper = name.toUpperCase();
    return brands.find(b => upper.includes(b.toUpperCase())) || 'Genérico';
  }

  async run() {
    const startTime = Date.now();
    const logId = logScrape(this.storeId, 'running');
    this.log('info', `Iniciando scraping (axios+cheerio)`);

    try {
      await this.scrapeAll();
      const duration = Date.now() - startTime;
      logScrape(this.storeId, 'success', { ...this.stats, duration, logId });
      this.log('info', `Completado en ${(duration/1000).toFixed(1)}s - ${this.stats.updated} productos`);
      return { success: true, ...this.stats, duration };
    } catch (err) {
      const duration = Date.now() - startTime;
      logScrape(this.storeId, 'failed', { ...this.stats, errorDetail: err.message, duration, logId });
      this.log('error', `Error fatal: ${err.message}`);
      return { success: false, error: err.message, ...this.stats };
    }
  }

  async scrapeAll() {
    throw new Error(`scrapeAll() debe implementarse en ${this.constructor.name}`);
  }
}

module.exports = BaseScraper;
