/**
 * scraper/stores/spdigital.js
 * SP Digital — scraping por categorías exactas
 * Plataforma propia (no WooCommerce estándar) — HTML scraping
 * Factor tarjeta: 1.03 (3%)
 */

require('dotenv').config();
const cheerio = require('cheerio');
const BaseScraper = require('../base-scraper');

const BASE        = 'https://www.spdigital.cl';
const CARD_FACTOR = 1.03;
const PROXY_URL   = process.env.CF_PROXY_URL    || '';
const PROXY_KEY   = process.env.CF_PROXY_SECRET || '';

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

// ── Categorías con URLs exactas ────────────────────────────────────────────
const CATEGORIES = [
  // PROCESADORES
  { url: '/categories/componentes-procesador-procesador-amd/',   catId: 'cpu', sub: 'amd'   },
  { url: '/categories/componentes-procesador-procesador-intel/', catId: 'cpu', sub: 'intel' },

  // PLACAS MADRE
  { url: '/categories/componentes-placa-madre-placa-amd/',   catId: 'mobo', sub: 'am5'    },
  { url: '/categories/componentes-placa-madre-placa-intel/', catId: 'mobo', sub: 'lga1700' },

  // MEMORIAS RAM
  { url: '/categories/componentes-memorias-ram/?sort_by=RELEVANCE%3AASC&f=category.in%3Amemoria-ram-pc', catId: 'ram' },

  // ALMACENAMIENTO
  { url: '/categories/componentes-almacenamiento/?sort_by=RELEVANCE%3AASC&f=category.in%3Assd-unidad-estado-solido', catId: 'storage' },
  { url: '/categories/componentes-almacenamiento/?sort_by=RELEVANCE%3AASC&f=category.in%3Ahdd-disco-duro-mecanico',  catId: 'storage', sub: 'hdd' },

  // TARJETAS DE VIDEO
  { url: '/categories/componentes-tarjeta-de-video/', catId: 'gpu' },

  // REFRIGERACIÓN
  { url: '/categories/componentes-refrigeracion-y-ventilacion/?sort_by=RELEVANCE%3AASC&f=category.in%3Adisipador-cpu',        catId: 'cooling', sub: 'aire'    },
  { url: '/categories/componentes-refrigeracion-y-ventilacion/?sort_by=RELEVANCE%3AASC&f=category.in%3Arefrigeracion-liquida', catId: 'cooling', sub: 'liquida' },
  { url: '/categories/componentes-refrigeracion-y-ventilacion/?sort_by=RELEVANCE%3AASC&f=category.in%3Aventilador-gabinete',   catId: 'cooling', sub: 'fans'    },

  // FUENTES DE PODER
  { url: '/categories/componentes-fuente-de-poder-fuentes-de-poder/', catId: 'psu' },

  // GABINETES
  { url: '/categories/componentes-gabinetes/?sort_by=RELEVANCE%3AASC&f=category.in%3Amicroatx--miniitx', catId: 'case' },
  { url: '/categories/componentes-gabinetes/?sort_by=RELEVANCE%3AASC&f=category.in%3Afull-y-mid-tower',  catId: 'case' },

  // PCs ARMADOS
  { url: '/categories/gaming-y-streaming-pc-y-notebook-gamer-armados-sp-labs/', catId: 'pc' },
];

// ── Clasificadores por nombre ──────────────────────────────────────────────
function classifyGpu(name) {
  const n = name.toLowerCase();
  if (/rtx|geforce|gtx|nvidia/.test(n)) return 'nvidia';
  if (/radeon|rx\s*\d|amd\s*rx/.test(n)) return 'amd';
  return null;
}

function classifyRam(name) {
  const n = name.toLowerCase();
  if (/ddr5/.test(n)) return 'ddr5';
  if (/ddr4/.test(n)) return 'ddr4';
  return null;
}

function classifyStorage(name) {
  const n = name.toLowerCase();
  if (/pendrive|usb flash|memoria usb/.test(n)) return 'pendrive';
  if (/externo|externa|portable/.test(n)) return /ssd/.test(n) ? 'ssdext' : 'hddext';
  if (/nvme|m\.2|m2|pcie/.test(n)) return 'nvme';
  if (/hdd|disco duro|mecanico|mecánico/.test(n)) return 'hdd';
  return 'sata';
}

function classifyMobo(name) {
  const n = name.toUpperCase();
  if (/AM5/.test(n)) return 'am5';
  if (/AM4/.test(n)) return 'am4';
  if (/LGA\s*1851/.test(n)) return 'lga1851';
  if (/LGA\s*1700/.test(n)) return 'lga1700';
  return null;
}

function classifyCase(name) {
  const n = name.toUpperCase();
  if (/E[\s-]?ATX|EXTENDED|EATX|FULL\s*TOWER/.test(n)) return 'eatx';
  if (/MICRO[\s-]?ATX|MATX/.test(n)) return 'matx';
  if (/MINI[\s-]?ITX/.test(n)) return 'itx';
  if (/\bATX\b/.test(n)) return 'atx';
  return null;
}

function classifyPsu(name) {
  const n = name.toLowerCase();
  const modular = /modular/.test(n);
  const certified = /80\s*plus|80\+|gold|platinum|bronze|titanium|white/.test(n);
  if (modular) return 'modular';
  if (certified) return 'certificada';
  return null;
}

function parsePrice(raw) {
  if (!raw) return null;
  const n = parseInt(String(raw).replace(/[^\d]/g, ''));
  return (!n || n < 1000 || n > 100000000) ? null : n;
}

class SPDigitalScraper extends BaseScraper {
  constructor() {
    super('spdigital', 'SP Digital');
    this.seenUrls = new Set();
  }

  async scrapeAll() {
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[spdigital] Error ${cat.url}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(cat) {
    let page = 1;
    let totalNew = 0;

    while (page <= 20) {
      // SP Digital usa ?page=N en la URL
      const sep = cat.url.includes('?') ? '&' : '?';
      const pageUrl = page === 1
        ? `${BASE}${cat.url}`
        : `${BASE}${cat.url}${sep}page=${page}`;

      this.log('info', `[spdigital] ${cat.catId} pág ${page}`);

      let $;
      try {
        const res = await this.client.get(proxify(pageUrl), {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
            Referer: BASE + '/',
          },
          timeout: 25000,
        });
        $ = cheerio.load(res.data);
      } catch (err) {
        this.log('warn', `[spdigital] HTTP error: ${err.message}`);
        break;
      }

      // SP Digital — múltiples selectores posibles
      let items = $('[class*="ProductCard"], [class*="product-card"]');
      if (!items.length) items = $('[class*="product-item"], [class*="ProductItem"]');
      if (!items.length) items = $('[class*="search-result"], [class*="SearchResult"]');
      if (!items.length) items = $('article[class*="product"], li[class*="product"]');
      if (!items.length) items = $('[data-testid*="product"], [data-cy*="product"]');
      // Fallback: cualquier elemento con precio y nombre
      if (!items.length) {
        items = $('a[href*="/products/"]').closest('div, article, li');
      }

      if (!items.length) {
        // Debug: mostrar primeras clases del body para detectar estructura
        const bodyClasses = $('[class]').slice(0, 5).map((_, el) => $(el).attr('class')).get().join(' | ');
        this.log('warn', `[spdigital] Sin productos pág ${page}. Clases: ${bodyClasses.slice(0,200)}`);
        break;
      }

      let newInPage = 0;
      for (const el of items.toArray()) {
        try {
          const $el = $(el);

          // URL del producto
          const productUrl = $el.find('a').first().attr('href') || '';
          const fullUrl = productUrl.startsWith('http') ? productUrl : BASE + productUrl;
          if (!productUrl || this.seenUrls.has(fullUrl)) continue;
          this.seenUrls.add(fullUrl);

          // Nombre
          const name = $el.find(
            '[class*="product-name"], [class*="ProductName"], [class*="Name"],' +
            '[class*="title"], [class*="Title"], h1, h2, h3, p[class*="name"]'
          ).first().text().trim();
          if (!name || name.length < 3) continue;

          // Precio — SP Digital muestra precio efectivo separado
          // SP Digital muestra precio en varios formatos
          const priceRaw = $el.find(
            '[class*="cash"], [class*="Cash"], [class*="efectivo"], [class*="Efectivo"],' +
            '[class*="price"], [class*="Price"], [class*="precio"], [class*="Precio"]'
          ).filter(function() {
            const txt = $(this).text().trim();
            return txt.includes('$') || /\d{3,}/.test(txt);
          }).first().text().trim();
          const price = parsePrice(priceRaw);
          if (!price) continue;

          // Precio tarjeta
          const priceCard = Math.round(price * CARD_FACTOR);

          // Precio normal
          const oldRaw = $el.find('[class*="original"], [class*="normal"], del, s').first().text().trim();
          const priceNormal = oldRaw ? parsePrice(oldRaw) : null;
          const discount = priceNormal && priceNormal > price
            ? Math.round((1 - price / priceNormal) * 100) : null;

          // Stock
          const stockTxt = $el.text().toLowerCase();
          const stock = /sin stock|agotado|out of stock|no disponible/.test(stockTxt)
            ? 'out_of_stock' : 'in_stock';

          // Imagen
          const imgEl = $el.find('img').first();
          const imageUrl = imgEl.attr('data-src') || imgEl.attr('src') || null;

          // Sub-clasificación
          let sub = cat.sub || null;
          if (!sub) {
            if (cat.catId === 'gpu')     sub = classifyGpu(name);
            if (cat.catId === 'ram')     sub = classifyRam(name);
            if (cat.catId === 'storage') sub = classifyStorage(name);
            if (cat.catId === 'mobo')    sub = classifyMobo(name);
            if (cat.catId === 'case')    sub = classifyCase(name);
            if (cat.catId === 'psu')     sub = classifyPsu(name);
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
                'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
                'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
              },
            },
            { current: price, normal: priceNormal, discount, stock, url: fullUrl }
          );
        } catch (err) {
          this.log('warn', `[spdigital] Error producto: ${err.message}`);
        }
      }

      totalNew += newInPage;
      this.log('info', `[spdigital] ✓ ${cat.catId} pág ${page}: ${newInPage} nuevos`);

      // Verificar si hay página siguiente
      const hasNext = $('a[rel="next"], .pagination .next, [class*="next"]:not([disabled])').length > 0;
      if (!hasNext || newInPage === 0) break;
      page++;
      await this.delay(1500, 2500);
    }

    this.log('info', `[spdigital] ✓ ${cat.url.split('/').slice(-2)[0]}: ${totalNew} total`);
  }
}

if (require.main === module) {
  new SPDigitalScraper().run().then(r => {
    console.log('SP Digital:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = SPDigitalScraper;
