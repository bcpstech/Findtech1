/**
 * scraper/stores/bcpstech.js
 * BCPS Tech — WooCommerce REST API
 * Sin proxy, autenticación directa con Consumer Key/Secret
 */
require('dotenv').config();
const BaseScraper = require('../base-scraper');

const BASE        = 'https://bcpstech.cl';
const API_BASE    = `${BASE}/wp-json/wc/v3`;
const CK          = process.env.BCPS_CK || 'ck_93e66e20fbd687bee4b8a87eb8f0e567dd87d7f1';
const CS          = process.env.BCPS_CS || 'cs_da4e271a4031949fd967cb90d3078a15d07420ed';
const CARD_FACTOR = 1.03;

// ── Categorías WooCommerce → FindTech ─────────────────────────────────────
// Obtener IDs reales: GET /wp-json/wc/v3/products/categories?per_page=100
const CATEGORY_MAP = {
  // slug de WooCommerce → { catId, sub }
  'procesadores-amd':          { catId: 'cpu',     sub: 'amd'      },
  'procesadores-intel':        { catId: 'cpu',     sub: 'intel'    },
  'tarjetas-de-video-nvidia':  { catId: 'gpu',     sub: 'nvidia'   },
  'tarjetas-de-video-amd':     { catId: 'gpu',     sub: 'amd'      },
  'placas-madre-am5':          { catId: 'mobo',    sub: 'am5'      },
  'placas-madre-am4':          { catId: 'mobo',    sub: 'am4'      },
  'placas-madre-lga1700':      { catId: 'mobo',    sub: 'lga1700'  },
  'placas-madre-lga1851':      { catId: 'mobo',    sub: 'lga1851'  },
  'memorias-ddr5':             { catId: 'ram',     sub: 'ddr5'     },
  'memorias-ddr4':             { catId: 'ram',     sub: 'ddr4'     },
  'discos-ssd':                { catId: 'storage', sub: 'nvme'     },
  'discos-duro':               { catId: 'storage', sub: 'hdd'      },
  'refrigeracion-liquida':     { catId: 'cooling', sub: 'liquida'  },
  'refrigeracion-por-aire':    { catId: 'cooling', sub: 'aire'     },
  'ventiladores-fans':         { catId: 'cooling', sub: 'fans'     },
  'fuentes-modulares':         { catId: 'psu',     sub: 'modular'  },
  'fuentes-certificadas':      { catId: 'psu',     sub: 'certificada' },
  'gabinetes-atx':             { catId: 'case',    sub: 'atx'      },
  'gabinetes-micro-atx':       { catId: 'case',    sub: 'matx'     },
  'gabinetes-mini-itx':        { catId: 'case',    sub: 'itx'      },
  'gabinetes-extended-atx':    { catId: 'case',    sub: 'eatx'     },
};

class BcpsTechScraper extends BaseScraper {
  constructor() {
    super('bcpstech', 'BCPS Tech');
    this.seenIds = new Set();
  }

  // Llamada autenticada a la API WooCommerce
  async apiGet(endpoint, params = {}) {
    const url = new URL(`${API_BASE}${endpoint}`);
    url.searchParams.set('consumer_key',    CK);
    url.searchParams.set('consumer_secret', CS);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await this.client.get(url.toString(), {
      headers: {
        'Accept':       'application/json',
        'User-Agent':   'FindTech-Scraper/1.0',
      },
      timeout: 30000,
    });
    return res;
  }

  async scrapeAll() {
    // 1. Obtener todas las categorías del sitio
    this.log('info', '[bcpstech] Obteniendo categorías...');
    let categories = [];
    try {
      const res = await this.apiGet('/products/categories', { per_page: 100, hide_empty: true });
      categories = res.data;
      this.log('info', `[bcpstech] ${categories.length} categorías encontradas`);
    } catch (err) {
      this.log('warn', `[bcpstech] Error obteniendo categorías: ${err.message}`);
      return;
    }

    // 2. Filtrar solo las categorías que mapeamos
    const targetCats = categories.filter(c => CATEGORY_MAP[c.slug]);
    this.log('info', `[bcpstech] ${targetCats.length} categorías a scrapear`);

    // 3. Scrapear productos por categoría
    for (const cat of targetCats) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(1000, 2000);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[bcpstech] Error ${cat.slug}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(wcat) {
    const mapping = CATEGORY_MAP[wcat.slug];
    let page  = 1;
    let total = 0;

    while (page <= 20) {
      this.log('info', `[bcpstech] ${mapping.catId}/${mapping.sub} (${wcat.slug}) pág ${page}`);

      let products;
      try {
        const res = await this.apiGet('/products', {
          category: wcat.id,
          per_page: 100,
          page,
          status:   'publish',
          orderby:  'date',
          order:    'desc',
        });
        products = res.data;
      } catch (err) {
        this.log('warn', `[bcpstech] API error ${wcat.slug} pág ${page}: ${err.message}`);
        break;
      }

      if (!Array.isArray(products) || !products.length) break;

      for (const p of products) {
        try {
          await this.processProduct(p, mapping);
        } catch (err) {
          this.log('warn', `[bcpstech] Error producto ${p.id}: ${err.message}`);
        }
      }

      total += products.length;
      this.log('info', `[bcpstech] ✓ ${wcat.slug} pág ${page}: ${products.length}`);

      if (products.length < 100) break;
      page++;
      await this.delay(500, 1000);
    }

    this.log('info', `[bcpstech] ✓ ${wcat.slug}: ${total} total`);
  }

  async processProduct(p, mapping) {
    if (this.seenIds.has(p.id)) return;
    this.seenIds.add(p.id);

    const name = p.name?.trim();
    if (!name) return;

    // Precio — WooCommerce devuelve como string
    const price = parseInt(p.price) || parseInt(p.regular_price) || 0;
    if (!price || price < 1000) return;

    const regularPrice = parseInt(p.regular_price) || 0;
    const salePrice    = parseInt(p.sale_price)    || 0;
    const priceNormal  = salePrice && regularPrice > salePrice ? regularPrice : null;
    const discount     = priceNormal
      ? Math.round((1 - price / priceNormal) * 100) : null;
    const priceCard    = Math.round(price * CARD_FACTOR);

    // Stock
    const stock = p.stock_status === 'instock' ? 'in_stock' : 'out_of_stock';

    // Imagen
    const imageUrl = p.images?.[0]?.src || null;

    // Specs desde atributos WooCommerce
    const specs = {};
    if (p.attributes?.length) {
      for (const attr of p.attributes) {
        const key = attr.name;
        const val = attr.options?.join(', ') || '';
        if (key && val && key.length < 60 && val.length < 120) {
          specs[key] = val;
        }
      }
    }
    specs['Efectivo/Transferencia'] = `$${price.toLocaleString('es-CL')}`;
    specs['Tarjeta crédito/débito'] = `$${priceCard.toLocaleString('es-CL')}`;

    // SKU como partNumber para deduplicación entre tiendas
    const partNumber = p.sku || null;

    this.stats.found++;
    await this.saveProductWithR2(
      {
        name,
        category:    mapping.catId,
        brand:       this.extractBrand(name),
        imageUrl,
        specs,
        partNumber,
      },
      {
        current:  price,
        card:     priceCard,
        normal:   priceNormal,
        discount,
        stock,
        url: `${BASE}/?p=${p.id}`,
      }
    );
  }
}

if (require.main === module) {
  new BcpsTechScraper().run().then(r => {
    console.log('BCPS Tech:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = BcpsTechScraper;
