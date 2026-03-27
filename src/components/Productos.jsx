import { useState, useEffect, useRef } from 'react'

import api from "../api"

const CATEGORIAS = ['Aceites','Aderezos','Almacén','Bebidas','Carnes','Embutidos','Especias','Frutas','Harinas','Lácteos','Legumbres','Limpieza','Mariscos','Panificados','Pescados','Secos','Verduras','Otros']
const UNIDADES = ['kg','g','litro','ml','unidad','docena','bulto','caja','bidon','lata','bolsa','paquete','rollo','metro']

const EMPTY = {
  codigo: '', producto: '', categoria: '', marca: '', unidad_base: '',
  contenido_unitario: '', unidad_medida: '', presentacion_referencia: '',
  alias: '', codigos_maxirest: '', rubro_maxirest: '', activo: 1
}

// Auto-generate our alphanumeric code from product name
function autoCode(nombre, categoria) {
  const PREFIXES = {
    'Aceites': 'ACE', 'Aderezos': 'ADE', 'Almacén': 'ALM', 'Bebidas': 'BEB',
    'Carnes': 'CAR', 'Embutidos': 'EMB', 'Especias': 'ESP', 'Frutas': 'FRU',
    'Harinas': 'HAR', 'Lácteos': 'LAC', 'Legumbres': 'LEG', 'Limpieza': 'LIM',
    'Mariscos': 'MAR', 'Panificados': 'PAN', 'Pescados': 'PES', 'Secos': 'SEC',
    'Verduras': 'VER', 'Otros': 'OTR',
  }
  const prefix = PREFIXES[categoria] || nombre.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X')
  return prefix
}

export default function Productos() {
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [catFilter, setCatFilter] = useState('')
  // Maxirest import wizard
  const [mxModal, setMxModal] = useState(false)
  const [mxStep, setMxStep] = useState(1) // 1: upload, 2: review unicos, 3: review duplicados, 4: done
  const [mxData, setMxData] = useState(null) // { unicos, duplicados, total }
  const [mxSelected, setMxSelected] = useState({}) // { nombre_norm: codigo_maxirest elegido }
  const [mxCodigos, setMxCodigos] = useState({}) // { nombre_norm/codigo_mx: nuestro_codigo }
  const [mxCategorias, setMxCategorias] = useState({}) // { nombre_norm: categoria }
  const [mxLoading, setMxLoading] = useState(false)
  const [mxImporting, setMxImporting] = useState(false)
  // Barcode scanner
  const barcodeRef = useRef(null)
  const [barcodeActive, setBarcodeActive] = useState(false)
  const [barcodeVal, setBarcodeVal] = useState('')

  const load = async () => setItems(await api.productos.getAll())
  useEffect(() => { load() }, [])

  const openNew = () => { setForm(EMPTY); setModal('new') }
  const openEdit = (item) => { setForm({ ...item }); setModal('edit') }
  const closeModal = () => { setModal(null); setForm(EMPTY) }

  const handleSave = async () => {
    if (!form.codigo.trim() || !form.producto.trim()) return
    setSaving(true)
    try {
      const payload = { ...form, contenido_unitario: parseFloat(form.contenido_unitario) || null, activo: form.activo ? 1 : 0 }
      if (modal === 'edit') await api.productos.update(payload)
      else await api.productos.create(payload)
      await load(); closeModal()
    } finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este producto?')) return
    await api.productos.delete(id); await load()
  }

  // ── Barcode scanner ──────────────────────────────────────────────────────────
  const handleBarcodeSearch = (val) => {
    const code = val.trim().toUpperCase()
    if (!code) return
    const found = items.find(i =>
      i.codigo === code ||
      (i.codigos_maxirest || '').split(',').map(s => s.trim()).includes(code)
    )
    if (found) { openEdit(found); setBarcodeVal('') }
    else { alert(`Código "${code}" no encontrado en el sistema.`); setBarcodeVal('') }
  }

  // ── Maxirest import ──────────────────────────────────────────────────────────
  const handleMxUpload = async () => {
    setMxLoading(true)
    try {
      const path = await api.dialog.openFile()
      if (!path) return
      const data = await api.maxirest.parseInsumos(path)
      setMxData(data)
      // Init selection: for duplicates, pick the one with highest price (most recent)
      const sel = {}
      data.duplicados.forEach(g => {
        const best = g.rows.reduce((a, b) => (b.precio > a.precio ? b : a))
        sel[g.nombre_norm] = best.codigo_maxirest
      })
      setMxSelected(sel)
      // Init codes for unique items
      const cods = {}
      const cats = {}
      data.unicos.forEach(u => { cods[u.codigo_maxirest] = ''; cats[u.codigo_maxirest] = '' })
      data.duplicados.forEach(g => { cods[g.nombre_norm] = ''; cats[g.nombre_norm] = '' })
      setMxCodigos(cods); setMxCategorias(cats)
      setMxStep(2)
    } finally { setMxLoading(false) }
  }

  const handleMxImport = async () => {
    setMxImporting(true)
    try {
      // Build payload from unicos + resolved duplicados
      const payload = []

      // Count existing codes to auto-number
      const usedCodes = new Set(items.map(i => i.codigo))
      const counters = {}
      const getCode = (prefix) => {
        counters[prefix] = (counters[prefix] || 0) + 1
        let c
        do { c = `${prefix}${String(counters[prefix]).padStart(3, '0')}` } while (usedCodes.has(c) && counters[prefix]++ < 999)
        usedCodes.add(c); return c
      }

      mxData.unicos.forEach(u => {
        const cat = mxCategorias[u.codigo_maxirest] || ''
        const prefix = autoCode(u.nombre, cat)
        const codigo = mxCodigos[u.codigo_maxirest]?.trim().toUpperCase() || getCode(prefix)
        payload.push({
          codigo,
          producto: u.nombre,
          categoria: cat,
          unidad_base: u.unidad_norm || 'unidad',
          unidad_medida: u.unidad_norm || 'unidad',
          codigos_maxirest: u.codigo_maxirest,
          rubro_maxirest: u.cod_rui || '',
        })
      })

      mxData.duplicados.forEach(g => {
        const sel = mxSelected[g.nombre_norm]
        const row = g.rows.find(r => r.codigo_maxirest === sel) || g.rows[0]
        const allCodes = g.rows.map(r => r.codigo_maxirest).join(', ')
        const cat = mxCategorias[g.nombre_norm] || ''
        const prefix = autoCode(row.nombre, cat)
        const codigo = mxCodigos[g.nombre_norm]?.trim().toUpperCase() || getCode(prefix)
        payload.push({
          codigo,
          producto: row.nombre,
          categoria: cat,
          unidad_base: row.unidad_norm || 'unidad',
          unidad_medida: row.unidad_norm || 'unidad',
          codigos_maxirest: allCodes, // store ALL maxirest codes
          rubro_maxirest: row.cod_rui || '',
        })
      })

      await api.maxirest.importarInsumos(payload)
      await load()
      setMxStep(4)
    } finally { setMxImporting(false) }
  }

  const closeMxModal = () => {
    setMxModal(false); setMxStep(1); setMxData(null)
    setMxSelected({}); setMxCodigos({}); setMxCategorias({})
  }

  // Filters
  const cats = [...new Set(items.map(i => i.categoria).filter(Boolean))].sort()
  const filtered = items.filter(i => {
    const q = search.toLowerCase()
    const matchSearch = !q || i.codigo?.toLowerCase().includes(q) || i.producto?.toLowerCase().includes(q) || i.alias?.toLowerCase().includes(q) || (i.codigos_maxirest || '').includes(q)
    return matchSearch && (!catFilter || i.categoria === catFilter)
  })

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Productos</h2>
          <p>Base maestra de insumos con códigos alfanuméricos propios</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={() => { setBarcodeActive(v => !v) }}>
            {barcodeActive ? '✕ Cerrar escáner' : '📷 Lector de código de barras'}
          </button>
          <button className="btn btn-secondary" onClick={() => setMxModal(true)}>
            📥 Importar desde Maxirest
          </button>
          <button className="btn btn-primary" onClick={openNew}>+ Nuevo producto</button>
        </div>
      </div>
      <div className="page-body">

        {/* Barcode scanner bar */}
        {barcodeActive && (
          <div className="alert alert-info mb-3" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <span>🔍 Escáner activo — Escaneá un código de barras o ingresalo manualmente:</span>
            <input
              ref={barcodeRef}
              className="form-input"
              style={{ width: '200px' }}
              placeholder="Código..."
              value={barcodeVal}
              autoFocus
              onChange={e => setBarcodeVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleBarcodeSearch(barcodeVal) }}
            />
            <button className="btn btn-primary btn-sm" onClick={() => handleBarcodeSearch(barcodeVal)}>Buscar</button>
          </div>
        )}

        {/* Filters */}
        <div className="card mb-3">
          <div className="card-body" style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 16px' }}>
            <div className="search-bar" style={{ flex: 1 }}>
              <input className="form-input" placeholder="Buscar por código, nombre, alias o código Maxirest..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="form-select" style={{ width: '180px' }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="">Todas las categorías</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="text-muted">{filtered.length} productos</span>
          </div>
        </div>

        <div className="card">
          <div className="table-wrapper">
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="icon">📦</div>
                <p>{items.length === 0
                  ? 'No hay productos. Usá "Importar desde Maxirest" para cargar tu base existente, o "Nuevo producto" para empezar.'
                  : 'No se encontraron resultados.'}</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Producto</th>
                    <th>Categoría</th>
                    <th>Unidad</th>
                    <th>Alias</th>
                    <th>Cód. Maxirest</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => (
                    <tr key={item.id}>
                      <td><span className="font-mono badge badge-blue">{item.codigo}</span></td>
                      <td style={{ fontWeight: 500 }}>{item.producto}</td>
                      <td><span className="text-muted">{item.categoria}</span></td>
                      <td>{item.unidad_medida || item.unidad_base}</td>
                      <td><span className="truncate text-muted" title={item.alias}>{item.alias || '—'}</span></td>
                      <td>
                        {item.codigos_maxirest
                          ? <span className="font-mono text-muted" style={{ fontSize: '11px' }}>{item.codigos_maxirest}</span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td><span className={`badge ${item.activo ? 'badge-green' : 'badge-gray'}`}>{item.activo ? 'Activo' : 'Inactivo'}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(item)}>✏️</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(item.id)}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ── Edit/New modal ─────────────────────────────────────────────────── */}
      {modal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <h3>{modal === 'edit' ? 'Editar producto' : 'Nuevo producto'}</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="form-label">Código propio *</label>
                  <input className="form-input font-mono" placeholder="Ej: PES001" value={form.codigo}
                    onChange={e => setForm(f => ({ ...f, codigo: e.target.value.toUpperCase() }))} />
                  <div className="text-muted mt-1">Código alfanumérico interno del sistema (independiente de Maxirest)</div>
                </div>
                <div className="form-group">
                  <label className="form-label">Producto *</label>
                  <input className="form-input" placeholder="Nombre normalizado" value={form.producto}
                    onChange={e => setForm(f => ({ ...f, producto: e.target.value }))} />
                </div>
              </div>
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="form-label">Categoría</label>
                  <select className="form-select" value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}>
                    <option value="">Sin categoría</option>
                    {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Marca</label>
                  <input className="form-input" placeholder="Genérica" value={form.marca || ''}
                    onChange={e => setForm(f => ({ ...f, marca: e.target.value }))} />
                </div>
              </div>
              <div className="form-row form-row-3">
                <div className="form-group">
                  <label className="form-label">Unidad base</label>
                  <input className="form-input" placeholder="bolsa, lata, bidon…" value={form.unidad_base || ''}
                    onChange={e => setForm(f => ({ ...f, unidad_base: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Contenido</label>
                  <input className="form-input" type="number" placeholder="Ej: 5" value={form.contenido_unitario || ''}
                    onChange={e => setForm(f => ({ ...f, contenido_unitario: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Unidad medida</label>
                  <select className="form-select" value={form.unidad_medida || ''} onChange={e => setForm(f => ({ ...f, unidad_medida: e.target.value }))}>
                    <option value="">—</option>
                    {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Alias (separados por coma)</label>
                <textarea className="form-textarea" style={{ minHeight: '48px' }}
                  placeholder="Ej: harina 000, harina 25kg, har 000"
                  value={form.alias || ''} onChange={e => setForm(f => ({ ...f, alias: e.target.value }))} />
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px', marginTop: '4px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '10px' }}>
                  🔗 Vinculación con Maxirest
                </div>
                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label className="form-label">Códigos Maxirest</label>
                    <input className="form-input font-mono" placeholder="Ej: 552, 438 (separados por coma si son varios)"
                      value={form.codigos_maxirest || ''}
                      onChange={e => setForm(f => ({ ...f, codigos_maxirest: e.target.value }))} />
                    <div className="text-muted mt-1">Códigos numéricos que usa Maxirest para este mismo insumo</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rubro Maxirest</label>
                    <input className="form-input" placeholder="Ej: Pescados, Lácteos…"
                      value={form.rubro_maxirest || ''}
                      onChange={e => setForm(f => ({ ...f, rubro_maxirest: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!form.activo} onChange={e => setForm(f => ({ ...f, activo: e.target.checked ? 1 : 0 }))} />
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>Producto activo</span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeModal}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.codigo || !form.producto}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Maxirest import wizard ─────────────────────────────────────────── */}
      {mxModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeMxModal()}>
          <div className="modal modal-lg" style={{ width: '860px', maxHeight: '88vh' }}>
            <div className="modal-header">
              <h3>📥 Importar insumos desde Maxirest</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeMxModal}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px' }}>

              {/* Step 1 */}
              {mxStep === 1 && (
                <div>
                  <div className="alert alert-info mb-3">
                    Seleccioná el archivo <strong>INSUMO.XLSX</strong> exportado de Maxirest.<br />
                    El sistema va a limpiar automáticamente las unidades y detectar duplicados.
                  </div>
                  <div className="upload-zone" onClick={handleMxUpload} style={{ cursor: mxLoading ? 'wait' : 'pointer' }}>
                    <div className="icon">📂</div>
                    <div style={{ fontWeight: 600 }}>{mxLoading ? 'Analizando archivo...' : 'Clic para seleccionar INSUMO.XLSX'}</div>
                    <div className="text-muted">Menú → Stock → Inventarios → Exportar Excel</div>
                  </div>
                </div>
              )}

              {/* Step 2: Review unicos + duplicados */}
              {mxStep === 2 && mxData && (
                <div>
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
                    <div className="stat-card" style={{ flex: 1, minWidth: '140px', padding: '12px' }}>
                      <div className="stat-number" style={{ fontSize: '22px' }}>{mxData.total}</div>
                      <div className="stat-label">Insumos en Maxirest</div>
                    </div>
                    <div className="stat-card" style={{ flex: 1, minWidth: '140px', padding: '12px' }}>
                      <div className="stat-number" style={{ fontSize: '22px' }}>{mxData.unicos.length}</div>
                      <div className="stat-label">Sin duplicados</div>
                    </div>
                    <div className="stat-card" style={{ flex: 1, minWidth: '140px', padding: '12px' }}>
                      <div className="stat-number" style={{ fontSize: '22px', color: 'var(--warning)' }}>{mxData.duplicados.length}</div>
                      <div className="stat-label">Con duplicados detectados</div>
                    </div>
                  </div>

                  {mxData.duplicados.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>
                        ⚠️ Duplicados detectados — seleccioná cuál mantener como principal:
                      </div>
                      <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
                        <table>
                          <thead><tr><th>Nombre</th><th>Opciones (código Maxirest)</th><th>Todos los códigos guardados</th></tr></thead>
                          <tbody>
                            {mxData.duplicados.map(g => (
                              <tr key={g.nombre_norm}>
                                <td style={{ fontWeight: 500 }}>{g.rows[0].nombre}</td>
                                <td>
                                  <select className="form-select" style={{ fontSize: '12px', padding: '3px 6px' }}
                                    value={mxSelected[g.nombre_norm] || ''}
                                    onChange={e => setMxSelected(s => ({ ...s, [g.nombre_norm]: e.target.value }))}>
                                    {g.rows.map(r => (
                                      <option key={r.codigo_maxirest} value={r.codigo_maxirest}>
                                        #{r.codigo_maxirest} — {r.unidad_raw} — ${r.precio > 0 ? r.precio.toLocaleString('es-AR') : '0'} ({r.ult_compra || 'sin compra'})
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="text-muted font-mono" style={{ fontSize: '11px' }}>
                                  {g.rows.map(r => r.codigo_maxirest).join(', ')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>
                    Asignar categoría a los insumos (opcional — podés hacerlo después):
                  </div>
                  <div className="alert alert-warning mb-3" style={{ fontSize: '12px' }}>
                    Los códigos propios (ACE001, TOM001…) se generan automáticamente si no los completás.
                    Podés editarlos después desde la pantalla de Productos.
                  </div>
                  <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
                    <table>
                      <thead><tr><th>Código Maxirest</th><th>Nombre (normalizado)</th><th>Unidad</th><th>Categoría</th><th>Código propio (opcional)</th></tr></thead>
                      <tbody>
                        {[...mxData.unicos.map(u => ({ key: u.codigo_maxirest, nombre: u.nombre, unidad: u.unidad_norm, isGroup: false })),
                          ...mxData.duplicados.map(g => ({ key: g.nombre_norm, nombre: g.rows[0].nombre, unidad: g.rows[0].unidad_norm, isGroup: true }))
                        ].map(row => (
                          <tr key={row.key}>
                            <td><span className="font-mono badge badge-gray">{row.key}</span></td>
                            <td style={{ fontWeight: 500 }}>{row.nombre}</td>
                            <td className="text-muted">{row.unidad}</td>
                            <td>
                              <select className="form-select" style={{ fontSize: '12px', padding: '3px 6px' }}
                                value={mxCategorias[row.key] || ''}
                                onChange={e => setMxCategorias(c => ({ ...c, [row.key]: e.target.value }))}>
                                <option value="">Sin categoría</option>
                                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </td>
                            <td>
                              <input className="form-input font-mono" style={{ padding: '3px 6px', fontSize: '12px', width: '90px' }}
                                placeholder="Auto"
                                value={mxCodigos[row.key] || ''}
                                onChange={e => setMxCodigos(c => ({ ...c, [row.key]: e.target.value.toUpperCase() }))} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Step 4: Done */}
              {mxStep === 4 && (
                <div style={{ textAlign: 'center', padding: '32px' }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
                  <h3 style={{ marginBottom: '8px' }}>Insumos importados correctamente</h3>
                  <p className="text-muted">
                    Los productos ya están disponibles con sus códigos propios y sus códigos Maxirest vinculados.
                    Podés editar categorías, alias y unidades desde la tabla de Productos.
                  </p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              {mxStep === 1 && <button className="btn btn-secondary" onClick={closeMxModal}>Cancelar</button>}
              {mxStep === 2 && (
                <>
                  <button className="btn btn-secondary" onClick={() => setMxStep(1)}>← Atrás</button>
                  <button className="btn btn-primary" onClick={handleMxImport} disabled={mxImporting}>
                    {mxImporting ? 'Importando...' : `✓ Importar ${(mxData?.unicos?.length || 0) + (mxData?.duplicados?.length || 0)} productos`}
                  </button>
                </>
              )}
              {mxStep === 4 && <button className="btn btn-primary" onClick={closeMxModal}>Cerrar</button>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

