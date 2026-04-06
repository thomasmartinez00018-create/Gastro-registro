#!/usr/bin/env node
// Standalone Express server for dev mode (runs WITHOUT Electron)
// Usage: node electron/dev-server.js

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

// Init database
const Database = require('better-sqlite3')
const userDataPath = path.join(require('os').homedir(), '.gestion-proveedores-dev')
if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true })
const dbPath = path.join(userDataPath, 'gestion_proveedores_dev.db')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

// Run same schema as main.js
db.exec(`
  CREATE TABLE IF NOT EXISTS productos (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT UNIQUE NOT NULL, producto TEXT NOT NULL, categoria TEXT, marca TEXT, unidad_base TEXT, contenido_unitario REAL, unidad_medida TEXT, presentacion_referencia TEXT, alias TEXT, codigos_maxirest TEXT, rubro_maxirest TEXT, activo INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS proveedores (id INTEGER PRIMARY KEY AUTOINCREMENT, id_proveedor TEXT UNIQUE NOT NULL, proveedor TEXT NOT NULL, contacto TEXT, whatsapp TEXT, email TEXT, observaciones TEXT, activo INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), descuento_pct REAL DEFAULT 0, aplica_iva INTEGER DEFAULT 0, aplica_percepcion INTEGER DEFAULT 0, impuesto_interno REAL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS listas (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, id_proveedor TEXT, proveedor TEXT, archivo_origen TEXT, producto_original TEXT, presentacion_original TEXT, tipo_compra TEXT DEFAULT 'UNIDAD', unidades_por_caja REAL DEFAULT 1, cantidad_por_unidad REAL, unidad_medida TEXT, precio_informado REAL, moneda TEXT DEFAULT 'ARS', observaciones TEXT, codigo_producto TEXT, estado_match TEXT DEFAULT 'PENDIENTE', precio_por_unidad REAL, precio_por_medida_base REAL, activo INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS equivalencias (id INTEGER PRIMARY KEY AUTOINCREMENT, id_proveedor TEXT, producto_original TEXT, presentacion_original TEXT, codigo_producto TEXT, comentarios TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS pedidos (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, restaurante TEXT, id_proveedor TEXT, proveedor TEXT NOT NULL, notas TEXT, total REAL, estado TEXT DEFAULT 'enviado', nro_orden TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS pedido_items (id INTEGER PRIMARY KEY AUTOINCREMENT, id_pedido INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE, codigo_producto TEXT, producto TEXT NOT NULL, cantidad REAL DEFAULT 1, unidad TEXT, precio_unitario REAL, subtotal REAL);
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', display_name TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
`)

// Migrations
const addCol = (table, col, def) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
}
addCol('productos', 'codigo_barras', 'TEXT')
addCol('productos', 'user_id', 'INTEGER DEFAULT 1')
addCol('proveedores', 'user_id', 'INTEGER DEFAULT 1')
addCol('listas', 'user_id', 'INTEGER DEFAULT 1')
addCol('equivalencias', 'user_id', 'INTEGER DEFAULT 1')
addCol('pedidos', 'user_id', 'INTEGER DEFAULT 1')

// Seed admin
const bcrypt = require('bcryptjs')
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin')
if (!adminExists) {
  const hash = bcrypt.hashSync('1234', 10)
  db.prepare('INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)').run('admin', hash, 'admin', 'Administrador')
  console.log('[dev-server] Admin user created (admin / 1234)')
}

// JWT secret
const secretPath = path.join(userDataPath, '.jwt_secret')
let JWT_SECRET
try { JWT_SECRET = fs.readFileSync(secretPath, 'utf8') }
catch { JWT_SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(secretPath, JWT_SECRET) }

// Start Express
const createServer = require('./server')
const app = createServer({ db, JWT_SECRET, distPath: null })

const PORT = 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[dev-server] API running on http://localhost:${PORT}`)
  console.log(`[dev-server] DB: ${dbPath}`)
})
