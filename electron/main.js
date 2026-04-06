const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// ── Mini servidor HTTP local para producción ──────────────────────────────────
// Sirve los archivos de dist/ sobre http://localhost:<puerto>
// Esto evita todas las restricciones de file:// (ES module workers de PDF.js, etc.)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
}

const createServer = require('./server')

function startLocalServer(distPath) {
  return new Promise((resolve, reject) => {
    const expressApp = createServer({ db, JWT_SECRET, distPath })
    const LAN_PORT = 3001
    const server = expressApp.listen(LAN_PORT, '0.0.0.0', () => {
      global.__lanPort = LAN_PORT
      console.log(`[Express] LAN server listening on 0.0.0.0:${LAN_PORT}`)
      resolve(LAN_PORT)
    })
    server.on('error', (err) => {
      console.error('[Express] Error al iniciar servidor LAN:', err.message)
      reject(err)
    })
  })
}

// ─── Database setup ───────────────────────────────────────────────────────────
let db
function initDB() {
  const Database = require('better-sqlite3')
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'gestion_proveedores.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT UNIQUE NOT NULL,
      producto TEXT NOT NULL,
      categoria TEXT,
      marca TEXT,
      unidad_base TEXT,
      contenido_unitario REAL,
      unidad_medida TEXT,
      presentacion_referencia TEXT,
      alias TEXT,
      codigos_maxirest TEXT,
      rubro_maxirest TEXT,
      activo INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS proveedores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_proveedor TEXT UNIQUE NOT NULL,
      proveedor TEXT NOT NULL,
      contacto TEXT,
      whatsapp TEXT,
      email TEXT,
      observaciones TEXT,
      activo INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS listas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT,
      id_proveedor TEXT,
      proveedor TEXT,
      archivo_origen TEXT,
      producto_original TEXT,
      presentacion_original TEXT,
      tipo_compra TEXT DEFAULT 'UNIDAD',
      unidades_por_caja REAL DEFAULT 1,
      cantidad_por_unidad REAL,
      unidad_medida TEXT,
      precio_informado REAL,
      moneda TEXT DEFAULT 'ARS',
      observaciones TEXT,
      codigo_producto TEXT,
      estado_match TEXT DEFAULT 'PENDIENTE',
      precio_por_unidad REAL,
      precio_por_medida_base REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS equivalencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_proveedor TEXT,
      producto_original TEXT,
      presentacion_original TEXT,
      codigo_producto TEXT,
      comentarios TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)

  // Pedidos y su historial
  db.exec(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha       TEXT NOT NULL,
      restaurante TEXT,
      id_proveedor TEXT,
      proveedor   TEXT NOT NULL,
      notas       TEXT,
      total       REAL,
      estado      TEXT DEFAULT 'enviado',
      nro_orden   TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pedido_items (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      id_pedido       INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      codigo_producto TEXT,
      producto        TEXT NOT NULL,
      cantidad        REAL DEFAULT 1,
      unidad          TEXT,
      precio_unitario REAL,
      subtotal        REAL
    );
  `)

  // Tabla de activación / licencia
  db.exec(`
    CREATE TABLE IF NOT EXISTS activation (
      id          INTEGER PRIMARY KEY,
      cliente_id  TEXT NOT NULL,
      activated_at TEXT DEFAULT (datetime('now')),
      active      INTEGER DEFAULT 1
    );
  `)

  // Migrations for existing DBs
  const cols = db.prepare("PRAGMA table_info(productos)").all().map(c => c.name)
  if (!cols.includes('codigos_maxirest')) db.exec("ALTER TABLE productos ADD COLUMN codigos_maxirest TEXT")
  if (!cols.includes('rubro_maxirest'))   db.exec("ALTER TABLE productos ADD COLUMN rubro_maxirest TEXT")
  if (!cols.includes('codigo_barras')) db.exec("ALTER TABLE productos ADD COLUMN codigo_barras TEXT")
  // Listas versioning
  const listasCols = db.prepare("PRAGMA table_info(listas)").all().map(c => c.name)
  if (!listasCols.includes('activo')) db.exec("ALTER TABLE listas ADD COLUMN activo INTEGER DEFAULT 1")
  // Proveedores: descuentos e impuestos
  const provCols = db.prepare("PRAGMA table_info(proveedores)").all().map(c => c.name)
  if (!provCols.includes('descuento_pct'))     db.exec("ALTER TABLE proveedores ADD COLUMN descuento_pct REAL DEFAULT 0")
  if (!provCols.includes('aplica_iva'))        db.exec("ALTER TABLE proveedores ADD COLUMN aplica_iva INTEGER DEFAULT 0")
  if (!provCols.includes('aplica_percepcion')) db.exec("ALTER TABLE proveedores ADD COLUMN aplica_percepcion INTEGER DEFAULT 0")
  if (!provCols.includes('impuesto_interno'))  db.exec("ALTER TABLE proveedores ADD COLUMN impuesto_interno REAL DEFAULT 0")

  // ── Users table ──────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      display_name TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)

  // Seed admin user if not exists
  const bcrypt = require('bcryptjs')
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin')
  if (!adminExists) {
    const hash = bcrypt.hashSync('1234', 10)
    db.prepare('INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)').run('admin', hash, 'admin', 'Administrador')
  }

  // Add user_id to data tables (default 1 = admin owns all legacy data)
  if (!cols.includes('user_id')) db.exec("ALTER TABLE productos ADD COLUMN user_id INTEGER DEFAULT 1")
  if (!listasCols.includes('user_id')) db.exec("ALTER TABLE listas ADD COLUMN user_id INTEGER DEFAULT 1")
  if (!provCols.includes('user_id')) db.exec("ALTER TABLE proveedores ADD COLUMN user_id INTEGER DEFAULT 1")
  const equivCols = db.prepare("PRAGMA table_info(equivalencias)").all().map(c => c.name)
  if (!equivCols.includes('user_id')) db.exec("ALTER TABLE equivalencias ADD COLUMN user_id INTEGER DEFAULT 1")
  const pedidosCols = db.prepare("PRAGMA table_info(pedidos)").all().map(c => c.name)
  if (!pedidosCols.includes('user_id')) db.exec("ALTER TABLE pedidos ADD COLUMN user_id INTEGER DEFAULT 1")
}

// ─── Auth / JWT ──────────────────────────────────────────────────────────────
const crypto = require('crypto')
const jwt = require('jsonwebtoken')

// JWT secret — generado una vez, persistido en userData
function getJwtSecret() {
  const secretPath = path.join(app.getPath('userData'), '.jwt_secret')
  try { return fs.readFileSync(secretPath, 'utf8') }
  catch { const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(secretPath, s); return s }
}
let JWT_SECRET
let currentUser = null // usuario autenticado en Electron (desktop)

// ─── Licencias ────────────────────────────────────────────────────────────────
// Clave secreta del desarrollador — NO compartir con clientes
const LIC_SECRET = 'g4str0_prv_#8xKmP!2024'

function buildKey(clienteId) {
  return crypto
    .createHmac('sha256', LIC_SECRET)
    .update(clienteId.toLowerCase().trim().replace(/\s+/g, ''))
    .digest('hex')
    .slice(0, 16)
    .toUpperCase()
    .match(/.{4}/g)
    .join('-')
}

// Consultar si la app está activada
ipcMain.handle('license:check', () => {
  const row = db.prepare('SELECT * FROM activation WHERE active = 1').get()
  return { activated: !!row, cliente: row?.cliente_id || null }
})

// Activar con clave
ipcMain.handle('license:activate', (_, { key, clienteId }) => {
  const expected = buildKey(clienteId)
  const input    = (key || '').toUpperCase().replace(/[\s-]/g, '').match(/.{4}/g)?.join('-') || ''
  if (input !== expected) return { ok: false, error: 'Clave de licencia inválida. Verificá el nombre exacto del cliente.' }
  db.prepare(`INSERT OR REPLACE INTO activation (id, cliente_id, activated_at, active) VALUES (1, ?, datetime('now'), 1)`)
    .run(clienteId.trim())
  return { ok: true }
})

// Desactivar (para el desarrollador — reset de licencia)
ipcMain.handle('license:deactivate', () => {
  db.prepare('UPDATE activation SET active = 0').run()
  return true
})

// Generar clave (SOLO en modo desarrollo — el desarrollador usa esto)
ipcMain.handle('license:generate', (_, clienteId) => {
  if (!isDev) return null
  return buildKey(clienteId)
})

// ─── Auth IPC ────────────────────────────────────────────────────────────────
ipcMain.handle('auth:login', (_, { username, password }) => {
  const bcrypt = require('bcryptjs')
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username)
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return { ok: false, error: 'Usuario o contraseña incorrectos' }
  }
  const token = jwt.sign({ userId: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '30d' })
  currentUser = { id: user.id, username: user.username, role: user.role, display_name: user.display_name }
  return { ok: true, token, user: currentUser }
})

ipcMain.handle('auth:validate', (_, token) => {
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = db.prepare('SELECT id, username, role, display_name FROM users WHERE id = ? AND active = 1').get(payload.userId)
    if (!user) return { ok: false }
    currentUser = user
    return { ok: true, user }
  } catch { return { ok: false } }
})

ipcMain.handle('auth:logout', () => { currentUser = null; return { ok: true } })

// ─── Users IPC (admin only) ─────────────────────────────────────────────────
ipcMain.handle('users:getAll', () => {
  if (!currentUser || currentUser.role !== 'admin') return []
  return db.prepare('SELECT id, username, role, display_name, active, created_at FROM users ORDER BY id').all()
})

ipcMain.handle('users:create', (_, { username, password, role, display_name }) => {
  if (!currentUser || currentUser.role !== 'admin') throw new Error('No autorizado')
  const bcrypt = require('bcryptjs')
  const hash = bcrypt.hashSync(password, 10)
  const r = db.prepare('INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)').run(username, hash, role || 'user', display_name || username)
  return { id: r.lastInsertRowid, username, role: role || 'user', display_name: display_name || username }
})

ipcMain.handle('users:update', (_, { id, username, role, display_name, password }) => {
  if (!currentUser || currentUser.role !== 'admin') throw new Error('No autorizado')
  if (password) {
    const bcrypt = require('bcryptjs')
    const hash = bcrypt.hashSync(password, 10)
    db.prepare('UPDATE users SET username=?, role=?, display_name=?, password_hash=? WHERE id=?').run(username, role, display_name, hash, id)
  } else {
    db.prepare('UPDATE users SET username=?, role=?, display_name=? WHERE id=?').run(username, role, display_name, id)
  }
  return { ok: true }
})

ipcMain.handle('users:delete', (_, id) => {
  if (!currentUser || currentUser.role !== 'admin') throw new Error('No autorizado')
  if (id === 1) throw new Error('No se puede eliminar el administrador principal')
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id)
  return { ok: true }
})

// ─── Network info ────────────────────────────────────────────────────────────
ipcMain.handle('network:getInfo', () => {
  const os = require('os')
  const interfaces = os.networkInterfaces()
  const addresses = []
  for (const iface of Object.values(interfaces)) {
    for (const info of iface) {
      if ((info.family === 'IPv4' || info.family === 4) && !info.internal) addresses.push(info.address)
    }
  }
  const port = global.__lanPort || 3001
  return { addresses, port, url: addresses.length ? `http://${addresses[0]}:${port}` : null }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────
const UNIT_MAP = {
  'kilo': 'kg', 'kilos': 'kg', 'kg': 'kg',
  'litro': 'litro', 'litros': 'litro',
  'uni': 'unidad', 'unid': 'unidad', 'unida': 'unidad', 'unidad': 'unidad', 'und': 'unidad', 'u': 'unidad',
  'balde': 'balde', 'bald': 'balde',
  'caja': 'caja', 'cajon': 'caja',
  'bolsa': 'bolsa', 'lata': 'lata', 'bidon': 'bidon', 'bulto': 'bulto',
  'pack': 'pack', 'paq': 'pack', 'paque': 'pack',
  'gramo': 'gramo', 'gr': 'gramo',
  'doc': 'docena', 'rollo': 'rollo', 'metro': 'metro', 'ml': 'ml',
}
function normalizeUnit(u) {
  if (!u) return ''
  return UNIT_MAP[u.trim().toLowerCase()] || u.trim().toLowerCase()
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

// ── Helper: filtrado por usuario ─────────────────────────────────────────────
function isAdmin() { return currentUser && currentUser.role === 'admin' }
function userId() { return currentUser?.id || 1 }

// Productos
ipcMain.handle('productos:getAll', () => {
  if (isAdmin()) return db.prepare('SELECT * FROM productos ORDER BY categoria, producto').all()
  return db.prepare('SELECT * FROM productos WHERE user_id = ? ORDER BY categoria, producto').all(userId())
})
ipcMain.handle('productos:create', (_, p) => {
  try {
    const stmt = db.prepare(`INSERT OR IGNORE INTO productos (codigo,producto,categoria,marca,unidad_base,contenido_unitario,unidad_medida,presentacion_referencia,alias,codigos_maxirest,rubro_maxirest,activo,codigo_barras,user_id)
      VALUES (@codigo,@producto,@categoria,@marca,@unidad_base,@contenido_unitario,@unidad_medida,@presentacion_referencia,@alias,@codigos_maxirest,@rubro_maxirest,@activo,@codigo_barras,@user_id)`)
    const r = stmt.run({ ...p, user_id: userId() })
    // Si fue ignorado (ya existía), devolvemos el registro existente sin error
    if (r.changes === 0) {
      const existing = db.prepare('SELECT * FROM productos WHERE codigo = ?').get(p.codigo)
      return existing || { ...p }
    }
    return { id: r.lastInsertRowid, ...p, user_id: userId() }
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      const existing = db.prepare('SELECT * FROM productos WHERE codigo = ?').get(p.codigo)
      return existing || { ...p }
    }
    throw err
  }
})
ipcMain.handle('productos:update', (_, p) => {
  db.prepare(`UPDATE productos SET codigo=@codigo,producto=@producto,categoria=@categoria,marca=@marca,unidad_base=@unidad_base,
    contenido_unitario=@contenido_unitario,unidad_medida=@unidad_medida,presentacion_referencia=@presentacion_referencia,
    alias=@alias,codigos_maxirest=@codigos_maxirest,rubro_maxirest=@rubro_maxirest,activo=@activo,codigo_barras=@codigo_barras
    WHERE id=@id`).run(p)
  return p
})
ipcMain.handle('productos:delete', (_, id) => {
  db.prepare('DELETE FROM productos WHERE id=?').run(id)
  return true
})

// Proveedores
ipcMain.handle('proveedores:getAll', () => {
  if (isAdmin()) return db.prepare('SELECT * FROM proveedores ORDER BY proveedor').all()
  return db.prepare('SELECT * FROM proveedores WHERE user_id = ? ORDER BY proveedor').all(userId())
})
ipcMain.handle('proveedores:create', (_, p) => {
  const stmt = db.prepare(`INSERT INTO proveedores
    (id_proveedor,proveedor,contacto,whatsapp,email,observaciones,activo,descuento_pct,aplica_iva,aplica_percepcion,impuesto_interno,user_id)
    VALUES (@id_proveedor,@proveedor,@contacto,@whatsapp,@email,@observaciones,@activo,@descuento_pct,@aplica_iva,@aplica_percepcion,@impuesto_interno,@user_id)`)
  const r = stmt.run({ ...p, user_id: userId() })
  return { id: r.lastInsertRowid, ...p }
})
ipcMain.handle('proveedores:update', (_, p) => {
  db.prepare(`UPDATE proveedores SET
    id_proveedor=@id_proveedor, proveedor=@proveedor, contacto=@contacto,
    whatsapp=@whatsapp, email=@email, observaciones=@observaciones, activo=@activo,
    descuento_pct=@descuento_pct, aplica_iva=@aplica_iva,
    aplica_percepcion=@aplica_percepcion, impuesto_interno=@impuesto_interno
    WHERE id=@id`).run(p)
  return p
})
ipcMain.handle('proveedores:delete', (_, id) => {
  db.prepare('DELETE FROM proveedores WHERE id=?').run(id)
  return true
})

// Listas
ipcMain.handle('listas:getAll', () => {
  if (isAdmin()) return db.prepare('SELECT * FROM listas WHERE activo = 1 ORDER BY created_at DESC').all()
  return db.prepare('SELECT * FROM listas WHERE activo = 1 AND user_id = ? ORDER BY created_at DESC').all(userId())
})
ipcMain.handle('listas:insertMany', (_, rows) => {
  const stmt = db.prepare(`INSERT INTO listas (fecha,id_proveedor,proveedor,archivo_origen,producto_original,presentacion_original,
    tipo_compra,unidades_por_caja,cantidad_por_unidad,unidad_medida,precio_informado,moneda,observaciones,codigo_producto,estado_match,precio_por_unidad,precio_por_medida_base,user_id)
    VALUES (@fecha,@id_proveedor,@proveedor,@archivo_origen,@producto_original,@presentacion_original,
    @tipo_compra,@unidades_por_caja,@cantidad_por_unidad,@unidad_medida,@precio_informado,@moneda,@observaciones,@codigo_producto,@estado_match,@precio_por_unidad,@precio_por_medida_base,@user_id)`)
  const uid = userId()
  const insertMany = db.transaction((items) => items.forEach(i => stmt.run({ ...i, user_id: uid })))
  insertMany(rows)
  return true
})
ipcMain.handle('listas:updateMatch', (_, { id, codigo_producto, estado_match }) => {
  // Recalculate prices
  const lista = db.prepare('SELECT * FROM listas WHERE id=?').get(id)
  const prod = db.prepare('SELECT * FROM productos WHERE codigo=?').get(codigo_producto)
  let precio_por_unidad = null
  let precio_por_medida_base = null
  if (lista && lista.precio_informado) {
    if (lista.tipo_compra === 'CAJA') {
      precio_por_unidad = lista.precio_informado / (lista.unidades_por_caja || 1)
    } else {
      precio_por_unidad = lista.precio_informado
    }
    if (lista.cantidad_por_unidad && lista.cantidad_por_unidad > 0) {
      precio_por_medida_base = precio_por_unidad / lista.cantidad_por_unidad
    }
  }
  db.prepare('UPDATE listas SET codigo_producto=?,estado_match=?,precio_por_unidad=?,precio_por_medida_base=? WHERE id=?')
    .run(codigo_producto, estado_match, precio_por_unidad, precio_por_medida_base, id)
  return true
})
ipcMain.handle('listas:delete', (_, id) => {
  db.prepare('DELETE FROM listas WHERE id=?').run(id)
  return true
})
ipcMain.handle('listas:deleteByProveedor', (_, id_proveedor) => {
  db.prepare('DELETE FROM listas WHERE id_proveedor=?').run(id_proveedor)
  return true
})
// Feature 3: archive (mark as inactive) all existing lista rows for a proveedor
ipcMain.handle('listas:archiveByProveedor', (_, id_proveedor) => {
  db.prepare('UPDATE listas SET activo=0 WHERE id_proveedor=?').run(id_proveedor)
  return true
})

// Equivalencias
ipcMain.handle('equivalencias:getAll', () => {
  if (isAdmin()) return db.prepare('SELECT * FROM equivalencias ORDER BY id_proveedor').all()
  return db.prepare('SELECT * FROM equivalencias WHERE user_id = ? ORDER BY id_proveedor').all(userId())
})
ipcMain.handle('equivalencias:create', (_, e) => {
  const stmt = db.prepare('INSERT INTO equivalencias (id_proveedor,producto_original,presentacion_original,codigo_producto,comentarios,user_id) VALUES (@id_proveedor,@producto_original,@presentacion_original,@codigo_producto,@comentarios,@user_id)')
  const r = stmt.run({ ...e, user_id: userId() })
  return { id: r.lastInsertRowid, ...e }
})
ipcMain.handle('equivalencias:delete', (_, id) => {
  db.prepare('DELETE FROM equivalencias WHERE id=?').run(id)
  return true
})

// Comparador
ipcMain.handle('comparador:getComparativa', (_, filtros) => {
  let query = `
    SELECT
      l.codigo_producto,
      p.producto as producto_estandar,
      p.categoria,
      p.unidad_medida,
      l.id_proveedor,
      l.proveedor,
      l.fecha,
      l.producto_original,
      l.presentacion_original,
      l.tipo_compra,
      l.cantidad_por_unidad,
      l.precio_informado,
      l.precio_por_unidad,
      l.precio_por_medida_base
    FROM listas l
    LEFT JOIN productos p ON l.codigo_producto = p.codigo
    WHERE l.codigo_producto IS NOT NULL AND l.estado_match = 'OK' AND l.activo = 1
  `
  const params = []
  if (!isAdmin()) {
    query += ' AND l.user_id = ?'
    params.push(userId())
  }
  if (filtros && filtros.categoria) {
    query += ' AND p.categoria = ?'
    params.push(filtros.categoria)
  }
  if (filtros && filtros.codigo) {
    query += ' AND l.codigo_producto = ?'
    params.push(filtros.codigo)
  }
  query += ' ORDER BY l.codigo_producto, l.precio_por_medida_base ASC'
  return db.prepare(query).all(...params)
})

// File dialog
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Excel', extensions: ['xlsx', 'xls'] },
      { name: 'Todos los archivos', extensions: ['*'] }
    ]
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle('file:readExcel', (_, filePath) => {
  const XLSX = require('xlsx')
  const wb = XLSX.readFile(filePath)
  const result = {}
  wb.SheetNames.forEach(name => {
    const ws = wb.Sheets[name]
    result[name] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  })
  return result
})

// ─── Maxirest integration ─────────────────────────────────────────────────────

// Parse & clean Maxirest INSUMO.XLSX export
ipcMain.handle('maxirest:parseInsumos', (_, filePath) => {
  const XLSX = require('xlsx')
  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null })

  // Expected columns: COD_RUI, CODIGO, NOMBRE, UNIDAD_MED, PRECIO, ULT_COMPRA
  const items = raw
    .filter(r => r.NOMBRE && String(r.NOMBRE).trim() !== '')
    .map(r => ({
      codigo_maxirest: String(r.CODIGO || '').trim(),
      nombre: String(r.NOMBRE || '').trim(),
      nombre_norm: String(r.NOMBRE || '').trim().toUpperCase().replace(/\s+/g, ' '),
      unidad_raw: String(r.UNIDAD_MED || '').trim(),
      unidad_norm: normalizeUnit(String(r.UNIDAD_MED || '')),
      precio: parseFloat(r.PRECIO) || 0,
      cod_rui: String(r.COD_RUI || '0').trim(),
      ult_compra: r.ULT_COMPRA ? String(r.ULT_COMPRA).split('T')[0] : null,
    }))

  // Detect duplicates by normalized name
  const groups = {}
  items.forEach(i => {
    if (!groups[i.nombre_norm]) groups[i.nombre_norm] = []
    groups[i.nombre_norm].push(i)
  })

  // Return grouped: { unicos, duplicados }
  const unicos = []
  const duplicados = []
  Object.entries(groups).forEach(([nombre_norm, rows]) => {
    if (rows.length === 1) unicos.push(rows[0])
    else duplicados.push({ nombre_norm, rows })
  })

  return { unicos, duplicados, total: items.length }
})

// Import cleaned Maxirest insumos into productos table
ipcMain.handle('maxirest:importarInsumos', (_, insumos) => {
  // insumos: array of { codigo_nuestro, nombre, categoria, unidad_medida, codigos_maxirest, rubro_maxirest }
  const insert = db.prepare(`INSERT OR IGNORE INTO productos
    (codigo,producto,categoria,unidad_base,unidad_medida,codigos_maxirest,rubro_maxirest,activo)
    VALUES (@codigo,@producto,@categoria,@unidad_base,@unidad_medida,@codigos_maxirest,@rubro_maxirest,1)`)
  const update = db.prepare(`UPDATE productos SET
    codigos_maxirest=@codigos_maxirest, rubro_maxirest=@rubro_maxirest
    WHERE codigo=@codigo`)

  const tx = db.transaction((items) => {
    let inserted = 0, updated = 0
    for (const item of items) {
      const existing = db.prepare('SELECT id FROM productos WHERE codigo=?').get(item.codigo)
      if (existing) { update.run(item); updated++ }
      else { insert.run(item); inserted++ }
    }
    return { inserted, updated }
  })
  return tx(insumos)
})

// Export comparativa for Maxirest (Insumos por Proveedor format)
ipcMain.handle('maxirest:exportarComparativa', async (_, { rows, outputPath }) => {
  const XLSX = require('xlsx')
  // Format: CODIGO_MAXIREST | NOMBRE | UNIDAD_MED | PROVEEDOR | PRECIO
  const data = [['CODIGO', 'NOMBRE', 'UNIDAD_MED', 'PROVEEDOR', 'PRECIO', 'PRECIO_X_UNIDAD_MED', 'FECHA']]
  rows.forEach(r => {
    data.push([
      r.codigo_maxirest || r.codigo_producto,
      r.producto_estandar || r.codigo_producto,
      r.unidad_medida || '',
      r.proveedor || '',
      r.precio_informado || '',
      r.precio_por_medida_base || '',
      r.fecha || '',
    ])
  })
  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = [12, 30, 12, 20, 12, 16, 12].map(w => ({ wch: w }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Insumos por Proveedor')
  const savePath = outputPath || path.join(app.getPath('downloads'), `comparativa_maxirest_${Date.now()}.xlsx`)
  XLSX.writeFile(wb, savePath)
  return savePath
})

// Export lista de compra: hoja Lista + hoja Por proveedor
ipcMain.handle('comparador:exportarLista', async (_, { items, outputPath }) => {
  const XLSX  = require('xlsx')
  const wb    = XLSX.utils.book_new()
  const num   = v => v != null ? Number(Number(v).toFixed(2)) : ''

  // ── Hoja 1: Lista completa ──────────────────────────────────────────────────
  const listaData = [['Producto','Código','Categoría','Cantidad','Unidad','Mejor proveedor','Precio/unidad','Subtotal']]
  for (const it of items) {
    listaData.push([it.producto, it.codigo, it.categoria || '', it.cantidad, it.unidad_base,
      it.bestProveedor || 'Sin datos', num(it.bestPxm), num(it.subtotal)])
  }
  const total = items.reduce((s, i) => s + (i.subtotal || 0), 0)
  listaData.push(['TOTAL ESTIMADO','','','','','','', num(total)])

  const wsL = XLSX.utils.aoa_to_sheet(listaData)
  wsL['!cols'] = [30,10,14,10,8,26,14,14].map(w => ({wch: w}))
  XLSX.utils.book_append_sheet(wb, wsL, 'Lista de compra')

  // ── Hoja 2: Agrupado por proveedor ─────────────────────────────────────────
  const byProv = {}
  items.forEach(it => {
    if (!it.bestProveedor) return
    if (!byProv[it.bestProveedor]) byProv[it.bestProveedor] = []
    byProv[it.bestProveedor].push(it)
  })
  const provData = [['Proveedor','Producto','Código','Cantidad','Unidad','Precio/unidad','Subtotal']]
  for (const [prov, provItems] of Object.entries(byProv)) {
    for (const it of provItems)
      provData.push([prov, it.producto, it.codigo, it.cantidad, it.unidad_base, num(it.bestPxm), num(it.subtotal)])
    const subtotProv = provItems.reduce((s, i) => s + (i.subtotal || 0), 0)
    provData.push(['', `SUBTOTAL ${prov}`, '', '', '', '', num(subtotProv)])
    provData.push(Array(7).fill(''))
  }
  const wsP = XLSX.utils.aoa_to_sheet(provData)
  wsP['!cols'] = [24,28,10,10,8,14,14].map(w => ({wch: w}))
  XLSX.utils.book_append_sheet(wb, wsP, 'Por proveedor')

  XLSX.writeFile(wb, outputPath)
  return outputPath
})

// Export comparativa selección: 2 hojas (Resumen + Detalle)
ipcMain.handle('comparador:exportarSeleccion', async (_, { grupos, outputPath, conImpuestos }) => {
  const XLSX = require('xlsx')
  const wb   = XLSX.utils.book_new()

  // ── Hoja 1: Resumen ──────────────────────────────────────────────────────────
  const resumenData = [['Código','Producto','Categoría','Mejor precio','Proveedor (mejor precio)','Unidad base','Diferencia %']]
  for (const g of grupos) {
    const precios = g.proveedores.map(r => r.precio_por_medida).filter(p => p != null && p > 0)
    const minP = precios.length ? Math.min(...precios) : null
    const maxP = precios.length ? Math.max(...precios) : null
    const mejorProv = g.proveedores.find(r => r.precio_por_medida === minP)
    const diff = minP && maxP && maxP > minP ? ((maxP - minP) / maxP * 100).toFixed(1) + '%' : ''
    resumenData.push([
      g.codigo, g.producto, g.categoria,
      minP != null ? Number(minP.toFixed(2)) : '',
      mejorProv?.proveedor || '',
      g.unidad_base, diff,
    ])
  }
  const wsRes = XLSX.utils.aoa_to_sheet(resumenData)
  wsRes['!cols'] = [10,30,15,14,24,10,10].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, wsRes, 'Resumen')

  // ── Hoja 2: Detalle por producto ─────────────────────────────────────────────
  const label = conImpuestos ? 'Precio/medida c/imp' : 'Precio/medida'
  const detalleData = [['Código','Producto','Categoría','Proveedor','Presentación','Tipo','Precio lista',label,'Unidad','Fecha']]
  for (const g of grupos) {
    for (const r of g.proveedores) {
      detalleData.push([
        g.codigo, g.producto, g.categoria,
        r.proveedor, r.presentacion, r.tipo_compra,
        r.precio_lista    != null ? Number(Number(r.precio_lista).toFixed(2))    : '',
        r.precio_por_medida != null ? Number(Number(r.precio_por_medida).toFixed(2)) : '',
        g.unidad_base, r.fecha,
      ])
    }
    detalleData.push(Array(10).fill(''))   // separador entre productos
  }
  const wsDet = XLSX.utils.aoa_to_sheet(detalleData)
  wsDet['!cols'] = [10,28,14,22,18,8,13,16,8,10].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, wsDet, 'Detalle por producto')

  const savePath = outputPath || path.join(app.getPath('downloads'), `comparativa_${Date.now()}.xlsx`)
  XLSX.writeFile(wb, savePath)
  return savePath
})

ipcMain.handle('dialog:saveFile', async (_, { defaultName }) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName || 'exportar.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  if (result.canceled) return null
  return result.filePath
})

// ─── Pedidos ──────────────────────────────────────────────────────────────────
ipcMain.handle('pedidos:getAll', () => {
  const q = isAdmin()
    ? 'SELECT * FROM pedidos ORDER BY created_at DESC'
    : 'SELECT * FROM pedidos WHERE user_id = ? ORDER BY created_at DESC'
  const pedidos = isAdmin() ? db.prepare(q).all() : db.prepare(q).all(userId())
  return pedidos.map(p => ({
    ...p,
    items: db.prepare('SELECT * FROM pedido_items WHERE id_pedido = ?').all(p.id),
  }))
})

ipcMain.handle('pedidos:create', (_, { pedido, items }) => {
  const r = db.prepare(`
    INSERT INTO pedidos (fecha, restaurante, id_proveedor, proveedor, notas, total, estado, nro_orden, user_id)
    VALUES (@fecha, @restaurante, @id_proveedor, @proveedor, @notas, @total, @estado, @nro_orden, @user_id)
  `).run({ ...pedido, user_id: userId() })
  const id = r.lastInsertRowid
  const ins = db.prepare(`
    INSERT INTO pedido_items (id_pedido, codigo_producto, producto, cantidad, unidad, precio_unitario, subtotal)
    VALUES (@id_pedido, @codigo_producto, @producto, @cantidad, @unidad, @precio_unitario, @subtotal)
  `)
  for (const item of (items || [])) ins.run({ ...item, id_pedido: id })
  return { id, ...pedido, items }
})

ipcMain.handle('pedidos:updateEstado', (_, { id, estado }) => {
  db.prepare('UPDATE pedidos SET estado = ? WHERE id = ?').run(estado, id)
  return { ok: true }
})

ipcMain.handle('pedidos:delete', (_, id) => {
  db.prepare('DELETE FROM pedido_items WHERE id_pedido = ?').run(id)
  db.prepare('DELETE FROM pedidos WHERE id = ?').run(id)
  return { ok: true }
})

// ─── Zoom ─────────────────────────────────────────────────────────────────────
function getZoomSettingsPath() {
  return path.join(app.getPath('userData'), 'zoom.json')
}
function readSavedZoom() {
  try {
    const raw = fs.readFileSync(getZoomSettingsPath(), 'utf8')
    const z = JSON.parse(raw).factor
    return (typeof z === 'number' && z > 0) ? z : 1.0
  } catch { return 1.0 }
}

ipcMain.handle('app:setZoom', (_, factor) => {
  const wins = BrowserWindow.getAllWindows()
  if (wins.length > 0) wins[0].webContents.setZoomFactor(factor)
  // Persistir para el próximo arranque
  try { fs.writeFileSync(getZoomSettingsPath(), JSON.stringify({ factor })) } catch {}
  return { ok: true }
})

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow(port) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 650,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'default',
    show: false
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else if (port) {
    win.loadURL(`http://localhost:${port}`)
  } else {
    // Fallback: Express no pudo iniciar — cargar directamente desde disco (sin LAN)
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Timeout de seguridad: si ready-to-show no dispara en 8s, mostrar igual
  const showFallback = setTimeout(() => {
    if (!win.isVisible()) win.show()
  }, 8000)

  win.once('ready-to-show', () => {
    clearTimeout(showFallback)
    const savedZoom = readSavedZoom()
    if (savedZoom !== 1.0) win.webContents.setZoomFactor(savedZoom)
    win.show()
  })

  // Ctrl+Shift+I abre DevTools en cualquier versión (dev o producción)
  // Sirve para depurar errores en Windows sin necesidad de recompilar
  const { globalShortcut } = require('electron')
  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key === 'I') {
      win.webContents.toggleDevTools()
    }
  })

  // Capturar errores del renderer y mostrarlos en consola del main process
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('[Renderer crash]', details)
  })
  win.webContents.on('did-fail-load', (event, code, desc, url) => {
    console.error('[Load fail]', code, desc, url)
  })
}

// ─── Sincronización con OPS Terminal ─────────────────────────────────────────

// Construye el paquete de sync desde la base de datos local
function buildSyncPackage() {
  const productos = db.prepare('SELECT * FROM productos WHERE activo=1 ORDER BY producto').all()
  const proveedores = db.prepare('SELECT * FROM proveedores WHERE activo=1 ORDER BY proveedor').all()
  const listas = db.prepare(`
    SELECT l.*, p.codigo AS cod_producto
    FROM listas l
    LEFT JOIN productos p ON l.codigo_producto = p.codigo
    WHERE l.estado_match='OK' AND l.activo=1
  `).all()

  return {
    version: '1.0',
    source: 'gestion-proveedores',
    exportedAt: new Date().toISOString(),
    productos: productos.map(p => ({
      codigo: p.codigo,
      nombre: p.producto,
      rubro: p.categoria || 'General',
      unidad: p.unidad_medida || p.unidad_base || 'unidad',
      precioRef: null,
    })),
    proveedores: proveedores.map(p => ({
      codigo: p.id_proveedor,
      nombre: p.proveedor,
      contacto: p.contacto || '',
      telefono: p.whatsapp || '',
      email: p.email || '',
    })),
    precios: listas.filter(l => l.cod_producto && l.id_proveedor && l.precio_informado > 0).map(l => ({
      codigoProducto: l.cod_producto,
      codigoProveedor: l.id_proveedor,
      nombreProductoProveedor: l.producto_original || l.cod_producto,
      precio: l.precio_informado,
      unidad: l.unidad_medida || '',
      fecha: l.fecha || null,
    })),
  }
}

// Exportar como JSON a disco (el usuario elige la ruta)
ipcMain.handle('sync:exportJSON', async () => {
  const fecha = new Date().toISOString().slice(0, 10)
  const result = await dialog.showSaveDialog({
    defaultPath: `gestion-proveedores-sync-${fecha}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }

  const payload = buildSyncPackage()
  fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8')
  return { ok: true, path: result.filePath, counts: {
    productos: payload.productos.length,
    proveedores: payload.proveedores.length,
    precios: payload.precios.length,
  }}
})

// Función compartida que importa un paquete de sync ya parseado
function importSyncData(data) {
  if (!data.version || (!data.productos && !data.proveedores)) {
    return { ok: false, error: 'No es un paquete de sincronización válido.' }
  }

  let productosInsertados = 0, productosActualizados = 0
  let proveedoresInsertados = 0, proveedoresActualizados = 0
  let preciosUpserted = 0
  const errores = []

  const insertProd = db.prepare(`INSERT OR IGNORE INTO productos
    (codigo,producto,categoria,unidad_base,unidad_medida,activo)
    VALUES (@codigo,@producto,@categoria,@unidad_base,@unidad_medida,1)`)
  const updateProd = db.prepare(`UPDATE productos SET
    producto=@producto, categoria=@categoria, unidad_medida=@unidad_medida
    WHERE codigo=@codigo`)
  const insertProv = db.prepare(`INSERT OR IGNORE INTO proveedores
    (id_proveedor,proveedor,contacto,whatsapp,email,activo)
    VALUES (@id_proveedor,@proveedor,@contacto,@whatsapp,@email,1)`)
  const updateProv = db.prepare(`UPDATE proveedores SET
    proveedor=@proveedor, contacto=@contacto, whatsapp=@whatsapp, email=@email
    WHERE id_proveedor=@id_proveedor`)
  const checkLista = db.prepare('SELECT id FROM listas WHERE id_proveedor=? AND codigo_producto=? AND activo=1 LIMIT 1')
  const insertLista = db.prepare(`INSERT INTO listas
    (fecha,id_proveedor,proveedor,producto_original,unidad_medida,precio_informado,codigo_producto,estado_match,precio_por_unidad,precio_por_medida_base,activo)
    VALUES (@fecha,@id_proveedor,@proveedor,@producto_original,@unidad_medida,@precio_informado,@codigo_producto,'OK',@precio_informado,NULL,1)`)
  const updateLista = db.prepare(`UPDATE listas SET
    precio_informado=@precio_informado, precio_por_unidad=@precio_informado,
    precio_por_medida_base=NULL, fecha=@fecha
    WHERE id_proveedor=@id_proveedor AND codigo_producto=@codigo_producto AND activo=1`)

  const tx = db.transaction(() => {
    for (const p of (data.productos || [])) {
      if (!p.codigo || !p.nombre) continue
      try {
        const r = insertProd.run({ codigo: p.codigo, producto: p.nombre, categoria: p.rubro || 'General', unidad_base: p.unidad || 'unidad', unidad_medida: p.unidad || 'unidad' })
        if (r.changes) productosInsertados++
        else { updateProd.run({ codigo: p.codigo, producto: p.nombre, categoria: p.rubro || 'General', unidad_medida: p.unidad || 'unidad' }); productosActualizados++ }
      } catch (e) { errores.push(`Producto ${p.codigo}: ${e.message}`) }
    }
    for (const p of (data.proveedores || [])) {
      if (!p.codigo || !p.nombre) continue
      try {
        const r = insertProv.run({ id_proveedor: p.codigo, proveedor: p.nombre, contacto: p.contacto || null, whatsapp: p.telefono || null, email: p.email || null })
        if (r.changes) proveedoresInsertados++
        else { updateProv.run({ id_proveedor: p.codigo, proveedor: p.nombre, contacto: p.contacto || null, whatsapp: p.telefono || null, email: p.email || null }); proveedoresActualizados++ }
      } catch (e) { errores.push(`Proveedor ${p.codigo}: ${e.message}`) }
    }
    for (const pr of (data.precios || [])) {
      if (!pr.codigoProducto || !pr.codigoProveedor || !pr.precio) continue
      try {
        const prod = db.prepare('SELECT codigo FROM productos WHERE codigo=?').get(pr.codigoProducto)
        const prov = db.prepare('SELECT proveedor FROM proveedores WHERE id_proveedor=?').get(pr.codigoProveedor)
        if (!prod || !prov) continue
        const existing = checkLista.get(pr.codigoProveedor, pr.codigoProducto)
        const fecha = pr.fecha || new Date().toISOString().slice(0, 10)
        if (existing) {
          updateLista.run({ precio_informado: pr.precio, fecha, id_proveedor: pr.codigoProveedor, codigo_producto: pr.codigoProducto })
        } else {
          insertLista.run({ fecha, id_proveedor: pr.codigoProveedor, proveedor: prov.proveedor, producto_original: pr.nombreProductoProveedor || pr.codigoProducto, unidad_medida: pr.unidad || '', precio_informado: pr.precio, codigo_producto: pr.codigoProducto })
        }
        preciosUpserted++
      } catch (e) { errores.push(`Precio ${pr.codigoProducto}: ${e.message}`) }
    }
  })

  tx()
  return { ok: true, source: data.source || 'desconocido', productosInsertados, productosActualizados, proveedoresInsertados, proveedoresActualizados, preciosUpserted, errores }
}

// Importar desde un JSON (el usuario elige el archivo)
ipcMain.handle('sync:importJSON', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true }

  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf8')
    const data = JSON.parse(raw)
    return importSyncData(data)
  } catch (e) {
    return { ok: false, error: 'Error al leer el archivo: ' + e.message }
  }
})

// Push: envía los datos de GP hacia OPS Terminal vía HTTP
ipcMain.handle('sync:pushToOPS', async (_, opsUrl) => {
  const https = require('https')
  const payload = JSON.stringify(buildSyncPackage())

  return new Promise((resolve) => {
    try {
      const url = new URL('/api/sync/import', opsUrl)
      const isHttps = url.protocol === 'https:'
      const lib = isHttps ? https : http
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 10000,
      }
      const req = lib.request(options, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, result: JSON.parse(data) })
          } catch { resolve({ ok: false, error: 'Respuesta inválida del servidor' }) }
        })
      })
      req.on('error', (e) => resolve({ ok: false, error: e.message }))
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout — ¿está OPS Terminal corriendo?' }) })
      req.write(payload)
      req.end()
    } catch (e) {
      resolve({ ok: false, error: e.message })
    }
  })
})

// Pull: descarga el catálogo de OPS Terminal e importa en GP
ipcMain.handle('sync:pullFromOPS', async (_, opsUrl) => {
  const https = require('https')

  return new Promise((resolve) => {
    try {
      const url = new URL('/api/sync/export', opsUrl)
      const isHttps = url.protocol === 'https:'
      const lib = isHttps ? https : http
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'GET',
        timeout: 10000,
      }
      const req = lib.request(options, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            const importResult = importSyncData(parsed)
            resolve(importResult)
          } catch (e) { resolve({ ok: false, error: 'Error al parsear respuesta: ' + e.message }) }
        })
      })
      req.on('error', (e) => resolve({ ok: false, error: e.message }))
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout — ¿está OPS Terminal corriendo?' }) })
      req.end()
    } catch (e) {
      resolve({ ok: false, error: e.message })
    }
  })
})

// ─── Backup / Restore ─────────────────────────────────────────────────────────
ipcMain.handle('backup:export', async () => {
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'gestion_proveedores.db')
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`
  const result = await dialog.showSaveDialog({
    title: 'Exportar backup de base de datos',
    defaultPath: `backup_gestion_proveedores_${stamp}.db`,
    filters: [{ name: 'Base de datos SQLite', extensions: ['db'] }],
  })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  try {
    // Usar backup API de better-sqlite3 para copia en caliente (sin cerrar la DB)
    await db.backup(result.filePath)
    return { ok: true, path: result.filePath }
  } catch (err) {
    // Fallback: copia de archivo directa
    try {
      fs.copyFileSync(dbPath, result.filePath)
      return { ok: true, path: result.filePath }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }
})

ipcMain.handle('backup:restore', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Restaurar backup de base de datos',
    properties: ['openFile'],
    filters: [{ name: 'Base de datos SQLite', extensions: ['db'] }],
  })
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true }
  const backupPath = result.filePaths[0]
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'gestion_proveedores.db')
  const tempPath = dbPath + '.bak_' + Date.now()
  try {
    // Guardar copia de seguridad del actual antes de restaurar
    fs.copyFileSync(dbPath, tempPath)
    // Cerrar la DB, restaurar, reabrir
    db.close()
    fs.copyFileSync(backupPath, dbPath)
    // Reinicializar la conexión a la DB
    initDB()
    // Borrar el temp si todo salió bien
    try { fs.unlinkSync(tempPath) } catch {}
    return { ok: true }
  } catch (err) {
    // Revertir si algo falló
    try {
      if (fs.existsSync(tempPath)) fs.copyFileSync(tempPath, dbPath)
      if (db.open === false) initDB()
    } catch {}
    return { ok: false, error: err.message }
  }
})

app.whenReady().then(async () => {
  initDB()
  JWT_SECRET = getJwtSecret()

  let port = null
  if (!isDev) {
    const distPath = path.join(__dirname, '../dist')
    try {
      port = await startLocalServer(distPath)
    } catch (err) {
      console.error('[startup] Servidor LAN no pudo iniciar, abriendo sin acceso LAN:', err.message)
      // port queda null → createWindow carga desde file://
    }
  } else {
    // En dev, también levantar Express para poder testear LAN
    const createServerDev = require('./server')
    const expressApp = createServerDev({ db, JWT_SECRET, distPath: null })
    const LAN_PORT = 3001
    expressApp.listen(LAN_PORT, '0.0.0.0', () => {
      global.__lanPort = LAN_PORT
      console.log(`[Express DEV] LAN server on 0.0.0.0:${LAN_PORT}`)
    })
  }

  createWindow(port)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
