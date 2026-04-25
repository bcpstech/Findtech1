/**
 * scraper/base-scraper.js
 * Clase base con axios + cheerio (sin Puppeteer/Chromium)
 * Mucho más rápido y liviano — instalación en segundos.
 */

require('dotenv').config();
const axios   = require('axios');
const cheerio = require('cheerio');
const { upsertProduct, upsertPrice, logScrape } = require('../db/database');
const logger  = require('./logger');
const { mirrorImage } = require('./r2-images');
const { fetchIcecatData } = require('./icecat');

// Configurar reintentos automáticos
let axiosRetry;
try { axiosRetry = require('axios-retry'); } catch(e) {}

const TIMEOUT   = parseInt(process.env.SCRAPE_TIMEOUT   || 60000);
const USE_ICECAT = process.env.USE_ICECAT !== 'false';
const USE_R2 = process.env.R2_KEY_ID ? true : false; // activado por defecto
const DELAY_MIN = parseInt(process.env.SCRAPE_DELAY_MIN || 800);
const DELAY_MAX = parseInt(process.env.SCRAPE_DELAY_MAX || 2500);
const MAX_RETRY = parseInt(process.env.SCRAPE_MAX_RETRIES || 3);

// Headers realistas para evitar bloqueos
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

    // Crear instancia axios con reintentos
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

  // ── Utilidades ──────────────────────────────────────
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
    // Filtrar precios inválidos (< $1.000 o > $100.000.000)
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

  // ── Fetch HTML ──────────────────────────────────────
  async fetchPage(url) {
    try {
      const res = await this.client.get(url);
      return cheerio.load(res.data);
    } catch (err) {
      this.log('warn', `Error fetching ${url}: ${err.message}`);
      return null;
    }
  }

  // ── Guardar en DB ───────────────────────────────────
  async saveProductWithR2(product, price) {
    // Mirror imagen a R2 si está configurado
    if (USE_R2 && product.imageUrl) {
      const slug = this.slugify(product.name);
      const r2Url = await mirrorImage(product.imageUrl, slug);
      if (r2Url) product.imageUrl = r2Url;
    }
    return this.saveProduct(product, price);
  }

  saveProduct(product, price) {
    try {
      const external_id = `${this.storeId}_${this.slugify(product.name)}`;
      const row = upsertProduct({
        external_id,
        category_id: product.category || this.detectCategory(product.name),
        brand:       product.brand || this.extractBrand(product.name),
        name:        product.name,
        slug:        this.slugify(product.name),
        image_url:   product.imageUrl || null,
        specs:       product.specs ? JSON.stringify(product.specs) : null,
        tags:        product.tags  ? JSON.stringify(product.tags)  : null,
      });
      if (!row || !row.id) return;

      upsertPrice({
        product_id:   row.id,
        store_id:     this.storeId,
        price:        price.current,
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
      'LG','BenQ','AOC','Acer','Dell','Logitech','Razer','SteelSeries','HyperX'];
    const upper = name.toUpperCase();
    return brands.find(b => upper.includes(b.toUpperCase())) || 'Genérico';
  }

  // ── Ejecutar scraping completo ──────────────────────
  async run() {
    const startTime = Date.now();
    const logId = logScrape(this.storeId, 'running');
    this.log('info', `⬇️  Iniciando scraping (axios+cheerio)`);

    try {
      await this.scrapeAll();
      const duration = Date.now() - startTime;
      logScrape(this.storeId, 'success', { ...this.stats, duration, logId });
      this.log('info', `✅ Completado en ${(duration/1000).toFixed(1)}s — ${this.stats.updated} productos`);
      return { success: true, ...this.stats, duration };
    } catch (err) {
      const duration = Date.now() - startTime;
      logScrape(this.storeId, 'failed', { ...this.stats, errorDetail: err.message, duration, logId });
      this.log('error', `❌ Error fatal: ${err.message}`);
      return { success: false, error: err.message, ...this.stats };
    }
  }

  async scrapeAll() {
    throw new Error(`scrapeAll() debe implementarse en ${this.constructor.name}`);
  }
}

module.exports = BaseScraper;
