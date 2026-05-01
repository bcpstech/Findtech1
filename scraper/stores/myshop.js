/**
 * scraper/stores/myshop.js
 * MyShop — API interna POST /servicio/producto
 * Respuesta: data.resultado.items[], data.resultado.productos.count
 * Los precios ya vienen separados: precio (transferencia) y precio_tarjeta
 */
require('dotenv').config();
const BaseScraper = require('../base-scraper');

const BASE = 'https://www.myshop.cl';

// Categorías y sus términos de búsqueda
const SEARCH_QUERIES = [
  // Procesadores
  { q: 'procesador amd ryzen',      catId: 'cpu',     sub: 'amd'     },
  { q: 'procesador intel core',     catId: 'cpu',     sub: 'intel'   },
  // GPU
  { q: 'tarjeta video nvidia rtx',  catId: 'gpu',     sub: 'nvidia'  },
  { q: 'tarjeta video nvidia gtx',  catId: 'gpu',     sub: 'nvidia'  },
  { q: 'tarjeta video amd radeon',  catId: 'gpu',     sub: 'amd'     },
  // RAM
  { q: 'memoria ram ddr5',          catId: 'ram',     sub: 'ddr5'    },
  { q: 'memoria ram ddr4',          catId: 'ram',     sub: 'ddr4'    },
  // Storage
  { q: 'ssd m.2 nvme',              catId: 'storage', sub: 'nvme'    },
  { q: 'ssd sata 2.5',              catId: 'storage', sub: 'sata'    },
  // Cooling
  { q: 'refrigeracion liquida aio', catId: 'cooling', sub: 'liquida' },
  { q: 'disipador cpu cooler',      catId: 'cooling', sub: 'aire'    },
  { q: 'ventilador gabinete argb',  catId: 'cooling', sub: 'fans'    },
  { q: 'pasta disipadora termica',  catId: 'cooling', sub: 'pasta'   },
  // Mobo
  { q: 'placa madre amd am5',       catId: 'mobo',    sub: 'am5'     },
  { q: 'placa madre amd am4',       catId: 'mobo',    sub: 'am4'     },
  { q: 'placa madre intel lga1851', catId: 'mobo',    sub: 'lga1851' },
  { q: 'placa madre intel lga1700', catId: 'mobo',    sub: 'lga1700' },
  // PSU
  { q: 'fuente poder modular gold', catId: 'psu',     sub: 'modular' },
  { q: 'fuente poder 80 plus',      catId: 'psu'                     },
  // Case
  { q: 'gabinete atx torre',        catId: 'case',    sub: 'atx'     },
  { q: 'gabinete micro atx matx',   catId: 'case',    sub: 'matx'    },
  { q: 'gabinete mini itx',         catId: 'case',    sub: 'itx'     },
  // PC
  { q: 'pc gamer escritorio amd',   catId: 'pc'                      },
  { q: 'pc gamer escritorio intel', catId: 'pc'                      },
];

const PAGE_SIZE = 12; // tamaño de página por defecto del sitio

class MyShopScraper extends BaseScraper {
  constructor() {
    super('myshop', 'MyShop');
    this.seenIds = new Set();
  }

  async scrapeAll() {
    for (const query of SEARCH_QUERIES) {
      try {
        await this.scrapeSearch(query);
        await this.delay(2000, 3500);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[myshop] Error búsqueda "${query.q}": ${err.message}`);
      }
    }
  }

  async scrapeSearch(query) {
    let page  = 1;
    let total = 0;

    while (page <= 20) {
      this.log('info', `[myshop] "${query.q}" pág ${page}`);

      let resultado;
      try {
        const res = await this.client.post(
          `${BASE}/servicio/producto`,
          { tipo: '2', page: String(page), texto: query.q },
          {
            headers: {
              'Content-Type':     'application/json',
              'Accept':           'application/json, text/javascript, */*; q=0.01',
              'X-Requested-With': 'XMLHttpRequest',
              'Origin':           BASE,
              'Referer':          `${BASE}/buscar?texto=${encodeURIComponent(query.q)}`,
              'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            timeout: 25000,
          }
        );

        const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;

        // La API devuelve { codigo: 0, resultado: { items: [...], productos: { count } } }
        if (data?.codigo !== 0 || !data?.resultado) {
          this.log('warn', `[myshop] Respuesta inesperada pág ${page}: ${data?.mensaje}`);
          break;
        }
        resultado = data.resultado;
      } catch (err) {
        this.log('warn', `[myshop] HTTP error pág ${page}: ${err.message}`);
        break;
      }

      const items = resultado.items || [];
      if (!items.length) {
        this.log('info', `[myshop] Sin más resultados en pág ${page} para "${query.q}"`);
        break;
      }

      let newInPage = 0;
      for (const item of items) {
        try {
          const id = String(item.id_producto || item.codigo || '');
          if (!id || this.seenIds.has(id)) continue;
          this.seenIds.add(id);

          const name = item.nombre || '';
          if (!name || name.length < 4) continue;

          // Precios vienen como enteros — sin necesidad de parsear
          const price     = item.precio;         // efectivo / transferencia
          const priceCard = item.precio_tarjeta; // tarjeta (ya calculado por MyShop)
          if (!price || price < 1000) continue;

          // Stock — disponibleInternet = puede comprarse online
          const stock = (item.disponibleInternet === true && item.stock_total > 0)
            ? 'in_stock'
            : 'out_of_stock';

          // URL del producto
          const slug       = item.url || '';
          const productUrl = slug.startsWith('http')
            ? slug
            : `${BASE}${slug.startsWith('/') ? '' : '/'}${slug}`;

          // Imagen principal
          const imageUrl = item.foto || item.fotoMini || null;

          // Marca (viene explícita en item.marca)
          const brand = item.marca || this.extractBrand(name);

          this.stats.found++;
          newInPage++;

          await this.saveProductWithR2(
            {
              name,
              category: query.catId,
              brand,
              imageUrl,
              partNumber: item.partno || null,   // Part Number para agrupar con otras tiendas
              specs: {
                'Efectivo / Transferencia': `$${price.toLocaleString('es-CL')}`,
                'Tarjeta crédito/débito':   `$${priceCard.toLocaleString('es-CL')}`,
                'Garantía':                 item.garantia || '',
                'SKU':                      item.codigo   || '',
                'Part Number':              item.partno   || '',
              },
            },
            {
              current:  price,
              normal:   priceCard,
              discount: item.descuento > 0 ? item.descuento : null,
              stock,
              url: productUrl,
            }
          );
        } catch (err) {
          this.log('warn', `[myshop] item error: ${err.message}`);
        }
      }

      total += newInPage;
      this.log('info', `[myshop] ✓ "${query.q}" pág ${page}: ${newInPage} productos`);

      // Paginación exacta usando el total que devuelve la API
      const totalCount = resultado.productos?.count || 0;
      const fetched    = (page - 1) * PAGE_SIZE + items.length;
      if (fetched >= totalCount || items.length < PAGE_SIZE || newInPage === 0) break;

      page++;
      await this.delay(1500, 2500);
    }

    this.log('info', `[myshop] ✓ "${query.q}": ${total} total`);
  }
}

if (require.main === module) {
  new MyShopScraper().run().then(r => {
    console.log('MyShop:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = MyShopScraper;
