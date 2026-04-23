/**
 * scraper/run-all.js
 * Ejecuta todos los scrapers en secuencia y muestra un resumen final.
 * Uso: node scraper/run-all.js
 *      node scraper/run-all.js --stores n1g,alltec   (solo esas tiendas)
 *      node scraper/run-all.js --dry                 (sin guardar en DB)
 */

require('dotenv').config();
const logger = require('./logger');

const N1GScraper          = require('./stores/n1g');
const AlltecScraper       = require('./stores/alltec');
const CentralGamerScraper = require('./stores/centralgamer');
const CentraleScraper     = require('./stores/centrale');
const PCExpressScraper    = require('./stores/pcexpress');

const ALL_SCRAPERS = [
  { id: 'n1g',        Class: N1GScraper         },
  { id: 'alltec',     Class: AlltecScraper       },
  { id: 'cg',         Class: CentralGamerScraper },
  { id: 'centrale',   Class: CentraleScraper     },
  { id: 'pcexpress',  Class: PCExpressScraper    },
];

async function runAll() {
  const startAll = Date.now();

  // Filtrar tiendas por argumento CLI --stores n1g,alltec
  const storesArg = process.argv.find(a => a.startsWith('--stores=')) ||
                    (() => { const i = process.argv.indexOf('--stores'); return i !== -1 ? `--stores=${process.argv[i+1]}` : null; })();
  const filterIds = storesArg ? storesArg.replace('--stores=','').split(',').map(s=>s.trim()) : null;
  const scrapers  = filterIds ? ALL_SCRAPERS.filter(s => filterIds.includes(s.id)) : ALL_SCRAPERS;

  logger.info(`🚀 Iniciando scraping de ${scrapers.length} tienda(s)`, {
    stores: scrapers.map(s => s.id).join(', ')
  });

  const results = [];

  for (const { id, Class } of scrapers) {
    logger.info(`\n${'─'.repeat(50)}\n📦 Tienda: ${id.toUpperCase()}\n${'─'.repeat(50)}`);
    try {
      const scraper = new Class();
      const result  = await scraper.run();
      results.push({ id, ...result });
    } catch (err) {
      logger.error(`Error inicializando scraper ${id}: ${err.message}`);
      results.push({ id, success: false, error: err.message });
    }
  }

  // ── Resumen final ──────────────────────────────────────────────────────
  const totalDuration = ((Date.now() - startAll) / 1000).toFixed(1);
  const successful    = results.filter(r => r.success).length;
  const totalUpdated  = results.reduce((a, r) => a + (r.updated || 0), 0);
  const totalErrors   = results.reduce((a, r) => a + (r.errors  || 0), 0);

  console.log('\n' + '═'.repeat(55));
  console.log('📊 RESUMEN DE SCRAPING');
  console.log('═'.repeat(55));
  results.forEach(r => {
    const icon   = r.success ? '✅' : '❌';
    const detail = r.success
      ? `${r.updated} actualizados, ${r.errors} errores, ${((r.duration||0)/1000).toFixed(1)}s`
      : `ERROR: ${r.error}`;
    console.log(`${icon} ${r.id.padEnd(12)} ${detail}`);
  });
  console.log('─'.repeat(55));
  console.log(`   Tiendas OK    : ${successful}/${scrapers.length}`);
  console.log(`   Productos      : ${totalUpdated}`);
  console.log(`   Errores totales: ${totalErrors}`);
  console.log(`   Tiempo total   : ${totalDuration}s`);
  console.log('═'.repeat(55));

  return { successful, totalUpdated, totalErrors, duration: totalDuration };
}

if (require.main === module) {
  runAll()
    .then(summary => process.exit(summary.successful > 0 ? 0 : 1))
    .catch(err => { logger.error('Error fatal en run-all:', err); process.exit(1); });
}

module.exports = runAll;
