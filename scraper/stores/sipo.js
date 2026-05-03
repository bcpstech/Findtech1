/**
 * scraper/stores/sipo.js
 * Sipo — WooCommerce Store API
 * Dominio correcto: sipoonline.cl (no sipo.cl)
 */
require('dotenv').config();
const { createWooScraper } = require('./_woo-factory');

const BASE_API  = 'https://sipoonline.cl/wp-json/wc/store/v1/products';
const PROXY_URL = process.env.CF_PROXY_URL    || '';
const PROXY_KEY = process.env.CF_PROXY_SECRET || '';

function proxify(url) {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}&secret=${PROXY_KEY}`;
}

const CATEGORIES = [
  { slug: 'procesadores',        catId: 'cpu'                    },
  { slug: 'tarjetas-de-video',   catId: 'gpu'                    },
  { slug: 'placas-madre',        catId: 'mobo'                   },
  { slug: 'memorias-ram',        catId: 'ram'                    },
  { slug: 'almacenamiento',      catId: 'storage'                },
  { slug: 'refrigeracion',       catId: 'cooling'                },
  { slug: 'fuentes-de-poder',    catId: 'psu'                    },
  { slug: 'gabinetes',           catId: 'case'                   },
];

const SipoScraper = createWooScraper('sipo', 'Sipo', BASE_API, CATEGORIES, { proxify });

if (require.main === module) {
  new SipoScraper().run().then(r => {
    console.log('Sipo:', r);
    process.exit(r.success ? 0 : 1);
  });
}
module.exports = SipoScraper;
