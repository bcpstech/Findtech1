/**
 * scraper/stores/infor-ingen.js
 * Infor-Ingen — WooCommerce Store API
 * Categorías verificadas en el menú del sitio
 */
require('dotenv').config();
const { createWooScraper } = require('./_woo-factory');

const BASE_API = 'https://store.infor-ingen.com/wp-json/wc/store/v1/products';

const CATEGORIES = [
  { slug: 'tarjetas-de-video',  catId: 'gpu'     },
  { slug: 'procesadores',       catId: 'cpu'     },
  { slug: 'placas-madres',      catId: 'mobo'    },
  { slug: 'memorias',           catId: 'ram'     },
  { slug: 'almacenamiento',     catId: 'storage' },
  { slug: 'refrigeracion',      catId: 'cooling' },
  { slug: 'fuentes-de-poder',   catId: 'psu'     },
  { slug: 'gabinetes',          catId: 'case'    },
  { slug: 'computadores',       catId: 'pc'      },
];

const InforIngenScraper = createWooScraper('infor-ingen', 'Infor-Ingen', BASE_API, CATEGORIES);

if (require.main === module) {
  new InforIngenScraper().run().then(r => {
    console.log('Infor-Ingen:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = InforIngenScraper;
