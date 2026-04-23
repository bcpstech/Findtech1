/**
 * api/server.js
 * API REST que el frontend consume para obtener productos y precios.
 *
 * Endpoints:
 *   GET /api/categories          — todas las categorías
 *   GET /api/stores              — todas las tiendas
 *   GET /api/products            — lista con filtros y paginación
 *   GET /api/products/:id        — detalle con precios por tienda
 *   GET /api/products/search     — búsqueda por texto
 *   GET /api/status              — estado del último scraping
 *   POST /api/scrape             — disparar scraping manual (con token)
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { getDb, logScrape } = require('../db/database');
const logger  = require('../scraper/logger');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Logger de requests ────────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`, { query: req.query });
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────
function ok(res, data)   { res.json({ success: true,  data }); }
function err(res, msg, code = 400) { res.status(code).json({ success: false, error: msg }); }

// ═════════════════════════════════════════════════════════════════════════
// CATEGORÍAS
// ═════════════════════════════════════════════════════════════════════════
app.get('/api/categories', (_req, res) => {
  try {
    const db = getDb();
    const cats = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count
      FROM categories c
      WHERE c.parent_id IS NULL
      ORDER BY c.sort_order
    `).all();

    // Agregar subcategorías
    const withSubs = cats.map(cat => ({
      ...cat,
      subcategories: db.prepare(`
        SELECT * FROM categories WHERE parent_id = ? ORDER BY sort_order
      `).all(cat.id)
    }));

    ok(res, withSubs);
  } catch (e) {
    err(res, e.message, 500);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// TIENDAS
// ═════════════════════════════════════════════════════════════════════════
app.get('/api/stores', (_req, res) => {
  try {
    const db = getDb();
    const stores = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(DISTINCT p.product_id)
         FROM prices p WHERE p.store_id = s.id
           AND date(p.scraped_at) = (SELECT MAX(date(scraped_at)) FROM prices WHERE store_id = s.id)
        ) as products_today,
        (SELECT MAX(scraped_at) FROM prices p WHERE p.store_id = s.id) as last_scraped
      FROM stores s
      WHERE s.active = 1
      ORDER BY s.rating DESC
    `).all();
    ok(res, stores);
  } catch (e) {
    err(res, e.message, 500);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// PRODUCTOS — lista con filtros
// ═════════════════════════════════════════════════════════════════════════
app.get('/api/products', (req, res) => {
  try {
    const db = getDb();
    const {
      category,
      brand,
      store,
      min_price,
      max_price,
      q,
      sort    = 'price_asc',
      page    = 1,
      limit   = 24,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Construir WHERE dinámicamente
    const wheres = ['1=1'];
    const params = [];

    if (category) { wheres.push('pr.category_id = ?'); params.push(category); }
    if (brand)    { wheres.push('pr.brand = ?');       params.push(brand);    }
    if (q)        { wheres.push('(pr.name LIKE ? OR pr.brand LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    if (min_price){ wheres.push('best_price >= ?'); params.push(parseInt(min_price)); }
    if (max_price){ wheres.push('best_price <= ?'); params.push(parseInt(max_price)); }

    const ORDER = {
      price_asc:    'best_price ASC',
      price_desc:   'best_price DESC',
      name_asc:     'pr.name ASC',
      newest:       'pr.created_at DESC',
    };
    const orderBy = ORDER[sort] || ORDER.price_asc;

    // Subconsulta para mejor precio del día
    const baseQuery = `
      FROM products pr
      LEFT JOIN (
        SELECT
          p.product_id,
          MIN(p.price) as best_price,
          s.name       as best_store_name,
          s.id         as best_store_id,
          COUNT(DISTINCT p.store_id) as store_count
        FROM prices p
        JOIN stores s ON s.id = p.store_id
        WHERE date(p.scraped_at) = (SELECT MAX(date(scraped_at)) FROM prices)
        GROUP BY p.product_id
        HAVING p.price = MIN(p.price)
      ) bp ON bp.product_id = pr.id
      ${store ? 'JOIN prices pf ON pf.product_id = pr.id AND pf.store_id = ?' : ''}
      WHERE ${wheres.join(' AND ')}
    `;
    if (store) params.unshift(store);

    const total = db.prepare(`SELECT COUNT(*) as cnt ${baseQuery}`).get(...params)?.cnt || 0;
    const items = db.prepare(`
      SELECT pr.*, bp.best_price, bp.best_store_name, bp.best_store_id, bp.store_count
      ${baseQuery}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    // Parsear specs/tags JSON
    const parsed = items.map(p => ({
      ...p,
      specs: p.specs ? JSON.parse(p.specs) : null,
      tags:  p.tags  ? JSON.parse(p.tags)  : [],
    }));

    ok(res, {
      items: parsed,
      total,
      page:  parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (e) {
    err(res, e.message, 500);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// PRODUCTO — detalle con precios por tienda
// ═════════════════════════════════════════════════════════════════════════
app.get('/api/products/:id', (req, res) => {
  try {
    const db = getDb();
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) return err(res, 'Producto no encontrado', 404);

    // Precios del día ordenados por precio ASC
    const latestDate = db.prepare(
      'SELECT MAX(date(scraped_at)) as d FROM prices WHERE product_id = ?'
    ).get(req.params.id)?.d;

    const prices = db.prepare(`
      SELECT p.*, s.name as store_name, s.url as store_url, s.full_url,
             s.rating as store_rating, s.review_count
      FROM prices p
      JOIN stores s ON s.id = p.store_id
      WHERE p.product_id = ? AND date(p.scraped_at) = ?
      ORDER BY p.price ASC
    `).all(req.params.id, latestDate);

    // Historial de precios (últimos 30 días) por tienda
    const history = db.prepare(`
      SELECT p.store_id, s.name as store_name, date(p.scraped_at) as date, MIN(p.price) as price
      FROM prices p
      JOIN stores s ON s.id = p.store_id
      WHERE p.product_id = ?
        AND p.scraped_at >= datetime('now', '-30 days')
      GROUP BY p.store_id, date(p.scraped_at)
      ORDER BY date ASC
    `).all(req.params.id);

    ok(res, {
      ...product,
      specs:   product.specs ? JSON.parse(product.specs) : null,
      tags:    product.tags  ? JSON.parse(product.tags)  : [],
      prices,
      history,
      scraped_at: latestDate,
    });
  } catch (e) {
    err(res, e.message, 500);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// BÚSQUEDA
// ═════════════════════════════════════════════════════════════════════════
app.get('/api/search', (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    if (!q || q.length < 2) return ok(res, []);

    const db = getDb();
    const results = db.prepare(`
      SELECT pr.id, pr.brand, pr.name, pr.category_id, pr.image_url,
             MIN(p.price) as best_price
      FROM products pr
      LEFT JOIN prices p ON p.product_id = pr.id
        AND date(p.scraped_at) = (SELECT MAX(date(scraped_at)) FROM prices)
      WHERE pr.name LIKE ? OR pr.brand LIKE ?
      GROUP BY pr.id
      ORDER BY best_price ASC
      LIMIT ?
    `).all(`%${q}%`, `%${q}%`, parseInt(limit));

    ok(res, results);
  } catch (e) {
    err(res, e.message, 500);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// ESTADO DEL SCRAPER
// ═════════════════════════════════════════════════════════════════════════
app.get('/api/status', (_req, res) => {
  try {
    const db = getDb();

    const lastRun = db.prepare(`
      SELECT * FROM scrape_logs ORDER BY started_at DESC LIMIT 5
    `).all();

    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM products) as total_products,
        (SELECT COUNT(*) FROM stores WHERE active = 1) as total_stores,
        (SELECT MAX(scraped_at) FROM prices) as last_price_update,
        (SELECT COUNT(*) FROM prices WHERE date(scraped_at) = date('now')) as prices_today
    `).get();

    ok(res, { lastRun, stats });
  } catch (e) {
    err(res, e.message, 500);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// DISPARAR SCRAPING MANUAL (requiere token)
// ═════════════════════════════════════════════════════════════════════════
app.post('/api/scrape', async (req, res) => {
  const token = req.headers['x-scrape-token'];
  if (!process.env.SCRAPE_SECRET || token !== process.env.SCRAPE_SECRET) {
    return err(res, 'No autorizado', 401);
  }

  // Responder inmediatamente, ejecutar en background
  ok(res, { message: 'Scraping iniciado en background' });

  const runAll = require('../scraper/run-all');
  runAll().catch(e => logger.error('Error en scraping manual:', e));
});

// ═════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═════════════════════════════════════════════════════════════════════════
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Iniciar servidor ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 API TechCompara escuchando en http://localhost:${PORT}`);
  logger.info(`   Endpoints disponibles:`);
  logger.info(`   GET  /api/categories`);
  logger.info(`   GET  /api/stores`);
  logger.info(`   GET  /api/products?category=gpu&sort=price_asc`);
  logger.info(`   GET  /api/products/:id`);
  logger.info(`   GET  /api/search?q=rtx`);
  logger.info(`   GET  /api/status`);
  logger.info(`   POST /api/scrape  (requiere x-scrape-token)`);
});

module.exports = app;
