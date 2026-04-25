/**
 * scraper/stores/pcexpress.js
 * PC-Express OpenCart — los productos cargan via JS en browser
 * Solución: usar endpoint de búsqueda que sí devuelve HTML estático con productos
 * Verificado: fetch('/route=product/search&search=procesador') devuelve $24.900 y 259 elementos
 */
const BaseScraper = require('../base-scraper');
const cheerio = require('cheerio');

const BASE_URL = 'https://tienda.pc-express.cl';

// Búsquedas específicas por categoría — verificado que devuelve HTML estático
const SEARCHES = [
  // GPU
  { query: 'tarjeta video nvidia rtx',    catId: 'gpu',     minPrice: 80000  },
  { query: 'tarjeta video radeon rx',     catId: 'gpu',     minPrice: 80000  },
  // CPU
  { query: 'procesador ryzen amd',        catId: 'cpu',     minPrice: 20000  },
  { query: 'procesador core intel',       catId: 'cpu',     minPrice: 20000  },
  // Placas Madre
  { query: 'placa madre am5',             catId: 'mobo',    minPrice: 30000  },
  { query: 'placa madre am4',             catId: 'mobo',    minPrice: 30000  },
  { query: 'placa madre intel lga',       catId: 'mobo',    minPrice: 30000  },
  // RAM
  { query: 'memoria ram ddr5',            catId: 'ram',     minPrice: 15000  },
  { query: 'memoria ram ddr4',            catId: 'ram',     minPrice: 10000  },
  // Storage
  { query: 'ssd nvme m2 pcie',            catId: 'storage', minPrice: 15000  },
  { query: 'ssd sata 2.5',               catId: 'storage', minPrice: 10000  },
  { query: 'disco duro interno 3.5',      catId: 'storage', minPrice: 20000  },
  // PSU
  { query: 'fuente poder 80 plus',        catId: 'psu',     minPrice: 20000  },
  { query: 'fuente poder certificada',    catId: 'psu',     minPrice: 20000  },
  // Case
  { query: 'gabinete atx gamer',          catId: 'case',    minPrice: 20000  },
  { query: 'gabinete torre mid',          catId: 'case',    minPrice: 20000  },
  // Cooling
  { query: 'refrigeracion liquida aio',   catId: 'cooling', minPrice: 30000  },
  { query: 'cooler cpu disipador',        catId: 'cooling', minPrice: 8000   },
];

const CARD_SURCHARGE = 1.03;

class PCExpressScraper extends BaseScraper {
  constructor() { super('pcexpress', 'PC-Express'); }

  async scrapeAll() {
    this.seenUrls = new Set();
    for (const cat of SEARCHES) {
      try {
        await this.scrapeSearch(cat);
        await this.delay(2000, 3000);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Error ${cat.catId} "${cat.query}": ${err.message}`);
      }
    }
  }

  async scrapeSearch({ query, catId, minPrice }) {
    let page = 1;

    while (page <= 5) {
      const url = `${BASE_URL}/index.php?route=product/search&search=${encodeURIComponent(query)}&sort=p.price&order=ASC&limit=50&page=${page}`;
      this.log('info', `[pcx] ${catId} "${query}" pág ${page}`);

      try {
        const res = await this.client.get(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-CL,es;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://tienda.pc-express.cl/',
          }
        });

        const $ = cheerio.load(res.data);
        let newInPage = 0;

        // Buscar todos los links a productos con su contexto
        $('a[href*="product_id="]').each((_, el) => {
          try {
            const $a = $(el);
            const productUrl = $a.attr('href') || '';
            if (this.seenUrls.has(productUrl)) return;

            // Obtener nombre — puede estar en el link mismo o en un h4 cercano
            let pname = $a.text().trim();
            if (!pname || pname.length < 5) {
              pname = $a.closest('div').find('h4').first().text().trim() || '';
            }
            if (!pname || pname.length < 5) return;

            // Buscar precio en el contenedor más cercano
            const $container = $a.closest('.product-layout, .product-thumb, div[class*="product"]').first()
                            || $a.closest('div').parent();

            let priceRaw = $container.find('.price-new, .price').first().text().trim();
            if (!priceRaw) {
              // Buscar precio en el contexto más amplio
              const $parent = $a.parent();
              priceRaw = $parent.find('[class*="price"]').first().text().trim()
                      || $parent.parent().find('[class*="price"]').first().text().trim();
            }

            const price = this.parsePrice(priceRaw);
            if (!price || price < (minPrice || 5000)) return;

            this.seenUrls.add(productUrl);

            const priceOldRaw = $container.find('.price-old').first().text().trim();
            const regularPrice = priceOldRaw ? this.parsePrice(priceOldRaw) : null;
            const priceCard = Math.round(price * CARD_SURCHARGE);
            const imageUrl = $container.find('img').first().attr('src') || null;

            this.stats.found++;
            newInPage++;
            this.saveProduct(
              { name: pname, category: catId, brand: this.extractBrand(pname), imageUrl,
                specs: {
                  'Efectivo/Transferencia': `$${price.toLocaleString('es-CL')}`,
                  'Tarjeta crédito/débito': `$${priceCard.toLocaleString('es-CL')}`,
                }
              },
              { current: price,
                normal: regularPrice > price ? regularPrice : null,
                discount: regularPrice > price ? Math.round((1-price/regularPrice)*100) : null,
                stock: 'in_stock', url: productUrl }
            );
          } catch(e) {}
        });

        this.log('info', `[pcx] ✓ "${query}" pág ${page}: ${newInPage} nuevos`);
        if (newInPage === 0) break;
        page++;
        await this.delay(1500, 2500);

      } catch (err) {
        this.stats.errors++;
        this.log('warn', `[pcx] Error HTTP "${query}" pág ${page}: ${err.message}`);
        break;
      }
    }
    this.log('info', `✓ pcx ${catId} total: ${this.stats.found}`);
  }
}

if (require.main === module) {
  new PCExpressScraper().run().then(r => {
    console.log('PC-Express:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = PCExpressScraper;
