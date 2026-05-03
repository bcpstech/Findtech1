/**
 * scraper/stores/megabytes.js
 * MegaBytes — WooCommerce Store API
 * currency_minor_unit: 0 → precios ya en CLP, no dividir
 */
require('dotenv').config();
const { createWooScraper } = require('./_woo-factory');

const BASE_API = 'https://www.megabytes.cl/wp-json/wc/store/v1/products';

// Slugs verificados desde el JSON de la API (categories[].slug)
const CATEGORIES = [
  { slug: 'pc-armados',          catId: 'pc'                     },
  { slug: 'tarjetas-de-video',   catId: 'gpu'                    },
  { slug: 'nvidia',              catId: 'gpu',     sub: 'nvidia' },
  { slug: 'amd-gpu',             catId: 'gpu',     sub: 'amd'    },
  { slug: 'procesadores',        catId: 'cpu'                    },
  { slug: 'procesadores-amd',    catId: 'cpu',     sub: 'amd'    },
  { slug: 'procesadores-intel',  catId: 'cpu',     sub: 'intel'  },
  { slug: 'placas-madre',        catId: 'mobo'                   },
  { slug: 'memorias-ram',        catId: 'ram'                    },
  { slug: 'almacenamiento',      catId: 'storage'                },
  { slug: 'refrigeracion',       catId: 'cooling'                },
  { slug: 'fuentes-de-poder',    catId: 'psu'                    },
  { slug: 'gabinetes',           catId: 'case'                   },
];

const MegaBytesScraper = createWooScraper('megabytes', 'MegaBytes', BASE_API, CATEGORIES);

if (require.main === module) {
  new MegaBytesScraper().run().then(r => {
    console.log('MegaBytes:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = MegaBytesScraper;
