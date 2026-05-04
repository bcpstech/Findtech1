/**
 * db/migrate-price-card.js
 * Migración: agrega columna price_card a la tabla prices si no existe.
 * Ejecutar una sola vez: node db/migrate-price-card.js
 */

require('dotenv').config();
const { getDb } = require('./database');

const db = getDb();

// Verificar si la columna ya existe
const cols = db.prepare("PRAGMA table_info(prices)").all();
const exists = cols.some(c => c.name === 'price_card');

if (exists) {
  console.log('✓ Columna price_card ya existe — nada que hacer.');
} else {
  db.prepare('ALTER TABLE prices ADD COLUMN price_card INTEGER').run();
  console.log('✓ Columna price_card agregada correctamente a la tabla prices.');
}
