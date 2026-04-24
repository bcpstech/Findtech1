/**
 * scraper/stores/centralgamer.js
 * Usa la API REST de WooCommerce Store (/wp-json/wc/store/v1/products)
 * Obtiene TODOS los 367 productos de CentralGamer
 */
const BaseScraper = require('../base-scraper');

const BASE_API = 'https://centralgamer.cl/wp-json/wc/store/v1/products';

// Mapeo de categorías WooCommerce → categorías FindTech
const CAT_MAP = {
  'tarjetas-de-video': 'gpu',
  'procesadores':      'cpu',
  'memorias-ram':      'ram',
  'almacenamiento':    'storage',
  'refrigeracion-pc':  'cooling',
  'placas-madre':      'mobo',
  'fuentes-de-poder':  'psu',
  'gabinetes-gamer':   'case',
  'monitores':         'monitor',
  'mouse-gamer':       'periph',
  'audifonos-gamer':   'periph',
  'teclados-gamer':    'periph',
  'sillas-gamer':      'periph',
};

class CentralGamerScraper extends BaseScraper {
  constructor() { super('cg', 'CentralGamer'); }

  async scrapeAll() {
    let page = 1;
    let hasMore = true;
    const PER_PAGE = 100;
    let totalFound = 0;

    this.log('info', 'Obteniendo todos los productos de CentralGamer...');

    while (hasMore) {
      const url = `${BASE_API}?per_page=${PER_PAGE}&page=${page}`;
      this.log('info', `Página ${page} (${totalFound} productos hasta ahora)`);

      try {
        const res = await this.client.get(url, {
          headers: { 'Accept': 'application/json' }
        });

        const products = res.data;
        if (!products || !products.length) { hasMore = false; break; }

        for (const p of products) {
          const price = parseInt(p.prices?.price);
          if (!price || price < 1000) continue;

          // Determinar categoría desde las categorías del producto
          let catId = 'periph'; // default
          if (p.categories?.length) {
            for (const cat of p.categories) {
              const slug = cat.slug || '';
              if (CAT_MAP[slug]) { catId = CAT_MAP[slug]; break; }
              // Buscar por nombre parcial
              const name = (cat.name || '').toLowerCase();
              if (name.includes('tarjeta') || name.includes('video') || name.includes('gpu')) { catId = 'gpu'; break; }
              if (name.includes('procesador') || name.includes('cpu')) { catId = 'cpu'; break; }
              if (name.includes('memoria') || name.includes('ram')) { catId = 'ram'; break; }
              if (name.includes('almacen') || name.includes('ssd') || name.includes('disco')) { catId = 'storage'; break; }
              if (name.includes('refriger') || name.includes('cooling')) { catId = 'cooling'; break; }
              if (name.includes('placa')) { catId = 'mobo'; break; }
              if (name.includes('fuente')) { catId = 'psu'; break; }
              if (name.includes('gabinete')) { catId = 'case'; break; }
              if (name.includes('monitor')) { catId = 'monitor'; break; }
            }
          } else {
            catId = this.detectCategory(p.name);
          }

          // Precio tarjeta crédito/débito (+5.26% verificado)
          const priceCard = Math.round(price * 1.0526);
          const regularPrice = parseInt(p.prices?.regular_price);

          this.stats.found++;
          totalFound++;
          this.saveProduct(
            {
              name:     p.name,
              category: catId,
              brand:    p.brands?.[0]?.name || this.extractBrand(p.name),
              imageUrl: p.images?.[0]?.src || null,
              specs: {
                'Precio efectivo/transferencia': `$${price.toLocaleString('es-CL')}`,
                'Precio tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
              }
            },
            {
              current:  price,
              normal:   regularPrice && regularPrice > price ? regularPrice : null,
              discount: regularPrice > price ? Math.round((1 - price/regularPrice)*100) : null,
              stock:    p.is_in_stock ? 'in_stock' : 'out_of_stock',
              url:      p.permalink || null,
            }
          );
        }

        hasMore = products.length === PER_PAGE;
        page++;
        await this.delay(800, 1500);

      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error pág ${page}: ${err.message}`);
        break;
      }
    }

    this.log('info', `✓ Total: ${totalFound} productos de CentralGamer`);
  }
}

if (require.main === module) {
  new CentralGamerScraper().run().then(r => {
    console.log('CentralGamer:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = CentralGamerScraper;
