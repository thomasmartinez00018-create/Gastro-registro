// server.js — Express server for LAN network access
// Mirrors IPC handlers as REST endpoints with JWT authentication

const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const path = require('path')
const fs = require('fs')

module.exports = function createServer({ db, JWT_SECRET, distPath }) {
  const app = express()
  // CORS totalmente permisivo — LAN privada, sin riesgo
  app.use(cors({ origin: '*', methods: '*', allowedHeaders: '*' }))
  app.options('*', cors())
  app.use(express.json({ limit: '50mb' }))

  // Log en memoria de TODAS las peticiones — para diagnóstico desde la UI
  global.__recentRequests = global.__recentRequests || []
  function logRequest(req, extra = {}) {
    const entry = {
      time: new Date().toISOString(),
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
      ua: (req.headers['user-agent'] || '').slice(0, 80),
      method: req.method,
      path: req.path,
      ...extra,
    }
    global.__recentRequests.unshift(entry)
    if (global.__recentRequests.length > 30) global.__recentRequests.pop()
  }

  // Middleware global: loggear toda petición que llegue
  app.use((req, res, next) => {
    logRequest(req)
    next()
  })

  // ── Helpers ────────────────────────────────────────────────────────────────
  function userFilter(user) {
    return user.role === 'admin' ? null : user.id
  }

  // ── Auth middleware ────────────────────────────────────────────────────────
  function auth(req, res, next) {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token requerido' })
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET)
      const user = db.prepare('SELECT id, username, role, display_name FROM users WHERE id = ? AND active = 1').get(payload.userId)
      if (!user) return res.status(401).json({ error: 'Usuario no encontrado' })
      req.user = user
      next()
    } catch {
      return res.status(401).json({ error: 'Token inválido o expirado' })
    }
  }

  function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
    next()
  }

  // ── Health check (sin auth — para diagnóstico LAN) ───────────────────────
  app.get('/ping', (req, res) => {
    logRequest(req)
    res.set('Access-Control-Allow-Origin', '*')
    res.json({
      ok: true,
      server: 'Gastronomic OS',
      time: new Date().toISOString(),
      from: req.ip || req.socket?.remoteAddress,
    })
  })

  // Mismo endpoint bajo /api para testear el prefijo con auth-less
  app.get('/api/ping', (req, res) => {
    logRequest(req)
    res.set('Access-Control-Allow-Origin', '*')
    res.json({ ok: true, time: new Date().toISOString() })
  })

  // ── Auth routes (no middleware) ────────────────────────────────────────────
  app.post('/api/auth/login', (req, res) => {
    try {
      const { username, password } = req.body || {}
      if (!username || !password) return res.json({ ok: false, error: 'Usuario y contraseña requeridos' })
      const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username)
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.json({ ok: false, error: 'Usuario o contraseña incorrectos' })
      }
      const token = jwt.sign({ userId: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '30d' })
      res.json({ ok: true, token, user: { id: user.id, username: user.username, role: user.role, display_name: user.display_name } })
    } catch (err) {
      console.error('[auth:login]', err)
      res.status(500).json({ ok: false, error: 'Error interno del servidor: ' + err.message })
    }
  })

  app.post('/api/auth/validate', (req, res) => {
    try {
      const payload = jwt.verify(req.body.token, JWT_SECRET)
      const user = db.prepare('SELECT id, username, role, display_name FROM users WHERE id = ? AND active = 1').get(payload.userId)
      if (!user) return res.json({ ok: false })
      res.json({ ok: true, user })
    } catch { res.json({ ok: false }) }
  })

  // ── All data routes require auth ──────────────────────────────────────────
  app.use('/api', auth)

  // ── Productos ─────────────────────────────────────────────────────────────
  app.get('/api/productos', (req, res) => {
    const uid = userFilter(req.user)
    const rows = uid
      ? db.prepare('SELECT * FROM productos WHERE user_id = ? ORDER BY categoria, producto').all(uid)
      : db.prepare('SELECT * FROM productos ORDER BY categoria, producto').all()
    res.json(rows)
  })

  app.post('/api/productos', (req, res) => {
    try {
      const p = { ...req.body, user_id: req.user.id }
      const r = db.prepare(`INSERT OR IGNORE INTO productos (codigo,producto,categoria,marca,unidad_base,contenido_unitario,unidad_medida,presentacion_referencia,alias,codigos_maxirest,rubro_maxirest,activo,codigo_barras,user_id)
        VALUES (@codigo,@producto,@categoria,@marca,@unidad_base,@contenido_unitario,@unidad_medida,@presentacion_referencia,@alias,@codigos_maxirest,@rubro_maxirest,@activo,@codigo_barras,@user_id)`).run(p)
      if (r.changes === 0) {
        const existing = db.prepare('SELECT * FROM productos WHERE codigo = ?').get(p.codigo)
        return res.json(existing || p)
      }
      res.json({ id: Number(r.lastInsertRowid), ...p })
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        const existing = db.prepare('SELECT * FROM productos WHERE codigo = ?').get(req.body.codigo)
        return res.json(existing || req.body)
      }
      res.status(500).json({ error: err.message })
    }
  })

  app.put('/api/productos/:id', (req, res) => {
    db.prepare(`UPDATE productos SET codigo=@codigo,producto=@producto,categoria=@categoria,marca=@marca,unidad_base=@unidad_base,
      contenido_unitario=@contenido_unitario,unidad_medida=@unidad_medida,presentacion_referencia=@presentacion_referencia,
      alias=@alias,codigos_maxirest=@codigos_maxirest,rubro_maxirest=@rubro_maxirest,activo=@activo,codigo_barras=@codigo_barras
      WHERE id=@id`).run(req.body)
    res.json(req.body)
  })

  app.delete('/api/productos/:id', (req, res) => {
    db.prepare('DELETE FROM productos WHERE id=?').run(req.params.id)
    res.json({ ok: true })
  })

  // ── Proveedores ───────────────────────────────────────────────────────────
  app.get('/api/proveedores', (req, res) => {
    const uid = userFilter(req.user)
    const rows = uid
      ? db.prepare('SELECT * FROM proveedores WHERE user_id = ? ORDER BY proveedor').all(uid)
      : db.prepare('SELECT * FROM proveedores ORDER BY proveedor').all()
    res.json(rows)
  })

  app.post('/api/proveedores', (req, res) => {
    const p = { ...req.body, user_id: req.user.id }
    const r = db.prepare(`INSERT INTO proveedores
      (id_proveedor,proveedor,contacto,whatsapp,email,observaciones,activo,descuento_pct,aplica_iva,aplica_percepcion,impuesto_interno,user_id)
      VALUES (@id_proveedor,@proveedor,@contacto,@whatsapp,@email,@observaciones,@activo,@descuento_pct,@aplica_iva,@aplica_percepcion,@impuesto_interno,@user_id)`).run(p)
    res.json({ id: Number(r.lastInsertRowid), ...p })
  })

  app.put('/api/proveedores/:id', (req, res) => {
    db.prepare(`UPDATE proveedores SET
      id_proveedor=@id_proveedor, proveedor=@proveedor, contacto=@contacto,
      whatsapp=@whatsapp, email=@email, observaciones=@observaciones, activo=@activo,
      descuento_pct=@descuento_pct, aplica_iva=@aplica_iva,
      aplica_percepcion=@aplica_percepcion, impuesto_interno=@impuesto_interno
      WHERE id=@id`).run(req.body)
    res.json(req.body)
  })

  app.delete('/api/proveedores/:id', (req, res) => {
    db.prepare('DELETE FROM proveedores WHERE id=?').run(req.params.id)
    res.json({ ok: true })
  })

  // ── Listas ────────────────────────────────────────────────────────────────
  app.get('/api/listas', (req, res) => {
    const uid = userFilter(req.user)
    const rows = uid
      ? db.prepare('SELECT * FROM listas WHERE activo = 1 AND user_id = ? ORDER BY created_at DESC').all(uid)
      : db.prepare('SELECT * FROM listas WHERE activo = 1 ORDER BY created_at DESC').all()
    res.json(rows)
  })

  app.post('/api/listas/batch', (req, res) => {
    const stmt = db.prepare(`INSERT INTO listas (fecha,id_proveedor,proveedor,archivo_origen,producto_original,presentacion_original,
      tipo_compra,unidades_por_caja,cantidad_por_unidad,unidad_medida,precio_informado,moneda,observaciones,codigo_producto,estado_match,precio_por_unidad,precio_por_medida_base,user_id)
      VALUES (@fecha,@id_proveedor,@proveedor,@archivo_origen,@producto_original,@presentacion_original,
      @tipo_compra,@unidades_por_caja,@cantidad_por_unidad,@unidad_medida,@precio_informado,@moneda,@observaciones,@codigo_producto,@estado_match,@precio_por_unidad,@precio_por_medida_base,@user_id)`)
    const uid = req.user.id
    const tx = db.transaction((items) => items.forEach(i => stmt.run({ ...i, user_id: uid })))
    tx(req.body)
    res.json({ ok: true })
  })

  app.put('/api/listas/:id/match', (req, res) => {
    const { id, codigo_producto, estado_match } = req.body
    const lista = db.prepare('SELECT * FROM listas WHERE id=?').get(id || req.params.id)
    let precio_por_unidad = null, precio_por_medida_base = null
    if (lista?.precio_informado) {
      precio_por_unidad = lista.tipo_compra === 'CAJA' ? lista.precio_informado / (lista.unidades_por_caja || 1) : lista.precio_informado
      if (lista.cantidad_por_unidad > 0) precio_por_medida_base = precio_por_unidad / lista.cantidad_por_unidad
    }
    db.prepare('UPDATE listas SET codigo_producto=?,estado_match=?,precio_por_unidad=?,precio_por_medida_base=? WHERE id=?')
      .run(codigo_producto, estado_match, precio_por_unidad, precio_por_medida_base, id || req.params.id)
    res.json({ ok: true })
  })

  app.delete('/api/listas/:id', (req, res) => {
    db.prepare('DELETE FROM listas WHERE id=?').run(req.params.id)
    res.json({ ok: true })
  })

  app.delete('/api/listas/proveedor/:id', (req, res) => {
    db.prepare('DELETE FROM listas WHERE id_proveedor=?').run(req.params.id)
    res.json({ ok: true })
  })

  app.post('/api/listas/proveedor/:id/archive', (req, res) => {
    db.prepare('UPDATE listas SET activo=0 WHERE id_proveedor=?').run(req.params.id)
    res.json({ ok: true })
  })

  // ── Equivalencias ─────────────────────────────────────────────────────────
  app.get('/api/equivalencias', (req, res) => {
    const uid = userFilter(req.user)
    const rows = uid
      ? db.prepare('SELECT * FROM equivalencias WHERE user_id = ? ORDER BY id_proveedor').all(uid)
      : db.prepare('SELECT * FROM equivalencias ORDER BY id_proveedor').all()
    res.json(rows)
  })

  app.post('/api/equivalencias', (req, res) => {
    const e = { ...req.body, user_id: req.user.id }
    const r = db.prepare('INSERT INTO equivalencias (id_proveedor,producto_original,presentacion_original,codigo_producto,comentarios,user_id) VALUES (@id_proveedor,@producto_original,@presentacion_original,@codigo_producto,@comentarios,@user_id)').run(e)
    res.json({ id: Number(r.lastInsertRowid), ...e })
  })

  app.delete('/api/equivalencias/:id', (req, res) => {
    db.prepare('DELETE FROM equivalencias WHERE id=?').run(req.params.id)
    res.json({ ok: true })
  })

  // ── Comparador ────────────────────────────────────────────────────────────
  app.post('/api/comparador', (req, res) => {
    const filtros = req.body
    let query = `
      SELECT l.codigo_producto, p.producto as producto_estandar, p.categoria, p.unidad_medida,
        l.id_proveedor, l.proveedor, l.fecha, l.producto_original, l.presentacion_original,
        l.tipo_compra, l.cantidad_por_unidad, l.precio_informado, l.precio_por_unidad, l.precio_por_medida_base
      FROM listas l LEFT JOIN productos p ON l.codigo_producto = p.codigo
      WHERE l.codigo_producto IS NOT NULL AND l.estado_match = 'OK' AND l.activo = 1`
    const params = []
    const uid = userFilter(req.user)
    if (uid) { query += ' AND l.user_id = ?'; params.push(uid) }
    if (filtros?.categoria) { query += ' AND p.categoria = ?'; params.push(filtros.categoria) }
    if (filtros?.codigo) { query += ' AND l.codigo_producto = ?'; params.push(filtros.codigo) }
    query += ' ORDER BY l.codigo_producto, l.id_proveedor, l.fecha'
    res.json(db.prepare(query).all(...params))
  })

  // ── Pedidos ───────────────────────────────────────────────────────────────
  app.get('/api/pedidos', (req, res) => {
    const uid = userFilter(req.user)
    const q = uid ? 'SELECT * FROM pedidos WHERE user_id = ? ORDER BY created_at DESC' : 'SELECT * FROM pedidos ORDER BY created_at DESC'
    const pedidos = uid ? db.prepare(q).all(uid) : db.prepare(q).all()
    res.json(pedidos.map(p => ({ ...p, items: db.prepare('SELECT * FROM pedido_items WHERE id_pedido = ?').all(p.id) })))
  })

  app.post('/api/pedidos', (req, res) => {
    const { pedido, items } = req.body
    const r = db.prepare(`INSERT INTO pedidos (fecha,restaurante,id_proveedor,proveedor,notas,total,estado,nro_orden,user_id)
      VALUES (@fecha,@restaurante,@id_proveedor,@proveedor,@notas,@total,@estado,@nro_orden,@user_id)`).run({ ...pedido, user_id: req.user.id })
    const id = Number(r.lastInsertRowid)
    const ins = db.prepare('INSERT INTO pedido_items (id_pedido,codigo_producto,producto,cantidad,unidad,precio_unitario,subtotal) VALUES (@id_pedido,@codigo_producto,@producto,@cantidad,@unidad,@precio_unitario,@subtotal)')
    for (const item of (items || [])) ins.run({ ...item, id_pedido: id })
    res.json({ id, ...pedido, items })
  })

  app.put('/api/pedidos/:id/estado', (req, res) => {
    db.prepare('UPDATE pedidos SET estado = ? WHERE id = ?').run(req.body.estado, req.params.id)
    res.json({ ok: true })
  })

  app.delete('/api/pedidos/:id', (req, res) => {
    db.prepare('DELETE FROM pedido_items WHERE id_pedido = ?').run(req.params.id)
    db.prepare('DELETE FROM pedidos WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  })

  // ── Users (admin only) ────────────────────────────────────────────────────
  app.get('/api/users', adminOnly, (req, res) => {
    res.json(db.prepare('SELECT id, username, role, display_name, active, created_at FROM users ORDER BY id').all())
  })

  app.post('/api/users', adminOnly, (req, res) => {
    const { username, password, role, display_name } = req.body
    const hash = bcrypt.hashSync(password, 10)
    const r = db.prepare('INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)').run(username, hash, role || 'user', display_name || username)
    res.json({ id: Number(r.lastInsertRowid), username, role: role || 'user', display_name: display_name || username })
  })

  app.put('/api/users/:id', adminOnly, (req, res) => {
    const { username, role, display_name, password } = req.body
    if (password) {
      const hash = bcrypt.hashSync(password, 10)
      db.prepare('UPDATE users SET username=?, role=?, display_name=?, password_hash=? WHERE id=?').run(username, role, display_name, hash, req.params.id)
    } else {
      db.prepare('UPDATE users SET username=?, role=?, display_name=? WHERE id=?').run(username, role, display_name, req.params.id)
    }
    res.json({ ok: true })
  })

  app.delete('/api/users/:id', adminOnly, (req, res) => {
    if (req.params.id === '1') return res.status(400).json({ error: 'No se puede eliminar el administrador principal' })
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  })

  // ── Static files (React frontend) ────────────────────────────────────────
  if (distPath && fs.existsSync(distPath)) {
    app.use(express.static(distPath))
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' })
      res.sendFile(path.join(distPath, 'index.html'))
    })
  }

  return app
}
