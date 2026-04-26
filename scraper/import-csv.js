/**
 * scraper/import-csv.js
 * Convierte la planilla CSV de URLs en el JSON que usa url-scraper.js
 *
 * Uso: node scraper/import-csv.js path/al/archivo.csv
 *      node scraper/import-csv.js  (busca scraper/data/product-urls.csv por defecto)
 *
 * Formato CSV esperado:
 *   store_id, store_name, category, sub category, product, STOCK
 *
 * Genera: scraper/data/product-urls.json
 */

const fs   = require('fs');
const path = require('path');

const CSV_PATH  = process.argv[2] || path.join(__dirname, 'data', 'product-urls.csv');
const OUT_PATH  = path.join(__dirname, 'data', 'product-urls.json');
const DATA_DIR  = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(CSV_PATH)) {
  console.error(`❌ No se encontró el CSV en: ${CSV_PATH}`);
  console.error(`   Uso: node scraper/import-csv.js /ruta/al/archivo.csv`);
  process.exit(1);
}

// Parsear CSV simple (sin dependencias externas)
function parseCSV(content) {
  const lines = content.replace(/\r/g,'').split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g,'_'));
  return lines.slice(1).map(line => {
    // Manejar comas dentro de comillas
    const cols = [];
    let current = '';
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { cols.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    cols.push(current.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || '').trim(); });
    return obj;
  });
}

const content = fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, ''); // quitar BOM
const rows = parseCSV(content);

// Mapeo de categorías en español → catId interno
const CAT_MAP = {
  'procesadores': 'cpu', 'procesador': 'cpu', 'cpu': 'cpu',
  'tarjetas de video': 'gpu', 'tarjeta de video': 'gpu', 'gpu': 'gpu',
  'placas madre': 'mobo', 'placa madre': 'mobo', 'mobo': 'mobo', 'motherboard': 'mobo',
  'memorias ram': 'ram', 'memoria ram': 'ram', 'ram': 'ram',
  'almacenamiento': 'storage', 'storage': 'storage', 'ssd': 'storage', 'hdd': 'storage',
  'refrigeracion': 'cooling', 'refrigeración': 'cooling', 'cooling': 'cooling',
  'fuentes de poder': 'psu', 'fuente de poder': 'psu', 'psu': 'psu',
  'gabinetes': 'case', 'gabinete': 'case', 'case': 'case',
  'monitores': 'monitor', 'monitor': 'monitor',
  'perifericos': 'periph', 'periféricos': 'periph',
};

function resolveCat(raw) {
  const k = (raw || '').toLowerCase().trim();
  return CAT_MAP[k] || k || 'other';
}

// Construir entries válidas
const entries = [];
const stats = {};

for (const row of rows) {
  const storeId = (row.store_id || '').trim();
  const url     = (row.product  || '').trim();
  if (!storeId || !url || !url.startsWith('http')) continue;

  const stockRaw = (row.stock || row['stock'] || 'IN STOCK').toUpperCase();
  const stock    = stockRaw.includes('OUT') ? 'out_of_stock' : 'in_stock';
  const category = resolveCat(row.category || row['sub_category']);

  entries.push({
    store_id:   storeId,
    store_name: (row.store_name || storeId).trim(),
    category,
    sub:        (row['sub_category'] || '').trim(),
    url,
    stock,
  });

  if (!stats[storeId]) stats[storeId] = { in_stock: 0, out_of_stock: 0 };
  stats[storeId][stock]++;
}

fs.writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2), 'utf8');

console.log(`✅ Importado: ${entries.length} URLs → ${OUT_PATH}`);
console.log('');
console.log('Por tienda:');
for (const [sid, s] of Object.entries(stats)) {
  console.log(`  ${sid.padEnd(14)} ${s.in_stock} in_stock, ${s.out_of_stock} out_of_stock`);
}
console.log('');
console.log('Siguiente paso:');
console.log('  node scraper/url-scraper.js              # todas las tiendas');
console.log('  node scraper/url-scraper.js --store n1g  # solo N1G');
