/**
 * db/database.js
 * Singleton de conexión a SQLite compartido por toda la app.
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './db/techcompara.db';

let _db = null;

function getDb() {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

// ── Helpers de productos ──────────────────────────────────────────────────

function upsertProduct(product) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO products (external_id, category_id, brand, name, slug, image_url, specs, tags, updated_at)
    VALUES (@external_id, @category_id, @brand, @name, @slug, @image_url, @specs, @tags, datetime('now'))
    ON CONFLICT(external_id) DO UPDATE SET
      category_id = excluded.category_id,
      name       = excluded.name,
      image_url  = COALESCE(excluded.image_url, image_url),
      specs      = COALESCE(excluded.specs, specs),
      tags       = COALESCE(excluded.tags, tags),
      updated_at = datetime('now')
    RETURNING id
  `);
  return stmt.get(product);
}

// Cache: si la columna price_card existe en la tabla prices
let _hasPriceCard = null;
function hasPriceCard() {
  if (_hasPriceCard !== null) return _hasPriceCard;
  const cols = getDb().prepare("PRAGMA table_info(prices)").all();
  _hasPriceCard = cols.some(c => c.name === 'price_card');
  return _hasPriceCard;
}

function upsertPrice(price) {
  const db = getDb();
  let stmt;
  if (hasPriceCard()) {
    stmt = db.prepare(`
      INSERT INTO prices (product_id, store_id, price, price_card, price_normal, discount_pct, stock, product_url, price_date, scraped_at)
      VALUES (@product_id, @store_id, @price, @price_card, @price_normal, @discount_pct, @stock, @product_url, date('now'), datetime('now'))
      ON CONFLICT(product_id, store_id, price_date) DO UPDATE SET
        price        = excluded.price,
        price_card   = excluded.price_card,
        price_normal = excluded.price_normal,
        discount_pct = excluded.discount_pct,
        stock        = excluded.stock,
        product_url  = excluded.product_url,
        scraped_at   = datetime('now')
    `);
  } else {
    // Columna price_card no existe aún — insertar sin ella
    const { price_card, ...priceWithout } = price;
    price = priceWithout;
    stmt = db.prepare(`
      INSERT INTO prices (product_id, store_id, price, price_normal, discount_pct, stock, product_url, price_date, scraped_at)
      VALUES (@product_id, @store_id, @price, @price_normal, @discount_pct, @stock, @product_url, date('now'), datetime('now'))
      ON CONFLICT(product_id, store_id, price_date) DO UPDATE SET
        price        = excluded.price,
        price_normal = excluded.price_normal,
        discount_pct = excluded.discount_pct,
        stock        = excluded.stock,
        product_url  = excluded.product_url,
        scraped_at   = datetime('now')
    `);
  }
  return stmt.run(price);
}

function getLatestPrices(productId) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, s.name as store_name, s.url as store_url, s.full_url, s.rating
    FROM prices p
    JOIN stores s ON p.store_id = s.id
    WHERE p.product_id = ?
      AND date(p.scraped_at) = (
        SELECT MAX(date(scraped_at)) FROM prices WHERE product_id = ?
      )
    ORDER BY p.price ASC
  `).all(productId, productId);
}

function getAllProductsWithBestPrice(categoryId = null) {
  const db = getDb();
  let query = `
    SELECT 
      pr.*,
      MIN(p.price) as best_price,
      p.price_card as best_price_card,
      s.name as best_store_name,
      s.id as best_store_id,
      COUNT(DISTINCT p.store_id) as store_count
    FROM products pr
    LEFT JOIN prices p ON pr.id = p.product_id
      AND date(p.scraped_at) = (
        SELECT MAX(date(scraped_at)) FROM prices WHERE product_id = pr.id
      )
    LEFT JOIN stores s ON p.store_id = s.id
      AND p.price = (SELECT MIN(price) FROM prices WHERE product_id = pr.id AND date(scraped_at) = date(p.scraped_at))
    ${categoryId ? 'WHERE pr.category_id = ?' : ''}
    GROUP BY pr.id
    ORDER BY best_price ASC
  `;
  return categoryId
    ? db.prepare(query).all(categoryId)
    : db.prepare(query).all();
}

function logScrape(storeId, status, stats = {}) {
  const db = getDb();
  if (status === 'running') {
    const stmt = db.prepare(`
      INSERT INTO scrape_logs (store_id, status, started_at)
      VALUES (?, 'running', datetime('now'))
    `);
    return stmt.run(storeId).lastInsertRowid;
  } else {
    const stmt = db.prepare(`
      UPDATE scrape_logs SET
        status           = ?,
        products_found   = ?,
        products_updated = ?,
        errors_count     = ?,
        error_detail     = ?,
        duration_ms      = ?,
        finished_at      = datetime('now')
      WHERE id = ?
    `);
    return stmt.run(
      status,
      stats.found || 0,
      stats.updated || 0,
      stats.errors || 0,
      stats.errorDetail || null,
      stats.duration || 0,
      stats.logId
    );
  }
}

module.exports = { getDb, upsertProduct, upsertPrice, getLatestPrices, getAllProductsWithBestPrice, logScrape };
