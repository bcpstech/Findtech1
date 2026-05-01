/**
 * scraper/stores/mybox.js
 * MyBox — WooCommerce Store API
 */
require('dotenv').config();
const { createWooScraper } = require('./_woo-factory');

const BASE_API = 'https://www.mybox.cl/wp-json/wc/store/v1/products';

const CATEGORIES = [
  { slug: 'tarjetas-de-video',           catId: 'gpu'                    },
  { slug: 'nvidia-geforce',              catId: 'gpu',     sub: 'nvidia' },
  { slug: 'amd-radeon',                  catId: 'gpu',     sub: 'amd'    },
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

const MyBoxScraper = createWooScraper('mybox', 'MyBox', BASE_API, CATEGORIES);

if (require.main === module) {
  new MyBoxScraper().run().then(r => {
    console.log('MyBox:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = MyBoxScraper;
