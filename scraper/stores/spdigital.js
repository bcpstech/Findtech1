/**
 * scraper/stores/spdigital.js
 * SP Digital — lee datos desde page-data.json de Next.js/Gatsby
 * Sin proxy, sin HTML scraping — datos completos con specs técnicas
 * Factor tarjeta: incluido en el campo 'other' del pricing
 */

require('dotenv').config();
const BaseScraper = require('../base-scraper');

const BASE        = 'https://www.spdigital.cl';
const PROXY_URL   = process.env.CF_PROXY_URL    || '';
const PROXY_KEY   = process.env.CF_PROXY_SECRET || '';

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

// ── Categorías: path → catId + sub ────────────────────────────────────────
const CATEGORIES = [
  // PROCESADORES
  { path: 'componentes-procesador-procesador-amd',   catId: 'cpu', sub: 'amd'   },
  { path: 'componentes-procesador-procesador-intel', catId: 'cpu', sub: 'intel' },

  // PLACAS MADRE
  { path: 'componentes-placa-madre-placa-amd',   catId: 'mobo', sub: 'am5'    },
  { path: 'componentes-placa-madre-placa-intel', catId: 'mobo', sub: 'lga1700' },

  // MEMORIAS RAM
  { path: 'componentes-memorias-ram-memoria-ram-pc', catId: 'ram' },

  // ALMACENAMIENTO
  { path: 'componentes-almacenamiento-ssd-unidad-estado-solido', catId: 'storage' },
  { path: 'componentes-almacenamiento-hdd-disco-duro-mecanico',  catId: 'storage', sub: 'hdd' },

  // TARJETAS DE VIDEO
  { path: 'componentes-tarjeta-de-video-tarjeta-video-nvidia', catId: 'gpu', sub: 'nvidia' },
  { path: 'componentes-tarjeta-de-video-tarjeta-video-amd',    catId: 'gpu', sub: 'amd'    },
  { path: 'tarjeta-de-video-intel',                            catId: 'gpu', sub: 'intel'  },

  // REFRIGERACIÓN
  { path: 'componentes-refrigeracion-y-ventilacion-disipador-cpu',   catId: 'cooling', sub: 'aire'    },
  { path: 'componentes-refrigeracion-y-ventilacion-refrigeracion-liquida', catId: 'cooling', sub: 'liquida' },
  { path: 'componentes-refrigeracion-y-ventilacion-ventilador-gabinete',   catId: 'cooling', sub: 'fans'    },

  // FUENTES DE PODER
  { path: 'componentes-fuente-de-poder-fuentes-de-poder', catId: 'psu' },

  // GABINETES
  { path: 'componentes-gabinetes-mid-tower--atx',    catId: 'case' },
  { path: 'componentes-gabinetes-micro-atx--mini-itx', catId: 'case' },

  // PCs ARMADOS
  { path: 'gaming-y-streaming-pc-y-notebook-gamer-armados-sp-labs', catId: 'pc' },
];

// ── Clasificadores por nombre (para RAM, Storage, Case, PSU) ──────────────
function classifyRam(name) {
  const n = name.toUpperCase();
  if (/DDR5/.test(n)) return 'ddr5';
  if (/DDR4/.test(n)) return 'ddr4';
  return null;
}

function classifyStorage(name) {
  const n = name.toLowerCase();
  if (/nvme|m\.2|m2|pcie/.test(n)) return 'nvme';
  if (/hdd|disco duro|mecanico/.test(n)) return 'hdd';
  return 'sata';
}

function classifyCase(name) {
  const n = name.toUpperCase();
  if (/E[\s-]?ATX|EXTENDED|EATX|FULL\s*TOWER/.test(n)) return 'eatx';
  if (/MICRO[\s-]?ATX|MATX/.test(n)) return 'matx';
  if (/MINI[\s-]?ITX/.test(n)) return 'itx';
  return 'atx';
}

function classifyPsu(name) {
  const n = name.toLowerCase();
  if (/modular/.test(n)) return 'modular';
  if (/80\s*plus|80\+|gold|platinum|bronze|titanium/.test(n)) return 'certificada';
  return null;
}

function classifyMobo(name) {
  const n = name.toUpperCase();
  if (/AM5/.test(n)) return 'am5';
  if (/AM4/.test(n)) return 'am4';
  if (/LGA\s*1851/.test(n)) return 'lga1851';
  if (/LGA\s*1700/.test(n)) return 'lga1700';
  return null;
}

// ── Extraer specs desde metadata de Icecat ────────────────────────────────
function extractIcecatSpecs(metadata) {
  const specs = {};
  try {
    const specsEntry = metadata.find(m => m.key === 'specs');
    if (!specsEntry) return specs;
    const data = JSON.parse(specsEntry.value);
    if (!data.values || !data.fields) return specs;

    // Índices de columnas
    const nameIdx  = data.fields.indexOf('feature_name');
    const valueIdx = data.fields.indexOf('value');
    const catIdx   = data.fields.indexOf('feature_category_name');
    if (nameIdx < 0 || valueIdx < 0) return specs;

    // Mapeo de nombres Icecat a claves legibles
    const keyMap = {
      'Número de núcleos de procesador': 'Núcleos',
      'Número de hilos de ejecución':    'Hilos',
      'Frecuencia base del procesador':  'Frecuencia base',
      'Frecuencia del procesador turbo': 'Frecuencia turbo',
      'Caché del procesador':            'Caché L3',
      'Potencia de diseño térmico (TDP)':'TDP',
      'Socket de procesador':            'Socket',
      'Litografía del procesador':       'Litografía',
      'Refrigerador incluido':           'Incluye cooler',
      'Modelo de adaptador gráfico incorporado': 'Gráficos integrados',
      'Tipos de memoria que admite el procesador': 'Memoria soportada',
      'Familia de procesador':           'Familia',
      // GPU
      'Memoria de adaptador gráfico':    'VRAM',
      'Tipo de memoria de adaptador gráfico': 'Tipo memoria',
      'Ancho de bus de memoria':         'Bus de memoria',
      // RAM
      'Capacidad de memoria':            'Capacidad',
      'Velocidad de memoria del reloj':  'Velocidad',
      'Tipo de memoria interna':         'Tipo de memoria',
      // Storage
      'Capacidad':                       'Capacidad',
      'Interfaz':                        'Interfaz',
      'Factor de forma':                 'Factor de forma',
      // PSU
      'Potencia':                        'Potencia',
      'Certificación':                   'Certificación',
      'Cableado modular':                'Cableado modular',
      // Mobo
      'Chipset':                         'Chipset',
    };

    for (const row of data.values) {
      const rawName = row[nameIdx];
      const rawVal  = row[valueIdx];
      if (!rawName || !rawVal) continue;

      // Limpiar valor: quitar "Zócalo " de sockets
      let val = String(rawVal).replace(/^Zócalo\s+/i, '').replace(/^Socket\s+/i, '').trim();

      const key = keyMap[rawName];
      if (key && val && !specs[key]) {
        specs[key] = val;
      }
    }
  } catch(e) {}
  return specs;
}

class SPDigitalScraper extends BaseScraper {
  constructor() {
    super('spdigital', 'SP Digital');
    this.seenIds = new Set();
  }

  async scrapeAll() {
    for (const cat of CATEGORIES) {
      try {
        await this.scrapeCategory(cat);
        await this.delay(1500, 2500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[spdigital] Error ${cat.path}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(cat) {
    let page = 1;
    let totalPages = 1;
    let total = 0;

    while (page <= totalPages && page <= 20) {
      const pageDataUrl = page === 1
        ? `${BASE}/page-data/categories/${cat.path}/page-data.json`
        : `${BASE}/page-data/categories/${cat.path}/${page}/page-data.json`;

      this.log('info', `[spdigital] ${cat.catId} ${cat.path} pág ${page}`);

      let data;
      try {
        const res = await this.client.get(proxify(pageDataUrl), {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Referer: BASE + '/',
          },
          timeout: 25000,
        });
        data = res.data;
      } catch (err) {
        this.log('warn', `[spdigital] HTTP error ${pageDataUrl}: ${err.message}`);
        break;
      }

      const ctx = data?.result?.pageContext;
      if (!ctx) {
        this.log('warn', `[spdigital] Sin pageContext en ${cat.path} pág ${page}`);
        break;
      }

      // Actualizar total de páginas
      totalPages = ctx.defaultTotalPages || 1;
      const items = ctx.content?.items || [];

      if (!items.length) {
        this.log('info', `[spdigital] Sin items en ${cat.path} pág ${page}`);
        break;
      }

      let newInPage = 0;
      for (const item of items) {
        try {
          await this.processItem(item, cat);
          newInPage++;
        } catch (err) {
          this.log('warn', `[spdigital] Error item ${item.slug}: ${err.message}`);
        }
      }

      total += newInPage;
      this.log('info', `[spdigital] ✓ ${cat.path} pág ${page}/${totalPages}: ${newInPage} productos`);

      page++;
      if (page <= totalPages) await this.delay(1000, 2000);
    }

    this.log('info', `[spdigital] ✓ ${cat.path}: ${total} total`);
  }

  async processItem(item, cat) {
    if (!item.name || !item.slug) return;

    // Deduplicar
    if (this.seenIds.has(item.id)) return;
    this.seenIds.add(item.id);

    // Precio desde metadata pricing (fuente de verdad)
    let price = null;
    let priceCard = null;
    let priceNormal = null;
    try {
      const pricingMeta = item.metadata?.find(m => m.key === 'pricing');
      if (pricingMeta) {
        const pObj = JSON.parse(pricingMeta.value)['sp-digital'];
        price     = pObj?.cash  ? Math.round(pObj.cash)  : null;
        priceCard = pObj?.other ? Math.round(pObj.other) : null;
      }
    } catch(e) {}

    if (!price || price < 1000) return;
    if (!priceCard) priceCard = Math.round(price * 1.045);

    // Precio normal (antes de descuento) desde priceRange
    try {
      const grossAmt = item.pricing?.priceRange?.start?.gross?.amount;
      if (grossAmt && Math.round(grossAmt) > price) {
        priceNormal = Math.round(grossAmt);
      }
    } catch(e) {}

    // Stock
    const qty = item.defaultVariant?.quantityAvailable ?? 0;
    const stock = qty > 0 ? 'in_stock' : 'out_of_stock';

    // Specs desde Icecat
    const icecatSpecs = extractIcecatSpecs(item.metadata || []);

    // Sub-clasificación
    let sub = cat.sub || null;
    if (!sub) {
      const n = item.name;
      if (cat.catId === 'ram')     sub = classifyRam(n);
      if (cat.catId === 'storage') sub = classifyStorage(n);
      if (cat.catId === 'case')    sub = classifyCase(n);
      if (cat.catId === 'psu')     sub = classifyPsu(n);
      if (cat.catId === 'mobo')    sub = classifyMobo(n);
    }

    // Limpiar nombre
    const name = item.name
      .replace(/\s+/g, ' ')
      .replace(/Ã¡/g, 'á').replace(/Ã©/g, 'é').replace(/Ã­/g, 'í')
      .replace(/Ã³/g, 'ó').replace(/Ãº/g, 'ú').replace(/Ã±/g, 'ñ')
      .replace(/Ã/g, 'Á').trim();

    this.stats.found++;
    await this.saveProductWithR2(
      {
        name,
        category: cat.catId,
        brand: this.extractBrand(name),
        imageUrl: item.thumbnail?.url || null,
        specs: {
          ...icecatSpecs,
          'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
          'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
        },
      },
      {
        current:  price,
        normal:   priceCard || null,   // precio tarjeta en price_normal
        discount: priceNormal ? Math.round((1 - price / priceNormal) * 100) : null,
        stock,
        url: `${BASE}/${item.slug}`,
      }
    );
  }
}

if (require.main === module) {
  new SPDigitalScraper().run().then(r => {
    console.log('SP Digital:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = SPDigitalScraper;
