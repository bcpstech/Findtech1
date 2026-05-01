/**
 * scraper/stores/progaming.js
 * ProGaming — WooCommerce Store API
 */
require('dotenv').config();
const { createWooScraper } = require('./_woo-factory');

const BASE_API = 'https://www.progaming.cl/wp-json/wc/store/v1/products';

const CATEGORIES = [
  { slug: 'tarjetas-de-video',           catId: 'gpu'                    },
  { slug: 'tarjeta-de-video-nvidia',     catId: 'gpu',     sub: 'nvidia' },
  { slug: 'tarjeta-de-video-amd',        catId: 'gpu',     sub: 'amd'    },
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

const ProGamingScraper = createWooScraper('progaming', 'ProGaming', BASE_API, CATEGORIES);

if (require.main === module) {
  new ProGamingScraper().run().then(r => {
    console.log('ProGaming:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = ProGamingScraper;
