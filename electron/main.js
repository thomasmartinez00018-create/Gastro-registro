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

function startLocalServer(distPath) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // Quitar query strings y fragmentos
      let urlPath = req.url.split('?')[0].split('#')[0]
      if (urlPath === '/') urlPath = '/index.html'

      let filePath = path.join(distPath, urlPath)

      // SPA fallback: si no existe el archivo, servir index.html
      if (!fs.existsSync(filePath)) {
        filePath = path.join(distPath, 'index.html')
      }

      const ext = path.extname(filePath).toLowerCase()
      const mime = MIME[ext] || 'application/octet-stream'

      try {
        const data = fs.readFileSync(filePath)
        res.writeHead(200, { 'Content-Type': mime })
        res.end(data)
      } catch {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    // Puerto 0 = sistema elige un puerto libre automáticamente
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port)
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

  // Migrations for existing DBs
  const cols = db.prepare("PRAGMA table_info(productos)").all().map(c => c.name)
  if (!cols.includes('codigos_maxirest')) db.exec("ALTER TABLE productos ADD COLUMN codigos_maxirest TEXT")
  if (!cols.includes('rubro_maxirest'))   db.exec("ALTER TABLE productos ADD COLUMN rubro_maxirest TEXT")
  // Listas versioning
  const listasCols = db.prepare("PRAGMA table_info(listas)").all().map(c => c.name)
  if (!listasCols.includes('activo')) db.exec("ALTER TABLE listas ADD COLUMN activo INTEGER DEFAULT 1")
  // Proveedores: descuentos e impuestos
  const provCols = db.prepare("PRAGMA table_info(proveedores)").all().map(c => c.name)
  if (!provCols.includes('descuento_pct'))     db.exec("ALTER TABLE proveedores ADD COLUMN descuento_pct REAL DEFAULT 0")
  if (!provCols.includes('aplica_iva'))        db.exec("ALTER TABLE proveedores ADD COLUMN aplica_iva INTEGER DEFAULT 0")
  if (!provCols.includes('aplica_percepcion')) db.exec("ALTER TABLE proveedores ADD COLUMN aplica_percepcion INTEGER DEFAULT 0")
  if (!provCols.includes('impuesto_interno'))  db.exec("ALTER TABLE proveedores ADD COLUMN impuesto_interno REAL DEFAULT 0")
}

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

// Productos
ipcMain.handle('productos:getAll', () => {
  return db.prepare('SELECT * FROM productos ORDER BY categoria, producto').all()
})
ipcMain.handle('productos:create', (_, p) => {
  const stmt = db.prepare(`INSERT INTO productos (codigo,producto,categoria,marca,unidad_base,contenido_unitario,unidad_medida,presentacion_referencia,alias,codigos_maxirest,rubro_maxirest,activo)
    VALUES (@codigo,@producto,@categoria,@marca,@unidad_base,@contenido_unitario,@unidad_medida,@presentacion_referencia,@alias,@codigos_maxirest,@rubro_maxirest,@activo)`)
  const r = stmt.run(p)
  return { id: r.lastInsertRowid, ...p }
})
ipcMain.handle('productos:update', (_, p) => {
  db.prepare(`UPDATE productos SET codigo=@codigo,producto=@producto,categoria=@categoria,marca=@marca,unidad_base=@unidad_base,
    contenido_unitario=@contenido_unitario,unidad_medida=@unidad_medida,presentacion_referencia=@presentacion_referencia,
    alias=@alias,codigos_maxirest=@codigos_maxirest,rubro_maxirest=@rubro_maxirest,activo=@activo
    WHERE id=@id`).run(p)
  return p
})
ipcMain.handle('productos:delete', (_, id) => {
  db.prepare('DELETE FROM productos WHERE id=?').run(id)
  return true
})

// Proveedores
ipcMain.handle('proveedores:getAll', () => {
  return db.prepare('SELECT * FROM proveedores ORDER BY proveedor').all()
})
ipcMain.handle('proveedores:create', (_, p) => {
  const stmt = db.prepare(`INSERT INTO proveedores
    (id_proveedor,proveedor,contacto,whatsapp,email,observaciones,activo,descuento_pct,aplica_iva,aplica_percepcion,impuesto_interno)
    VALUES (@id_proveedor,@proveedor,@contacto,@whatsapp,@email,@observaciones,@activo,@descuento_pct,@aplica_iva,@aplica_percepcion,@impuesto_interno)`)
  const r = stmt.run(p)
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
  return db.prepare('SELECT * FROM listas ORDER BY created_at DESC').all()
})
ipcMain.handle('listas:insertMany', (_, rows) => {
  const stmt = db.prepare(`INSERT INTO listas (fecha,id_proveedor,proveedor,archivo_origen,producto_original,presentacion_original,
    tipo_compra,unidades_por_caja,cantidad_por_unidad,unidad_medida,precio_informado,moneda,observaciones,codigo_producto,estado_match,precio_por_unidad,precio_por_medida_base)
    VALUES (@fecha,@id_proveedor,@proveedor,@archivo_origen,@producto_original,@presentacion_original,
    @tipo_compra,@unidades_por_caja,@cantidad_por_unidad,@unidad_medida,@precio_informado,@moneda,@observaciones,@codigo_producto,@estado_match,@precio_por_unidad,@precio_por_medida_base)`)
  const insertMany = db.transaction((items) => items.forEach(i => stmt.run(i)))
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
  return db.prepare('SELECT * FROM equivalencias ORDER BY id_proveedor').all()
})
ipcMain.handle('equivalencias:create', (_, e) => {
  const stmt = db.prepare('INSERT INTO equivalencias (id_proveedor,producto_original,presentacion_original,codigo_producto,comentarios) VALUES (@id_proveedor,@producto_original,@presentacion_original,@codigo_producto,@comentarios)')
  const r = stmt.run(e)
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
    WHERE l.codigo_producto IS NOT NULL AND l.estado_match = 'OK'
  `
  const params = []
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
  } else {
    win.loadURL(`http://localhost:${port}`)
  }

  win.once('ready-to-show', () => win.show())

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

app.whenReady().then(async () => {
  initDB()

  let port = null
  if (!isDev) {
    const distPath = path.join(__dirname, '../dist')
    port = await startLocalServer(distPath)
  }

  createWindow(port)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
