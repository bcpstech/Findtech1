/**
 * db/init.js
 * Inicializa la base de datos SQLite con todas las tablas necesarias.
 * Ejecutar: node db/init.js
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './db/techcompara.db';

// Crear carpeta si no existe
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// ── Activar WAL para mejor rendimiento en lecturas concurrentes
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- ── TIENDAS ──────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS stores (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL,
    full_url    TEXT NOT NULL,
    logo_url    TEXT,
    rating      REAL DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    description TEXT,
    shipping    TEXT,
    payment     TEXT,
    founded     TEXT,
    active      INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  -- ── CATEGORÍAS ───────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    icon        TEXT,
    parent_id   TEXT REFERENCES categories(id),
    sort_order  INTEGER DEFAULT 0
  );

  -- ── PRODUCTOS ────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id   TEXT UNIQUE,        -- ID del producto en la tienda origen
    category_id   TEXT REFERENCES categories(id),
    brand         TEXT NOT NULL,
    name          TEXT NOT NULL,
    slug          TEXT UNIQUE,
    image_url     TEXT,
    description   TEXT,
    specs         TEXT,               -- JSON con especificaciones técnicas
    tags          TEXT,               -- JSON array de etiquetas
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  );

  -- ── PRECIOS ──────────────────────────────────────────────────────────────
  -- Un registro por producto/tienda/fecha (histórico completo)
  CREATE TABLE IF NOT EXISTS prices (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id    INTEGER REFERENCES products(id) ON DELETE CASCADE,
    store_id      TEXT REFERENCES stores(id),
    price         INTEGER NOT NULL,   -- Precio en CLP (sin decimales)
    price_normal  INTEGER,            -- Precio normal si hay oferta
    discount_pct  INTEGER,            -- % descuento calculado
    currency      TEXT DEFAULT 'CLP',
    stock         TEXT DEFAULT 'unknown', -- 'in_stock','low_stock','out_of_stock','unknown'
    product_url   TEXT,               -- URL directa al producto en la tienda
    price_date    TEXT,
    scraped_at    TEXT DEFAULT (datetime('now')),
    UNIQUE(product_id, store_id, price_date)  -- Un precio por día por tienda
  );

  -- ── SCRAPING LOGS ────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS scrape_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id      TEXT REFERENCES stores(id),
    status        TEXT NOT NULL,      -- 'running','success','partial','failed'
    products_found  INTEGER DEFAULT 0,
    products_updated INTEGER DEFAULT 0,
    errors_count  INTEGER DEFAULT 0,
    error_detail  TEXT,
    duration_ms   INTEGER,
    started_at    TEXT DEFAULT (datetime('now')),
    finished_at   TEXT
  );

  -- ── ÍNDICES ──────────────────────────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_prices_product ON prices(product_id);
  CREATE INDEX IF NOT EXISTS idx_prices_store ON prices(store_id);
  CREATE INDEX IF NOT EXISTS idx_prices_date ON prices(date(scraped_at));
  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
  CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
`);

// ── INSERTAR DATOS INICIALES ──────────────────────────────────────────────

const insertStore = db.prepare(`
  INSERT OR REPLACE INTO stores (id, name, url, full_url, rating, review_count, description, shipping, payment, founded)
  VALUES (@id, @name, @url, @full_url, @rating, @review_count, @description, @shipping, @payment, @founded)
`);

const stores = [
  { id:'n1g',         name:'N1G',         url:'www.n1g.cl',                    full_url:'https://www.n1g.cl',                rating:0, review_count:0, description:'Tienda especializada en componentes gaming y hardware.',                    shipping:'24-48 hrs', payment:'Débito, Crédito, Transferencia', founded:'2015' },
  { id:'alltec',      name:'Alltec',       url:'www.alltec.cl',                 full_url:'https://www.alltec.cl',             rating:0, review_count:0, description:'Gran variedad de componentes y precios competitivos.',                      shipping:'24-72 hrs', payment:'Todos los medios',                founded:'2010' },
  { id:'cg',          name:'CentralGamer', url:'www.centralgamer.cl',           full_url:'https://www.centralgamer.cl',       rating:0, review_count:0, description:'Especialistas en gaming, periféricos y PCs armadas.',                       shipping:'48-72 hrs', payment:'Débito, Crédito, WebPay',        founded:'2017' },
  { id:'centrale',    name:'Centrale',     url:'www.centrale.cl',               full_url:'https://www.centrale.cl',           rating:0, review_count:0, description:'Gran variedad de productos con buenos precios en RAM y almacenamiento.',    shipping:'24-48 hrs', payment:'Todos los medios',                founded:'2012' },
  { id:'pcexpress',   name:'PC-Express',   url:'tienda.pc-express.cl',          full_url:'https://tienda.pc-express.cl',      rating:0, review_count:0, description:'Especialistas en armado de PCs a medida.',                                 shipping:'48-96 hrs', payment:'Transferencia, Débito, Crédito',  founded:'2014' },
  { id:'spdigital',   name:'SP Digital',   url:'www.spdigital.cl',              full_url:'https://www.spdigital.cl',          rating:0, review_count:0, description:'Tienda online con amplia variedad de componentes y periféricos.',           shipping:'24-72 hrs', payment:'Todos los medios',                founded:'2016' },
  { id:'myshop',      name:'MyShop',       url:'www.myshop.cl',                 full_url:'https://www.myshop.cl',             rating:0, review_count:0, description:'Tienda de tecnología con buena variedad de hardware.',                      shipping:'24-72 hrs', payment:'Todos los medios',                founded:'2014' },
  { id:'progaming',   name:'ProGaming',    url:'www.progaming.cl',              full_url:'https://www.progaming.cl',          rating:0, review_count:0, description:'Especialistas en hardware y periféricos gaming.',                           shipping:'24-72 hrs', payment:'Todos los medios',                founded:'2018' },
  { id:'dust2',       name:'Dust2',        url:'www.dust2.gg',                  full_url:'https://www.dust2.gg',              rating:0, review_count:0, description:'Tienda gamer con componentes y periféricos de alto rendimiento.',           shipping:'24-72 hrs', payment:'Todos los medios',                founded:'2019' },
  { id:'tytgamer',    name:'TYT Gamer',    url:'www.tytgamer.cl',               full_url:'https://www.tytgamer.cl',           rating:0, review_count:0, description:'Hardware y accesorios gaming a precios competitivos.',                      shipping:'24-72 hrs', payment:'Todos los medios',                founded:'2018' },
  { id:'mybox',       name:'MyBox',        url:'www.mybox.cl',                  full_url:'https://www.mybox.cl',              rating:0, review_count:0, description:'Tienda de tecnología con componentes y periféricos.',                       shipping:'24-72 hrs', payment:'Todos los medios',                founded:'2017' },
  { id:'megabytes',   name:'MegaBytes',    url:'www.megabytes.cl',              full_url:'https://www.megabytes.cl',          rating:0, review_count:0, description:'Componentes y accesorios para PC a buen precio.',                          shipping:'24-72 hrs', payment:'Todos los medios',                founded:'2015' },
  { id:'sandos',      name:'Sandos',       url:'www.sandos.cl',                 full_url:'https://www.sandos.cl',             rating:0, review_count:0, description:'Tienda de hardware y tecnología en Chile.',                                 shipping:'24-72 hrs', payment:'Todos los medios',                founded:'2016' },
  { id:'trulustore',  name:'TruluStore',   url:'www.trulustore.cl',             full_url:'https://www.trulustore.cl',         rating:0, review_count:0, description:'Componentes PC y accesorios gaming.',                                      shipping:'24-72 hrs', payment:'Todos los medios',                founded:'2019' },
  { id:'winpy',       name:'Winpy',        url:'www.winpy.cl',                  full_url:'https://www.winpy.cl',              rating:0, review_count:0, description:'Una de las tiendas más completas de hardware en Chile.',                   shipping:'24-48 hrs', payment:'Todos los medios',                founded:'2008' },
  { id:'sipo',        name:'Sipo',         url:'sipo.cl',                       full_url:'https://sipo.cl',                   rating:0, review_count:0, description:'Tecnología y componentes PC en Chile.',                                    shipping:'24-72 hrs', payment:'Todos los medios',                founded:'2015' },
  { id:'megadrive',   name:'MegaDrive',    url:'www.megadrivestore.cl',          full_url:'https://www.megadrivestore.cl',      rating:0, review_count:0, description:'Hardware, componentes y accesorios para PC.',                              shipping:'24-72 hrs', payment:'Todos los medios',                founded:'2014' },
  { id:'infor-ingen', name:'Infor-Ingen',  url:'store.infor-ingen.com',         full_url:'https://store.infor-ingen.com',     rating:0, review_count:0, description:'Tienda de tecnología e informática.',                                      shipping:'24-72 hrs', payment:'Todos los medios',                founded:'2010' },
  { id:'bcpstech',    name:'BCPS Tech',    url:'www.bcpstech.cl',               full_url:'https://bcpstech.cl',               rating:0, review_count:0, description:'Tienda gamer con componentes PC y periféricos.',                            shipping:'24-72 hrs', payment:'Transferencia, Débito, Crédito',  founded:'2026' },
];

const insertCategory = db.prepare(`
  INSERT OR REPLACE INTO categories (id, name, icon, parent_id, sort_order)
  VALUES (@id, @name, @icon, @parent_id, @sort_order)
`);

const categories = [
  { id:'gpu',      name:'Tarjetas Gráficas', icon:'🎮', parent_id:null, sort_order:1 },
  { id:'cpu',      name:'Procesadores',      icon:'⚡', parent_id:null, sort_order:2 },
  { id:'ram',      name:'Memorias RAM',      icon:'💾', parent_id:null, sort_order:3 },
  { id:'storage',  name:'Almacenamiento',    icon:'💿', parent_id:null, sort_order:4 },
  { id:'cooling',  name:'Refrigeración',     icon:'❄️', parent_id:null, sort_order:5 },
  { id:'mobo',     name:'Placas Madre',      icon:'🔌', parent_id:null, sort_order:6 },
  { id:'psu',      name:'Fuentes de Poder',  icon:'⚙️', parent_id:null, sort_order:7 },
  { id:'case',     name:'Gabinetes',         icon:'🖥️', parent_id:null, sort_order:8 },
  { id:'monitor',  name:'Monitores',         icon:'🖱️', parent_id:null, sort_order:9 },
  { id:'periph',   name:'Periféricos',       icon:'⌨️', parent_id:null, sort_order:10 },
  { id:'pc',       name:'PCs Armados',        icon:'🖥️', parent_id:null, sort_order:11 },
  // Subcategorías GPU
  { id:'gpu-nvidia', name:'NVIDIA GeForce RTX', icon:'🎮', parent_id:'gpu', sort_order:1 },
  { id:'gpu-amd',    name:'AMD Radeon RX',       icon:'🎮', parent_id:'gpu', sort_order:2 },
  // Subcategorías CPU
  { id:'cpu-intel',  name:'Intel Core Ultra',    icon:'⚡', parent_id:'cpu', sort_order:1 },
  { id:'cpu-amd',    name:'AMD Ryzen',            icon:'⚡', parent_id:'cpu', sort_order:2 },
  // Subcategorías RAM
  { id:'ram-ddr5',   name:'DDR5',                icon:'💾', parent_id:'ram', sort_order:1 },
  { id:'ram-ddr4',   name:'DDR4',                icon:'💾', parent_id:'ram', sort_order:2 },
  // Subcategorías Storage
  { id:'ssd-nvme',   name:'NVMe M.2 PCIe 5.0/4.0', icon:'💿', parent_id:'storage', sort_order:1 },
  { id:'ssd-sata',   name:'SSD SATA',            icon:'💿', parent_id:'storage', sort_order:2 },
  { id:'hdd',        name:'HDD',                 icon:'💿', parent_id:'storage', sort_order:3 },
  // Refrigeración subcategorías
  { id:'cooling_liquida',  name:'Refrigeración Líquida', icon:'💧', parent_id:'cooling', sort_order:1 },
  { id:'cooling_aire',     name:'Por Aire',               icon:'🌬️', parent_id:'cooling', sort_order:2 },
  { id:'cooling_fans',     name:'Ventiladores',           icon:'🌀', parent_id:'cooling', sort_order:3 },
  { id:'cooling_pasta',    name:'Pastas Térmicas',        icon:'🧪', parent_id:'cooling', sort_order:4 },
  // Gabinetes subcategorías
  { id:'case_eatx',        name:'Extended ATX',           icon:'🖥️', parent_id:'case', sort_order:1 },
  { id:'case_atx',         name:'ATX',                    icon:'🖥️', parent_id:'case', sort_order:2 },
  { id:'case_matx',        name:'Micro ATX',              icon:'🖥️', parent_id:'case', sort_order:3 },
  { id:'case_itx',         name:'Mini ITX',               icon:'🖥️', parent_id:'case', sort_order:4 },
  { id:'case_accesorio',   name:'Accesorios',             icon:'🔧', parent_id:'case', sort_order:5 },
];

const runInserts = db.transaction(() => {
  stores.forEach(s => insertStore.run(s));
  categories.forEach(c => insertCategory.run(c));
});

runInserts();

console.log('✅ Base de datos inicializada correctamente en:', DB_PATH);
console.log('   Tablas: stores, categories, products, prices, scrape_logs');
console.log('   Tiendas insertadas:', stores.length);
console.log('   Categorías insertadas:', categories.length);

db.close();
