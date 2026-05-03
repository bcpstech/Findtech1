/**
 * scraper/stores/tytgamer.js
 * TYT Gamer — WooCommerce, URL base: tytgamer.cl/tienda/
 * Categorías verificadas en el menú del sitio
 */
require('dotenv').config();
const { createWooScraper } = require('./_woo-factory');

const BASE_API = 'https://www.tytgamer.cl/tienda/wp-json/wc/store/v1/products';

const CATEGORIES = [
  { slug: 'tarjetas-graficas',     catId: 'gpu'                    },
  { slug: 'tarjetas-de-videos',    catId: 'gpu'                    },
  { slug: 'procesadores-intel',    catId: 'cpu',     sub: 'intel'  },
  { slug: 'procesadores-amd',      catId: 'cpu',     sub: 'amd'    },
  { slug: 'memorias-ddr4',         catId: 'ram',     sub: 'ddr4'   },
  { slug: 'memorias-ddr5',         catId: 'ram',     sub: 'ddr5'   },
  { slug: 'placas-madres-am5',     catId: 'mobo',    sub: 'am5'    },
  { slug: 'placas-madres-am4',     catId: 'mobo',    sub: 'am4'    },
  { slug: 'placas-madres-intel',   catId: 'mobo',    sub: 'lga1700'},
  { slug: 'gabinetes',             catId: 'case'                   },
  { slug: 'fuentes-de-poder',      catId: 'psu'                    },
];

const TYTGamerScraper = createWooScraper('tytgamer', 'TYT Gamer', BASE_API, CATEGORIES);

if (require.main === module) {
  new TYTGamerScraper().run().then(r => {
    console.log('TYT Gamer:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = TYTGamerScraper;
