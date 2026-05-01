/**
 * scraper/run-all.js
 * Ejecuta todos los scrapers en secuencia y muestra un resumen final.
 *
 * Uso:
 *   node scraper/run-all.js                          — todas las tiendas
 *   node scraper/run-all.js --stores n1g,alltec      — solo esas tiendas
 *   node scraper/run-all.js --exclude dust2,sipo     — todas excepto esas
 *   node scraper/run-all.js --list                   — muestra tiendas disponibles
 */

require('dotenv').config();
const logger = require('./logger');

const ALL_SCRAPERS = [
  { id: 'spdigital',   name: 'SP Digital',   Class: require('./stores/spdigital')   },
  { id: 'n1g',         name: 'N1G',          Class: require('./stores/n1g')         },
  { id: 'myshop',      name: 'MyShop',       Class: require('./stores/myshop')      },
  { id: 'trulustore',  name: 'TruluStore',   Class: require('./stores/trulustore')  },
  { id: 'centralgamer',name: 'CentralGamer', Class: require('./stores/centralgamer')},
  { id: 'alltec',      name: 'Alltec',       Class: require('./stores/alltec')      },
  { id: 'centrale',    name: 'Centrale',     Class: require('./stores/centrale')    },
  { id: 'winpy',       name: 'Winpy',        Class: require('./stores/winpy')       },
  { id: 'megadrive',   name: 'MegaDrive',    Class: require('./stores/megadrive')   },
  { id: 'pcexpress',   name: 'PC-Express',   Class: require('./stores/pcexpress')   },
  { id: 'dust2',       name: 'Dust2',        Class: require('./stores/dust2')       },
  { id: 'megabytes',   name: 'MegaBytes',    Class: require('./stores/megabytes')   },
  { id: 'progaming',   name: 'ProGaming',    Class: require('./stores/progaming')   },
  { id: 'sipo',        name: 'Sipo',         Class: require('./stores/sipo')        },
  { id: 'tytgamer',    name: 'TYT Gamer',    Class: require('./stores/tytgamer')    },
  { id: 'mybox',       name: 'MyBox',        Class: require('./stores/mybox')       },
  { id: 'sandos',      name: 'Sandos',       Class: require('./stores/sandos')      },
];

// ── Parsear argumentos CLI ────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    console.log('\n📋 Tiendas disponibles:\n');
    ALL_SCRAPERS.forEach(s => console.log(`   ${s.id.padEnd(14)} ${s.name}`));
    console.log('\nEjemplos:');
    console.log('   node scraper/run-all.js --stores n1g,myshop,spdigital');
    console.log('   node scraper/run-all.js --exclude dust2,sipo');
    process.exit(0);
  }

  // --stores=a,b,c  o  --stores a,b,c
  const storesArg = args.find(a => a.startsWith('--stores='))
    || (() => { const i = args.indexOf('--stores'); return i !== -1 ? `--stores=${args[i+1]}` : null; })();

  // --exclude=a,b  o  --exclude a,b
  const excludeArg = args.find(a => a.startsWith('--exclude='))
    || (() => { const i = args.indexOf('--exclude'); return i !== -1 ? `--exclude=${args[i+1]}` : null; })();

  let scrapers = ALL_SCRAPERS;

  if (storesArg) {
    const ids = storesArg.replace('--stores=', '').split(',').map(s => s.trim().toLowerCase());
    scrapers = ALL_SCRAPERS.filter(s => ids.includes(s.id));
    if (!scrapers.length) {
      console.error(`❌ Ninguna tienda encontrada: ${ids.join(', ')}`);
      console.error(`   Usa --list para ver las disponibles`);
      process.exit(1);
    }
  } else if (excludeArg) {
    const ids = excludeArg.replace('--exclude=', '').split(',').map(s => s.trim().toLowerCase());
    scrapers = ALL_SCRAPERS.filter(s => !ids.includes(s.id));
  }

  return scrapers;
}

async function runAll() {
  const scrapers   = parseArgs();
  const startAll   = Date.now();

  console.log('\n' + '═'.repeat(55));
  console.log(`🚀 FindTech Scraper — ${scrapers.length} tienda(s)`);
  console.log('═'.repeat(55));
  console.log('   ' + scrapers.map(s => s.name).join(', '));
  console.log('═'.repeat(55) + '\n');

  const results = [];

  for (const { id, name, Class } of scrapers) {
    console.log(`\n${'─'.repeat(55)}`);
    console.log(`📦 ${name} (${id})`);
    console.log('─'.repeat(55));
    try {
      const scraper = new Class();
      const result  = await scraper.run();
      results.push({ id, name, ...result });
    } catch (err) {
      logger.error(`Error inicializando scraper ${id}: ${err.message}`);
      results.push({ id, name, success: false, error: err.message });
    }
  }

  // ── Resumen final ──────────────────────────────────────────────────────
  const totalDuration = ((Date.now() - startAll) / 1000).toFixed(1);
  const successful    = results.filter(r => r.success).length;
  const totalUpdated  = results.reduce((a, r) => a + (r.updated  || 0), 0);
  const totalErrors   = results.reduce((a, r) => a + (r.errors   || 0), 0);

  console.log('\n' + '═'.repeat(55));
  console.log('📊 RESUMEN FINAL');
  console.log('═'.repeat(55));
  results.forEach(r => {
    const icon   = r.success ? '✅' : '❌';
    const detail = r.success
      ? `${r.updated} productos · ${r.errors} errores · ${((r.duration||0)/1000).toFixed(1)}s`
      : `ERROR: ${r.error}`;
    console.log(`${icon} ${r.name.padEnd(14)} ${detail}`);
  });
  console.log('─'.repeat(55));
  console.log(`   Tiendas OK : ${successful}/${scrapers.length}`);
  console.log(`   Productos   : ${totalUpdated}`);
  console.log(`   Errores     : ${totalErrors}`);
  console.log(`   Tiempo      : ${totalDuration}s`);
  console.log('═'.repeat(55) + '\n');

  return { successful, totalUpdated, totalErrors, duration: totalDuration };
}

if (require.main === module) {
  runAll()
    .then(summary => process.exit(summary.successful > 0 ? 0 : 1))
    .catch(err => { logger.error('Error fatal en run-all:', err); process.exit(1); });
}

module.exports = runAll;
