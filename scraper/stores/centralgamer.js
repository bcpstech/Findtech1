/**
 * scraper/stores/centralgamer.js
 * Usa la API REST de WooCommerce Store (/wp-json/wc/store/v1/products)
 * Verificado funcionando — devuelve precios e imágenes reales
 */
const BaseScraper = require('../base-scraper');

// IDs de categorías en WooCommerce de CentralGamer
// Obtenidos de: https://centralgamer.cl/wp-json/wc/store/v1/products/categories
const CATEGORIES = [
  { slug: 'tarjetas-de-video',  catId: 'gpu'     },
  { slug: 'procesadores',       catId: 'cpu'     },
  { slug: 'memorias-ram',       catId: 'ram'     },
  { slug: 'almacenamiento',     catId: 'storage' },
  { slug: 'refrigeracion-pc',   catId: 'cooling' },
  { slug: 'placas-madre',       catId: 'mobo'    },
  { slug: 'fuentes-de-poder',   catId: 'psu'     },
  { slug: 'gabinetes-gamer',    catId: 'case'    },
  { slug: 'monitores',          catId: 'monitor' },
  { slug: 'mouse-gamer',        catId: 'periph'  },
];

const BASE_API = 'https://centralgamer.cl/wp-json/wc/store/v1/products';

class CentralGamerScraper extends BaseScraper {
  constructor() { super('cg', 'CentralGamer'); }

  async scrapeAll() {
    for (const { slug, catId } of CATEGORIES) {
      try {
        await this.scrapeCategory(slug, catId);
        await this.delay(1000, 2000);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error en ${catId}: ${err.message}`);
      }
    }
  }

  async scrapeCategory(slug, catId) {
    let page = 1;
    let hasMore = true;
    const PER_PAGE = 100;

    while (hasMore && page <= 10) {
      const url = `${BASE_API}?category=${slug}&per_page=${PER_PAGE}&page=${page}`;
      this.log('info', `API CentralGamer ${catId} pág ${page}`);

      try {
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          }
        });

        const products = res.data;
        if (!products || !products.length) { hasMore = false; break; }

        for (const p of products) {
          // Precio viene como string "449990" — sin centavos
          const price = parseInt(p.prices?.price);
          const regularPrice = parseInt(p.prices?.regular_price);

          if (!price || price < 1000) continue;

          this.stats.found++;
          this.saveProduct(
            {
              name:     p.name,
              category: catId,
              brand:    this.extractBrand(p.name),
              imageUrl: p.images?.[0]?.src || null,
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

        // Verificar si hay más páginas
        hasMore = products.length === PER_PAGE;
        page++;
        await this.delay(800, 1500);

      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error API ${slug} pág ${page}: ${err.message}`);
        break;
      }
    }

    this.log('info', `✓ ${catId}: ${this.stats.found} productos`);
  }
}

if (require.main === module) {
  new CentralGamerScraper().run().then(r => {
    console.log('CentralGamer:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = CentralGamerScraper;
