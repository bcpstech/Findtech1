/**
 * scraper/stores/tytgamer.js
 * TYT Gamer — WooCommerce Store API
 */
require('dotenv').config();
const { createWooScraper } = require('./_woo-factory');

const BASE_API = 'https://www.tytgamer.cl/wp-json/wc/store/v1/products';

const CATEGORIES = [
  { slug: 'tarjetas-de-video',           catId: 'gpu'                    },
  { slug: 'tarjetas-nvidia',             catId: 'gpu',     sub: 'nvidia' },
  { slug: 'tarjetas-amd',               catId: 'gpu',     sub: 'amd'    },
  { slug: 'procesadores',                catId: 'cpu'                    },
  { slug: 'procesadores-amd',            catId: 'cpu',     sub: 'amd'    },
  { slug: 'procesadores-intel',          catId: 'cpu',     sub: 'intel'  },
  { slug: 'placas-madre',                catId: 'mobo'                   },
  { slug: 'memorias-ram',                catId: 'ram'                    },
  { slug: 'almacenamiento',              catId: 'storage'                },
  { slug: 'refrigeracion',               catId: 'cooling'                },
  { slug: 'fuentes-de-poder',            catId: 'psu'                    },
  { slug: 'gabinetes',                   catId: 'case'                   },
  { slug: 'pc-gamer',                    catId: 'pc'                     },
];

const TYTGamerScraper = createWooScraper('tytgamer', 'TYT Gamer', BASE_API, CATEGORIES);

if (require.main === module) {
  new TYTGamerScraper().run().then(r => {
    console.log('TYT Gamer:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = TYTGamerScraper;
