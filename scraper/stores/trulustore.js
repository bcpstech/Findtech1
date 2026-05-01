/**
 * scraper/stores/trulustore.js
 * TruluStore — WooCommerce scraping por categorías exactas
 *
 * Precios:
 * - Efectivo/Transferencia/Depósito (precio base)
 * - Khipu (× 1.02)
 * - Tarjeta crédito/débito (× 1.05)
 *
 * Reglas:
 * - Gabinetes: solo URLs específicas (no toda la categoría)
 * - Fuentes: solo URLs específicas
 * - Procesadores AMD activos, Intel vacío pero se mantiene para el futuro
 * - No publicar out_of_stock
 */

require('dotenv').config();
const cheerio = require('cheerio');
const BaseScraper = require('../base-scraper');

const BASE          = 'https://trulustore.cl';
const FACTOR_KHIPU  = 1.02;
const FACTOR_CARD   = 1.05;
const PROXY_URL     = process.env.CF_PROXY_URL    || '';
const PROXY_KEY     = process.env.CF_PROXY_SECRET || '';

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

// ── Categorías por URL ─────────────────────────────────────────────────────
const CATEGORY_URLS = [
  // PCs Armados
  { url: '/categoria-producto/pc-gamer/', catId: 'pc' },

  // Procesadores
  { url: '/categoria-producto/componentes-pc/procesadores/amd-procesadores/', catId: 'cpu', sub: 'amd'   },
  { url: '/categoria-producto/componentes-pc/procesadores/intel-procesadores/', catId: 'cpu', sub: 'intel' },

  // Placas Madre
  { url: '/categoria-producto/componentes-pc/placas-madre/amd/am5-amd/',   catId: 'mobo', sub: 'am5'    },
  { url: '/categoria-producto/componentes-pc/placas-madre/amd/am4-amd/',   catId: 'mobo', sub: 'am4'    },
  { url: '/categoria-producto/componentes-pc/placas-madre/intel/lga-1700/', catId: 'mobo', sub: 'lga1700' },
  { url: '/categoria-producto/componentes-pc/placas-madre/intel/lga-1851/', catId: 'mobo', sub: 'lga1851' },

  // Memorias RAM
  { url: '/categoria-producto/componentes-pc/memoria-ram/ddr4/', catId: 'ram', sub: 'ddr4' },
  { url: '/categoria-producto/componentes-pc/memoria-ram/ddr5/', catId: 'ram', sub: 'ddr5' },

  // Refrigeración
  { url: '/categoria-producto/componentes-pc/refrigeracion/refrigeracion-aire/',    catId: 'cooling', sub: 'aire'    },
  { url: '/categoria-producto/componentes-pc/refrigeracion/refrigeracion-liquida/', catId: 'cooling', sub: 'liquida' },
  { url: '/categoria-producto/componentes-pc/refrigeracion/ventiladores/',          catId: 'cooling', sub: 'fans'    },
  { url: '/categoria-producto/componentes-pc/refrigeracion/pastas-disipadora/',     catId: 'cooling', sub: 'pasta'   },

  // Almacenamiento
  { url: '/categoria-producto/componentes-pc/almacenamiento/disco-ssd-2-5/',  catId: 'storage', sub: 'sata' },
  { url: '/categoria-producto/componentes-pc/almacenamiento/disco-ssd-m-2/',  catId: 'storage' },

  // Tarjetas de Video
  { url: '/categoria-producto/componentes-pc/tarjetas-de-video/nvidia/',  catId: 'gpu', sub: 'nvidia' },
  { url: '/categoria-producto/componentes-pc/tarjetas-de-video/radeon/',  catId: 'gpu', sub: 'amd'    },
];

// ── Productos específicos (gabinetes y fuentes) ────────────────────────────
const SPECIFIC_PRODUCTS = [
  // Gabinetes
  { url: '/producto/gabinete-tipo-pecera-esgaming-gilgamesh-6-ventiladores-argb-controladora/', catId: 'case' },
  { url: '/producto/gabinete-tipo-pecera-esgaming-h60-5-ventiladores-argb-controladora/',       catId: 'case' },
  { url: '/producto/gabinete-tipo-pecera-esgaming-zero-6-ventiladores-argb-controladora/',      catId: 'case' },
  { url: '/producto/gabinete-tipo-pecera-esgaming-zero-max-7-ventiladores-argb-controladora/',  catId: 'case' },
  // Fuentes de poder
  { url: '/producto/fuente-de-poder-asus-prime-850g-de-850w-80-gold-full-modular-atx-3-1/',                                                catId: 'psu' },
  { url: '/producto/fuente-de-poder-asus-rog-strix-1000p-de-1000w-80-platinum-full-modular-atx-3-1/',                                       catId: 'psu' },
  { url: '/producto/fuente-de-poder-asus-rog-thor-1200-platinum-iii-de-1200w-80-platinum-full-modular-atx-3-1-pantalla-oled-aura-sync/',    catId: 'psu' },
  { url: '/producto/fuente-de-poder-gigabyte-p650g-de-650w-80-gold/',                                                                       catId: 'psu' },
  { url: '/producto/fuente-de-poder-asus-tuf-gaming-850g-de-850w-80-gold-full-modular-atx-3-1/',                                            catId: 'psu' },
  { url: '/producto/fuente-de-poder-asus-tuf-gaming-750g-de-750w-80-gold-full-modular-atx-3-1/',                                            catId: 'psu' },
  { url: '/producto/fuente-de-poder-asus-tuf-gaming-1000g-de-1000w-80-gold-full-modular-atx-3-1/',                                          catId: 'psu' },
  { url: '/producto/fuente-de-poder-gigabyte-p650ss-ice-de-650w-80-silver-atx-3-0/',                                                        catId: 'psu' },
  { url: '/producto/fuente-de-poder-gigabyte-ud750gm-pg5-full-modular-80-gold-pcie-5-0-de-750w/',                                           catId: 'psu' },
  { url: '/producto/fuente-de-poder-msi-mag-a1000gls-1000w-80-gold-cybenetics-gold-full-modular-pcie-5-1-atx-3-1/',                         catId: 'psu' },
  { url: '/producto/fuente-de-poder-msi-mag-a850gl-white-850w-80-gold-cybenetics-gold-full-modular-pcie-5-1-atx-3-1/',                      catId: 'psu' },
];

// ── Selectores WooCommerce ────────────────────────────────────────────────
const SEL = {
  products:    'ul.products li.product, .products .product',
  name:        '.woocommerce-loop-product__title, h2.woocommerce-loop-product__title',
  price:       '.price ins .amount, .price > .amount, .price .woocommerce-Price-amount',
  priceOld:    '.price del .amount',
  link:        'a.woocommerce-loop-product__link, .woocommerce-LoopProduct-link',
  img:         'img.attachment-woocommerce_thumbnail, img.wp-post-image',
  outOfStock:  '.out-of-stock, .product .stock.out-of-stock',
  nextPage:    'a.next.page-numbers',
  // Detalle producto
  detailName:  'h1.product_title, .product_title',
  detailPrice: '.price ins .amount, .price > .woocommerce-Price-amount',
  detailOld:   '.price del .amount',
  detailStock: '.stock',
  detailImg:   '.woocommerce-product-gallery__image img',
};

function parsePrice(raw) {
  if (!raw) return null;
  const n = parseInt(String(raw).replace(/[^\d]/g, ''));
  return (!n || n < 1000 || n > 200000000) ? null : n;
}

function classifyStorage(name) {
  const n = name.toLowerCase();
  if (/nvme|m\.2|pcie/.test(n)) return 'nvme';
  if (/sata|2\.5/.test(n))      return 'sata';
  return 'nvme';
}

function classifyCase(name) {
  const n = name.toUpperCase();
  if (/ACCESORIO|SOPORTE|BRACKET|PANEL|FILTRO|RISER|CONTROLADORA|HUB/.test(n)) return 'accesorio';
  if (/E[\s-]?ATX|EXTENDED|EATX|FULL\s*TOWER/.test(n)) return 'eatx';
  if (/MICRO[\s-]?ATX|MATX/.test(n))                   return 'matx';
  if (/MINI[\s-]?ITX/.test(n))                          return 'itx';
  return 'atx';
}

function classifyPsu(name) {
  const n = name.toLowerCase();
  if (/modular/.test(n)) return 'modular';
  if (/80\s*plus|80\+|gold|platinum|bronze|titanium/.test(n)) return 'certificada';
  return null;
}

class TruluStoreScraper extends BaseScraper {
  constructor() {
    super('trulustore', 'TruluStore');
    this.seenUrls = new Set();
  }

  async scrapeAll() {
    // 1. Categorías
    for (const cat of CATEGORY_URLS) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[trulu] Error categoría ${cat.url}: ${err.message}`);
      }
    }

    // 2. Productos específicos
    for (const prod of SPECIFIC_PRODUCTS) {
      try {
        await this.scrapeProductPage(prod);
        await this.delay(1500, 2500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[trulu] Error producto ${prod.url}: ${err.message}`);
      }
    }
  }

  async fetchPage(url) {
    const res = await this.client.get(proxify(url), {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-CL,es;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        Referer: BASE + '/',
      },
      timeout: 25000,
    });
    return cheerio.load(res.data);
  }

  // ── Scrapear categoría paginada ──────────────────────────────────────────
  async scrapeCategory(cat) {
    let page = 1;
    let total = 0;

    while (page <= 20) {
      const pageUrl = page === 1
        ? `${BASE}${cat.url}`
        : `${BASE}${cat.url}page/${page}/`;

      this.log('info', `[trulu] ${cat.catId}${cat.sub ? '/'+cat.sub : ''} pág ${page}`);

      let $;
      try {
        $ = await this.fetchPage(pageUrl);
      } catch (err) {
        this.log('warn', `[trulu] HTTP error ${pageUrl}: ${err.message}`);
        break;
      }

      const items = $(SEL.products);
      if (!items.length) {
        this.log('info', `[trulu] Sin productos en pág ${page}`);
        break;
      }

      let newInPage = 0;
      for (const el of items.toArray()) {
        const $el = $(el);
        try {
          const productUrl = $el.find(SEL.link).first().attr('href') || '';
          if (!productUrl || this.seenUrls.has(productUrl)) continue;
          this.seenUrls.add(productUrl);

          const name = $el.find(SEL.name).first().text().trim();
          if (!name) continue;

          // Precio base (efectivo)
          const priceRaw = $el.find(SEL.price).first().text().trim();
          const price = parsePrice(priceRaw);
          if (!price) {
            this.log('warn', `[trulu] Sin precio: ${name.slice(0, 50)}`);
            continue;
          }

          const priceOldRaw = $el.find(SEL.priceOld).first().text().trim();
          const priceNormal = priceOldRaw ? parsePrice(priceOldRaw) : null;
          const discount = priceNormal && priceNormal > price
            ? Math.round((1 - price / priceNormal) * 100) : null;

          const khipu = Math.round(price * FACTOR_KHIPU);

          // Stock
          const stock = $el.find(SEL.outOfStock).length ? 'out_of_stock' : 'in_stock';

          const imgEl = $el.find(SEL.img).first();
          const imageUrl = imgEl.attr('data-src') || imgEl.attr('src') || null;

          // Sub-clasificación
          let sub = cat.sub || null;
          if (!sub) {
            if (cat.catId === 'storage') sub = classifyStorage(name);
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
                'Efectivo / Transferencia': `$${price.toLocaleString('es-CL')}`,
                'Khipu':                   `$${khipu.toLocaleString('es-CL')}`,
              },
            },
            {
              current:  price,
              normal:   priceNormal && priceNormal > price ? priceNormal : null,
              discount,
              stock,
              url: productUrl,
            }
          );
        } catch (err) {
          this.log('warn', `[trulu] Error item: ${err.message}`);
        }
      }

      total += newInPage;
      this.log('info', `[trulu] ✓ pág ${page}: ${newInPage} productos`);

      const hasNext = $(SEL.nextPage).length > 0;
      if (!hasNext || newInPage === 0) break;
      page++;
      await this.delay(1500, 2500);
    }

    this.log('info', `[trulu] ✓ ${cat.url}: ${total} total`);
  }

  // ── Scrapear producto individual ─────────────────────────────────────────
  async scrapeProductPage(prod) {
    const fullUrl = `${BASE}${prod.url}`;
    if (this.seenUrls.has(fullUrl)) return;
    this.seenUrls.add(fullUrl);

    this.log('info', `[trulu] producto ${prod.url}`);

    let $;
    try {
      $ = await this.fetchPage(fullUrl);
    } catch (err) {
      this.log('warn', `[trulu] HTTP error ${fullUrl}: ${err.message}`);
      return;
    }

    const name = $(SEL.detailName).first().text().trim();
    if (!name) return;

    // Precio — en página de detalle WooCommerce
    const priceRaw = $('.price ins .amount, .price > .woocommerce-Price-amount').first().text().trim();
    const price = parsePrice(priceRaw);
    if (!price) {
      this.log('warn', `[trulu] Sin precio en: ${name.slice(0, 50)}`);
      return;
    }

    const priceOldRaw = $('.price del .amount').first().text().trim();
    const priceNormal = priceOldRaw ? parsePrice(priceOldRaw) : null;
    const discount = priceNormal && priceNormal > price
      ? Math.round((1 - price / priceNormal) * 100) : null;

    const khipu = Math.round(price * FACTOR_KHIPU);

    // Stock
    const stockTxt = $('.stock').text().toLowerCase();
    const stock = /agotado|out.of.stock|sin stock/.test(stockTxt) ? 'out_of_stock' : 'in_stock';

    // Imagen
    const imgEl = $('.woocommerce-product-gallery__image img').first();
    const imageUrl = imgEl.attr('data-large_image') || imgEl.attr('src') || null;

    // Sub por categoría
    let sub = null;
    if (prod.catId === 'case') sub = classifyCase(name);
    if (prod.catId === 'psu')  sub = classifyPsu(name);

    this.stats.found++;
    await this.saveProductWithR2(
      {
        name,
        category: prod.catId,
        brand: this.extractBrand(name),
        imageUrl,
        specs: {
          'Efectivo / Transferencia': `$${price.toLocaleString('es-CL')}`,
          'Khipu':                   `$${khipu.toLocaleString('es-CL')}`,
        },
      },
      {
        current:  price,
        normal:   priceNormal && priceNormal > price ? priceNormal : null,
        discount,
        stock,
        url: fullUrl,
      }
    );
  }
}

if (require.main === module) {
  new TruluStoreScraper().run().then(r => {
    console.log('TruluStore:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = TruluStoreScraper;
