/**
 * scraper/stores/centralgamer.js
 * CentralGamer — WooCommerce scraping por categorías exactas
 *
 * Reglas especiales:
 * - GPU: solo NVIDIA (no tienen AMD)
 * - CPU: separar Intel/AMD por nombre
 * - Mobo: separar por socket (AM4, AM5, LGA1700, LGA1851)
 * - Storage: separar por formato (NVMe, SATA, HDD, externo, pendrive)
 * - RAM: separar DDR4/DDR5
 * - Cooling: publicar SOLO si título contiene "líquida", "watercooling", "AIO"
 * - Gabinetes: publicar SOLO si título contiene "gabinete" (excluir accesorios)
 * - PSU: separar modular/no-modular certificada
 * - PC: categoría 'pc' para PCs armados
 */

require('dotenv').config();
const cheerio = require('cheerio');
const BaseScraper = require('../base-scraper');

const BASE        = 'https://centralgamer.cl';
const API_BASE    = 'https://centralgamer.cl/wp-json/wc/store/v1/products';
const CARD_FACTOR = 1.0526;

// ── Categorías WooCommerce ─────────────────────────────────────────────────
const CATEGORIES = [
  // PCs Armados
  { slug: 'pc-starter',        catId: 'pc' },
  { slug: 'pc-medium',         catId: 'pc' },
  { slug: 'pc-high',           catId: 'pc' },
  { slug: 'pc-premium',        catId: 'pc' },
  { slug: 'pc-entrega-inmediata', catId: 'pc' },

  // Componentes
  { slug: 'tarjetas-de-video', catId: 'gpu'     },
  { slug: 'procesadores',      catId: 'cpu'     },
  { slug: 'placas-madre',      catId: 'mobo'    },
  { slug: 'almacenamiento',    catId: 'storage' },
  { slug: 'memorias-ram',      catId: 'ram'     },
  { slug: 'refrigeracion-pc',  catId: 'cooling' },
  { slug: 'gabinetes-gamer',   catId: 'case'    },
  { slug: 'fuentes-de-poder',  catId: 'psu'     },
];

// ── Clasificadores por nombre ──────────────────────────────────────────────
function classifyCpu(name) {
  const n = name.toLowerCase();
  if (/ryzen|threadripper|athlon/.test(n)) return 'amd';
  if (/intel|core\s+i[3579]|core\s+ultra|celeron|pentium|xeon/.test(n)) return 'intel';
  return null;
}

function classifyMobo(name) {
  const n = name.toUpperCase();
  if (/AM5|SOCKET\s*AM5/.test(n)) return 'am5';
  if (/AM4|SOCKET\s*AM4/.test(n)) return 'am4';
  if (/LGA\s*1851|LGA1851/.test(n)) return 'lga1851';
  if (/LGA\s*1700|LGA1700/.test(n)) return 'lga1700';
  if (/LGA\s*1200|LGA1200/.test(n)) return 'lga1200';
  return null;
}

function classifyStorage(name) {
  const n = name.toLowerCase();
  if (/pendrive|usb flash|flash drive|memoria usb/.test(n)) return 'pendrive';
  if (/externo|externa|portable|external/.test(n)) {
    if (/ssd/.test(n)) return 'ssdext';
    return 'hddext';
  }
  if (/nvme|m\.2|pcie/.test(n)) return 'nvme';
  if (/hdd|disco duro|hard drive|3\.5/.test(n)) return 'hdd';
  if (/sata|2\.5/.test(n)) return 'sata';
  return 'nvme'; // default para SSD sin especificar
}

function classifyRam(name) {
  const n = name.toLowerCase();
  if (/ddr5/.test(n)) return 'ddr5';
  if (/ddr4/.test(n)) return 'ddr4';
  return null;
}

function classifyPsu(name) {
  const n = name.toLowerCase();
  const modular = /\bmodular\b/.test(n);
  const certified = /80\s*plus|80\+|gold|platinum|bronze|titanium|white/.test(n);
  if (modular && certified) return 'modular';
  if (certified) return 'certificada';
  return null;
}

function classifyCase(name) {
  const n = name.toUpperCase();
  if (/E[\s-]?ATX|EXTENDED[\s-]?ATX|EATX|FULL\s*TOWER/.test(n)) return 'eatx';
  if (/MICRO[\s-]?ATX|MATX|M[\s-]?ATX|MID\s*TOWER/.test(n)) return 'matx';
  if (/MINI[\s-]?ITX|MINI\s*ITX/.test(n)) return 'itx';
  if (/\bATX\b/.test(n)) return 'atx';
  return null;
}

// ── Filtros de publicación ────────────────────────────────────────────────
function shouldPublish(name, catId) {
  const n = name.toLowerCase();
  if (catId === 'cooling') {
    // Solo refrigeración líquida/watercooling
    return /líquid|liquid|watercool|water cool|aio|refrigeración líquid|refrigeracion liquid/.test(n);
  }
  if (catId === 'case') {
    // Solo gabinetes, no accesorios
    return /gabinete|case|torre|chasis/.test(n);
  }
  return true;
}

function parsePrice(raw) {
  if (!raw) return null;
  let n = parseInt(String(raw).replace(/[^\d]/g, ''));
  if (!n || n < 1000 || n > 50000000000) return null;
  // WooCommerce Store API devuelve precios en centavos (×100)
  if (n > 100000000) n = Math.round(n / 100);
  return n;
}

class CentralGamerScraper extends BaseScraper {
  constructor() {
    super('cg', 'CentralGamer');
  }

  async scrapeAll() {
    // Intentar API WooCommerce primero
    const apiWorks = await this.testApi();
    this.log('info', `[cg] Modo: ${apiWorks ? 'WooCommerce API' : 'HTML scraping'}`);

    for (const cat of CATEGORIES) {
      try {
        if (apiWorks) {
          await this.scrapeCategoryApi(cat);
        } else {
          await this.scrapeCategoryHtml(cat);
        }
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[cg] Error ${cat.slug}: ${err.message}`);
      }
    }
  }

  async testApi() {
    try {
      const res = await this.client.get(`${API_BASE}?category=procesadores&per_page=1`, {
        headers: { Accept: 'application/json' }, timeout: 8000,
      });
      return Array.isArray(res.data) && res.data.length > 0;
    } catch { return false; }
  }

  async scrapeCategoryApi(cat) {
    let page = 1;
    let total = 0;

    while (page <= 30) {
      this.log('info', `[cg] API ${cat.catId}/${cat.slug} pág ${page}`);
      const url = `${API_BASE}?category=${cat.slug}&per_page=100&page=${page}`;

      let products;
      try {
        const res = await this.client.get(url, {
          headers: { Accept: 'application/json' }, timeout: 20000,
        });
        products = res.data;
      } catch (err) {
        this.log('warn', `[cg] API error ${cat.slug} pág ${page}: ${err.message}`);
        break;
      }

      if (!Array.isArray(products) || !products.length) break;

      for (const p of products) {
        await this.processApiProduct(p, cat);
      }

      total += products.length;
      if (products.length < 100) break;
      page++;
      await this.delay(1000, 2000);
    }

    this.log('info', `[cg] ✓ ${cat.slug}: ${total} productos`);
  }

  async processApiProduct(p, cat) {
    const name = p.name || '';
    if (!name) return;

    // Filtro de publicación
    if (!shouldPublish(name, cat.catId)) return;

    // Precio
    const price = parsePrice(p.prices?.price);
    if (!price) return;

    const priceNormalRaw = parsePrice(p.prices?.regular_price);
    // price = efectivo/transferencia (precio con descuento)
    // priceNormalRaw = precio sin descuento (tachado)
    const priceNormal = priceNormalRaw && priceNormalRaw > price ? priceNormalRaw : null;
    const priceCard   = Math.round(price * CARD_FACTOR);
    const discount    = priceNormal
      ? Math.round((1 - price / priceNormal) * 100) : null;

    // Sub-clasificación según categoría
    let subData = {};
    if (cat.catId === 'cpu') {
      const sub = classifyCpu(name);
      if (!sub) return; // descartar si no se puede clasificar
      subData = { sub };
    } else if (cat.catId === 'mobo') {
      const sub = classifyMobo(name);
      subData = { sub };
    } else if (cat.catId === 'storage') {
      subData = { sub: classifyStorage(name) };
    } else if (cat.catId === 'ram') {
      const sub = classifyRam(name);
      subData = { sub };
    } else if (cat.catId === 'psu') {
      subData = { sub: classifyPsu(name) };
    } else if (cat.catId === 'case') {
      subData = { sub: classifyCase(name) };
    } else if (cat.catId === 'gpu') {
      // Solo NVIDIA
      if (!/nvidia|geforce|rtx|gtx/i.test(name)) return;
      subData = { sub: 'nvidia' };
    }

    // Specs: primero desde API, luego enriquecer desde página del producto
    const apiSpecs = this.extractWooSpecs(p);
    const brand = p.brands?.[0]?.name || this.extractBrand(name);
    const productUrl = p.permalink || null;

    // Visitar la página del producto para obtener specs completas
    let pageSpecs = {};
    if (productUrl && Object.keys(apiSpecs).length === 0) {
      try {
        pageSpecs = await this.fetchProductSpecs(productUrl, null);
      } catch(e) {}
    }

    const allSpecs = {
      ...pageSpecs,
      ...apiSpecs,
      'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
      'Webpay / Tarjeta':       `$${priceCard.toLocaleString('es-CL')}`,
    };

    this.stats.found++;
    await this.saveProductWithR2(
      {
        name,
        category: cat.catId,
        brand,
        imageUrl: p.images?.[0]?.src || null,
        specs: allSpecs,
      },
      {
      current:  price,        // efectivo/transferencia
      normal:   priceNormal,  // precio tachado (sin descuento)
      discount,
      stock: p.is_in_stock ? 'in_stock' : 'out_of_stock',
      url: productUrl,
      }
    );
  }

  async scrapeCategoryHtml(cat) {
    // Construir URL desde slug
    const catUrls = {
      'pc-starter':           '/pc-gamer/pc-starter/',
      'pc-medium':            '/pc-gamer/pc-medium/',
      'pc-high':              '/pc-gamer/pc-high/',
      'pc-premium':           '/pc-gamer/pc-premium/',
      'pc-entrega-inmediata': '/pc-gamer/pc-entrega-inmediata/',
      'tarjetas-de-video':    '/componentes-pc/tarjetas-de-video/',
      'procesadores':         '/componentes-pc/procesadores/',
      'placas-madre':         '/componentes-pc/placas-madre/',
      'almacenamiento':       '/componentes-pc/almacenamiento/',
      'memorias-ram':         '/componentes-pc/memorias-ram/',
      'refrigeracion-pc':     '/componentes-pc/refrigeracion-pc/',
      'gabinetes-gamer':      '/componentes-pc/gabinetes-gamer/',
      'fuentes-de-poder':     '/componentes-pc/fuentes-de-poder/',
    };

    const path = catUrls[cat.slug];
    if (!path) return;

    let page = 1;
    while (page <= 30) {
      const pageUrl = `${BASE}${path}${page > 1 ? `page/${page}/` : ''}`;
      this.log('info', `[cg] HTML ${cat.catId}/${cat.slug} pág ${page}`);

      let $;
      try {
        const res = await this.client.get(pageUrl, {
          headers: {
            Accept: 'text/html',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
          },
          timeout: 20000,
        });
        $ = cheerio.load(res.data);
      } catch (err) {
        this.log('warn', `[cg] HTML error ${pageUrl}: ${err.message}`);
        break;
      }

      const items = $('ul.products li.product, .products .product');
      if (!items.length) break;

      let newInPage = 0;
      for (const el of items.toArray()) {
        try {
          const $el = $(el);
          const name = $el.find('.woocommerce-loop-product__title, h2').first().text().trim();
          if (!name || !shouldPublish(name, cat.catId)) continue;

          const priceRaw = $el.find('.price ins .amount, .price .amount').first().text()
                        || $el.find('.price').first().text();
          const price = parsePrice(priceRaw);
          if (!price) continue;

          const priceCard = Math.round(price * CARD_FACTOR);
          const productUrl = $el.find('a').first().attr('href') || '';
          const imageUrl   = $el.find('img').first().attr('src') || null;
          const stock = $el.find('.out-of-stock, .product-unavailable').length
            ? 'out_of_stock' : 'in_stock';

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
                'Webpay / Tarjeta':       `$${priceCard.toLocaleString('es-CL')}`,
              },
            },
            { current: price, normal: null, discount: null, stock, url: productUrl }
          );
        } catch (err) {
          this.log('warn', `[cg] Error producto HTML: ${err.message}`);
        }
      }

      this.log('info', `[cg] ✓ ${cat.slug} pág ${page}: ${newInPage}`);
      if (!$('a.next, li.next a').length || newInPage === 0) break;
      page++;
      await this.delay(1500, 2500);
    }
  }
}

if (require.main === module) {
  new CentralGamerScraper().run().then(r => {
    console.log('CentralGamer:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = CentralGamerScraper;
