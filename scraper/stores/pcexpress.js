/**
 * scraper/stores/pcexpress.js
 * PC-Express — WooCommerce Store API
 * Categoría principal: Componentes para PC
 */
require('dotenv').config();
const { createWooScraper } = require('./_woo-factory');

const BASE_API = 'https://tienda.pc-express.cl/wp-json/wc/store/v1/products';

const CATEGORIES = [
  { slug: 'tarjetas-de-video',        catId: 'gpu'     },
  { slug: 'tarjetas-de-video-nvidia', catId: 'gpu',    sub: 'nvidia' },
  { slug: 'tarjetas-de-video-amd',    catId: 'gpu',    sub: 'amd'    },
  { slug: 'procesadores',             catId: 'cpu'     },
  { slug: 'procesadores-amd',         catId: 'cpu',    sub: 'amd'    },
  { slug: 'procesadores-intel',       catId: 'cpu',    sub: 'intel'  },
  { slug: 'placas-madre',             catId: 'mobo'    },
  { slug: 'memorias',                 catId: 'ram'     },
  { slug: 'almacenamiento',           catId: 'storage' },
  { slug: 'refrigeracion',            catId: 'cooling' },
  { slug: 'fuentes-de-poder',         catId: 'psu'     },
  { slug: 'gabinetes',                catId: 'case'    },
];

const PCExpressScraper = createWooScraper('pcexpress', 'PC-Express', BASE_API, CATEGORIES);

if (require.main === module) {
  new PCExpressScraper().run().then(r => {
    console.log('PC-Express:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = PCExpressScraper;
