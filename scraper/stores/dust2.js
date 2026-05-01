/**
 * scraper/stores/dust2.js
 * Dust2.gg — WooCommerce Store API
 */
require('dotenv').config();
const { createWooScraper } = require('./_woo-factory');

const BASE_API = 'https://www.dust2.gg/wp-json/wc/store/v1/products';

const CATEGORIES = [
  { slug: 'tarjetas-de-video',           catId: 'gpu'                    },
  { slug: 'tarjetas-de-video-nvidia',    catId: 'gpu',     sub: 'nvidia' },
  { slug: 'tarjetas-de-video-amd',       catId: 'gpu',     sub: 'amd'    },
  { slug: 'procesadores',                catId: 'cpu'                    },
  { slug: 'procesadores-amd',            catId: 'cpu',     sub: 'amd'    },
  { slug: 'procesadores-intel',          catId: 'cpu',     sub: 'intel'  },
  { slug: 'placas-madre',                catId: 'mobo'                   },
  { slug: 'memorias-ram',                catId: 'ram'                    },
  { slug: 'almacenamiento',              catId: 'storage'                },
  { slug: 'refrigeracion',               catId: 'cooling'                },
  { slug: 'fuentes-de-poder',            catId: 'psu'                    },
  { slug: 'gabinetes',                   catId: 'case'                   },
];

const Dust2Scraper = createWooScraper('dust2', 'Dust2', BASE_API, CATEGORIES);

if (require.main === module) {
  new Dust2Scraper().run().then(r => {
    console.log('Dust2:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = Dust2Scraper;
