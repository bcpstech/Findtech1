/**
 * scripts/enrich-specs.js
 * Enriquece specs técnicas de productos CPU/GPU/RAM/Storage
 * extrayendo datos del nombre del producto y consultando ARK Intel.
 * 
 * Uso: node scripts/enrich-specs.js
 *      node scripts/enrich-specs.js --category cpu
 */

require('dotenv').config();
const { getDb } = require('../db/database');

const db = getDb();

// ── Extractores por categoría ─────────────────────────────────────────────

function extractCpuSpecs(name) {
  const n = name.toUpperCase();
  const specs = {};

  // Núcleos y hilos: 4C/8T, 6-Core/12-Thread, 6 Núcleos 12 Hilos
  const coreMatch = n.match(/(\d+)[C\-\s]?(?:CORE|NÚCLEO|NUCLEO)S?[\s\/\-]+(\d+)[T\-\s]?(?:THREAD|HILO)S?/i)
                 || n.match(/(\d+)C[\s\/]+(\d+)T\b/i)
                 || n.match(/(\d+)\s*NUCL?EOS?\s+(\d+)\s*HILOS?/i);
  if (coreMatch) {
    specs['Núcleos'] = coreMatch[1];
    specs['Hilos'] = coreMatch[2];
  }

  // Frecuencia base: 3.3GHz, 3.3 GHz
  const baseMatch = n.match(/(\d+[\.,]\d+)\s*GHZ(?!\s*TURBO)/i)
                 || n.match(/(\d+[\.,]\d+)\s*GHZ/i);
  if (baseMatch) specs['Frecuencia base'] = baseMatch[1].replace(',', '.') + ' GHz';

  // Turbo/Boost: 4.3GHz TURBO, HASTA 5.0GHz
  const turboMatch = n.match(/(\d+[\.,]\d+)\s*GHZ\s*(?:TURBO|BOOST|MAX)/i)
                  || n.match(/(?:HASTA|UP TO|MAX)\s*(\d+[\.,]\d+)\s*GHZ/i);
  if (turboMatch) specs['Frecuencia turbo'] = turboMatch[1].replace(',', '.') + ' GHz';

  // Cache: 12MB CACHE, 12MB L3
  const cacheMatch = n.match(/(\d+)\s*MB\s*(?:CACHE|L3|CACHÉ)/i);
  if (cacheMatch) specs['Caché L3'] = cacheMatch[1] + ' MB';

  // TDP/Potencia: 65W, TDP 125W
  const tdpMatch = n.match(/(?:TDP\s*)?(\d+)\s*W(?:\s|$|,)/i);
  if (tdpMatch) specs['TDP'] = tdpMatch[1] + 'W';

  // Socket: LGA1700, AM5, AM4
  const socketMatch = n.match(/\b(LGA\s*\d{4}|AM[45]|STR[45]|FM[12]|LGA\s*2066)\b/i);
  if (socketMatch) specs['Socket'] = socketMatch[1].replace(/\s/g, '');

  // Generación: 12TH, 13TH, Raptor Lake, Alder Lake, Zen 4
  const genMap = {
    '10TH|COMET LAKE': 'Intel 10ª Gen (Comet Lake)',
    '11TH|ROCKET LAKE': 'Intel 11ª Gen (Rocket Lake)',
    '12TH|ALDER LAKE': 'Intel 12ª Gen (Alder Lake)',
    '13TH|RAPTOR LAKE': 'Intel 13ª Gen (Raptor Lake)',
    '14TH': 'Intel 14ª Gen (Raptor Lake Refresh)',
    'ARROW LAKE': 'Intel Core Ultra Serie 200 (Arrow Lake)',
    'ZEN 2': 'AMD Zen 2 (7nm)',
    'ZEN 3': 'AMD Zen 3 (7nm)',
    'ZEN 4': 'AMD Zen 4 (5nm)',
    'ZEN 5': 'AMD Zen 5 (4nm)',
  };
  for (const [pat, label] of Object.entries(genMap)) {
    if (new RegExp(pat).test(n)) { specs['Generación'] = label; break; }
  }

  // Gráficos integrados
  if (/SIN VIDEO|NO GRAPHICS|SIN GRÁFICO|SIN GRAFIC|NO IGPU|\bF\b/.test(n)) {
    specs['Gráficos integrados'] = 'No';
  } else if (/RADEON|UHD|IRIS|VEGA/.test(n)) {
    specs['Gráficos integrados'] = 'Sí';
  }

  // Incluye cooler
  if (/WRAITH|STEALTH|PRISM|INCLUYE\s*(?:COOLER|DISIPADOR)/.test(n)) {
    specs['Incluye cooler'] = 'Sí (Wraith)';
  } else if (/SIN\s*COOLER|NO\s*COOLER|NOT\s*INCLUDED|WOF/.test(n)) {
    specs['Incluye cooler'] = 'No';
  }

  // Memoria soportada
  if (/DDR5/.test(n)) specs['Memoria'] = 'DDR5';
  else if (/DDR4/.test(n)) specs['Memoria'] = 'DDR4';

  return specs;
}

function extractGpuSpecs(name) {
  const n = name.toUpperCase();
  const specs = {};

  // VRAM: 8GB, 16GB
  const vramMatch = n.match(/(\d+)\s*GB\s*(?:GDDR\d+|VRAM)?/i);
  if (vramMatch) specs['VRAM'] = vramMatch[1] + ' GB';

  // Tipo memoria: GDDR6X, GDDR6
  const memMatch = n.match(/GDDR\d+X?/i);
  if (memMatch) specs['Tipo memoria'] = memMatch[0].toUpperCase();

  // Bus: 128-bit, 256-bit
  const busMatch = n.match(/(\d{2,3})[\s-]*BIT/i);
  if (busMatch) specs['Bus de memoria'] = busMatch[1] + '-bit';

  // Conector: 8-pin, 16-pin
  const pinMatch = n.match(/(\d+)[\s-]*PIN/i);
  if (pinMatch) specs['Conector'] = pinMatch[1] + '-pin';

  // Factor de forma
  if (/MINI[\s-]?ITX|SMALL FORM/.test(n)) specs['Factor de forma'] = 'Mini-ITX';
  else if (/LOW[\s-]?PROFILE/.test(n)) specs['Factor de forma'] = 'Low Profile';

  // OC / Overclock
  if (/\bOC\b/.test(n)) specs['Variante'] = 'OC (Overclocked)';

  return specs;
}

function extractRamSpecs(name) {
  const n = name.toUpperCase();
  const specs = {};

  // Capacidad: 16GB, 32GB
  const capMatch = n.match(/(\d+)\s*GB/i);
  if (capMatch) specs['Capacidad'] = capMatch[1] + ' GB';

  // Tipo: DDR5, DDR4
  const typeMatch = n.match(/DDR[45]/i);
  if (typeMatch) specs['Tipo'] = typeMatch[0].toUpperCase();

  // Velocidad: 5200MHz, 3600MT/s, DDR5-5600
  const speedMatch = n.match(/(\d{4,5})\s*(?:MHZ|MT\/S)/i)
                  || n.match(/DDR[45][\s-](\d{4,5})/i);
  if (speedMatch) specs['Velocidad'] = speedMatch[1] + ' MHz';

  // Latencia: CL40, CL18
  const clMatch = n.match(/CL\s*(\d+)/i);
  if (clMatch) specs['Latencia'] = 'CL' + clMatch[1];

  // Kit: 2x8GB, 2x16GB
  const kitMatch = n.match(/(\d+)\s*[Xx×]\s*(\d+)\s*GB/i);
  if (kitMatch) {
    specs['Kit'] = kitMatch[1] + 'x' + kitMatch[2] + ' GB';
    specs['Capacidad'] = (parseInt(kitMatch[1]) * parseInt(kitMatch[2])) + ' GB (total)';
  }

  // RGB
  if (/RGB|ARGB/.test(n)) specs['Iluminación'] = 'RGB';

  return specs;
}

function extractStorageSpecs(name) {
  const n = name.toUpperCase();
  const specs = {};

  // Capacidad: 1TB, 500GB, 2TB
  const capMatch = n.match(/(\d+(?:\.\d+)?)\s*(TB|GB)/i);
  if (capMatch) specs['Capacidad'] = capMatch[1] + ' ' + capMatch[2].toUpperCase();

  // Interfaz
  if (/NVME|M\.2|PCIE/i.test(n)) specs['Interfaz'] = 'NVMe PCIe';
  else if (/SATA/i.test(n)) specs['Interfaz'] = 'SATA III';
  else if (/USB/i.test(n)) specs['Interfaz'] = 'USB';

  // Factor forma
  if (/M\.2/i.test(n)) specs['Factor de forma'] = 'M.2 2280';
  else if (/2\.5/i.test(n)) specs['Factor de forma'] = '2.5"';
  else if (/3\.5/i.test(n)) specs['Factor de forma'] = '3.5"';

  // Velocidad lectura/escritura
  const readMatch = n.match(/(\d{3,4})\s*MB\/S\s*(?:READ|LECTURA)/i)
                 || n.match(/(?:READ|LECTURA)\s*(\d{3,4})\s*MB\/S/i);
  if (readMatch) specs['Lectura'] = readMatch[1] + ' MB/s';

  return specs;
}

function extractMoboSpecs(name) {
  const n = name.toUpperCase();
  const specs = {};

  // Socket
  const socketMatch = n.match(/\b(AM[45]|LGA\s*\d{4}|STR[45])\b/i);
  if (socketMatch) specs['Socket'] = socketMatch[1].replace(/\s/g, '');

  // Form factor
  if (/MINI[\s-]?ITX/.test(n)) specs['Factor de forma'] = 'Mini-ITX';
  else if (/MICRO[\s-]?ATX|MATX|M[\s-]?ATX/.test(n)) specs['Factor de forma'] = 'Micro-ATX';
  else if (/E[\s-]?ATX/.test(n)) specs['Factor de forma'] = 'E-ATX';
  else if (/\bATX\b/.test(n)) specs['Factor de forma'] = 'ATX';

  // Memoria
  if (/DDR5/.test(n)) specs['Memoria'] = 'DDR5';
  else if (/DDR4/.test(n)) specs['Memoria'] = 'DDR4';

  // WiFi
  if (/WIFI|WI[\s-]?FI|WIRELESS/.test(n)) specs['WiFi'] = 'Integrado';

  // Slots M.2
  const m2Match = n.match(/(\d+)\s*M\.2/i);
  if (m2Match) specs['Slots M.2'] = m2Match[1];

  return specs;
}

// ── Dispatcher ───────────────────────────────────────────────────────────

function extractSpecs(name, category) {
  switch (category) {
    case 'cpu':     return extractCpuSpecs(name);
    case 'gpu':     return extractGpuSpecs(name);
    case 'ram':     return extractRamSpecs(name);
    case 'storage': return extractStorageSpecs(name);
    case 'mobo':    return extractMoboSpecs(name);
    default:        return {};
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

const catArg = process.argv.find(a => a.startsWith('--category='))?.replace('--category=','')
            || (process.argv.includes('--category') ? process.argv[process.argv.indexOf('--category')+1] : null);

const products = catArg
  ? db.prepare('SELECT * FROM products WHERE category_id = ?').all(catArg)
  : db.prepare('SELECT * FROM products').all();

console.log(`Enriqueciendo specs de ${products.length} productos...`);

const updateStmt = db.prepare(`
  UPDATE products SET specs = ?, updated_at = datetime('now') WHERE id = ?
`);

let updated = 0;
let skipped = 0;

for (const p of products) {
  const techSpecs = extractSpecs(p.name, p.category_id);
  
  if (!Object.keys(techSpecs).length) { skipped++; continue; }

  // Merge con specs existentes — preservar precios, añadir técnicas
  let existingSpecs = {};
  try { existingSpecs = p.specs ? JSON.parse(p.specs) : {}; } catch {}

  const merged = { ...techSpecs, ...existingSpecs }; // técnicas primero, precios sobrescriben si hay conflicto
  
  // Solo actualizar si hay specs técnicas nuevas
  const newTechKeys = Object.keys(techSpecs).filter(k => !existingSpecs[k]);
  if (!newTechKeys.length) { skipped++; continue; }

  updateStmt.run(JSON.stringify(merged), p.id);
  updated++;
}

console.log(`\n✅ Enriquecimiento completo:`);
console.log(`   ${updated} productos actualizados`);
console.log(`   ${skipped} productos sin cambios`);
console.log(`\nEjemplo de specs extraídas para "${products[0]?.name}":`);
if (products[0]) {
  const ex = extractSpecs(products[0].name, products[0].category_id);
  console.log(JSON.stringify(ex, null, 2));
}
