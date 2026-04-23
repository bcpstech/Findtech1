/**
 * scraper/stores/solotodo.js
 * Obtiene precios reales usando la API pública de SoloTodo.cl
 * No requiere Puppeteer ni scraping HTML — usa JSON directamente
 * Documentación: https://www.solotodo.cl/api/
 */
const BaseScraper = require('../base-scraper');

// IDs de tiendas en SoloTodo que corresponden a las nuestras
// Estos IDs se obtienen de: https://www.solotodo.cl/api/stores/?format=json
const STORE_IDS = {
  n1g:        14,   // N1G
  alltec:     6,    // Alltec
  cg:         43,   // CentralGamer
  centrale:   29,   // Centrale
  pcexpress:  17,   // PC-Express
};

// IDs de categorías en SoloTodo
// https://www.solotodo.cl/api/categories/?format=json
const CATEGORY_IDS = {
  gpu:     2,   // Tarjetas de video
  cpu:     3,   // Procesadores
  ram:     5,   // Memorias RAM
  storage: 7,   // Almacenamiento
  cooling: 11,  // Refrigeración
  mobo:    4,   // Placas madre
  psu:     8,   // Fuentes de poder
  case:    9,   // Gabinetes
  monitor: 10,  // Monitores
  periph:  12,  // Periféricos
};

class SoloTodoScraper extends BaseScraper {
  constructor() { super('solotodo', 'SoloTodo API'); }

  async scrapeAll() {
    // Obtener todas las categorías
    for (const [catId, soloTodoCatId] of Object.entries(CATEGORY_IDS)) {
      try {
        await this.scrapeCategory(catId, soloTodoCatId);
        await this.delay(1000, 2000);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error en ${catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(catId, soloTodoCatId) {
    let page = 1;
    let hasMore = true;
    const PAGE_SIZE = 100;

    while (hasMore && page <= 10) {
      const url = `https://www.solotodo.cl/api/products/?category=${soloTodoCatId}&page_size=${PAGE_SIZE}&page=${page}&format=json`;
      this.log('info', `Categoría ${catId} pág ${page}`);

      const $ = await this.fetchPage(url);
      if (!$) { this.stats.errors++; break; }

      // La API devuelve JSON — lo parseamos del texto
      let data;
      try {
        const text = $.root().text();
        data = JSON.parse(text);
      } catch (e) {
        this.log('warn', `Error parseando JSON: ${e.message}`);
        break;
      }

      if (!data.results || !data.results.length) { hasMore = false; break; }

      for (const product of data.results) {
        // Obtener precios de cada tienda para este producto
        await this.fetchPrices(product, catId);
        await this.delay(200, 500);
      }

      hasMore = !!data.next;
      page++;
      await this.delay(1000, 2000);
    }
  }

  async fetchPrices(product, catId) {
    try {
      const url = `https://www.solotodo.cl/api/products/${product.id}/entities/?format=json`;
      const $ = await this.fetchPage(url);
      if (!$) return;

      let data;
      try {
        data = JSON.parse($.root().text());
      } catch (e) { return; }

      const entities = data.results || data;
      if (!entities.length) return;

      for (const entity of entities) {
        // Solo procesar tiendas que nos interesan
        const storeId = Object.entries(STORE_IDS).find(([, id]) => id === entity.store?.id)?.[0];
        if (!storeId) continue;

        const price = parseInt(entity.active_registry?.cell_monthly_payment || entity.active_registry?.normal_price);
        if (!price || price < 1000) continue;

        this.stats.found++;
        this.saveProduct(
          {
            name:     product.name,
            category: catId,
            brand:    product.brand?.name || this.extractBrand(product.name),
            imageUrl: product.thumbnail_url || null,
            specs:    product.specs || null,
          },
          {
            current:  price,
            stock:    entity.condition === 'https://schema.org/InStock' ? 'in_stock' : 'out_of_stock',
            url:      entity.external_url || null,
            storeId,
          }
        );
      }
    } catch (err) {
      this.log('warn', `Error obteniendo precios de ${product.name}: ${err.message}`);
    }
  }
}

if (require.main === module) {
  new SoloTodoScraper().run().then(r => { console.log('SoloTodo:', r); process.exit(r.success ? 0 : 1); });
}
module.exports = SoloTodoScraper;
