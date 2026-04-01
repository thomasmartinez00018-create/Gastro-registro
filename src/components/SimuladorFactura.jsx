import { useState, useEffect, useRef } from 'react'
import api from '../api'
import { loadAppSettings } from './Configuracion'
import { buildWALink, buildOrderMessage } from '../utils/whatsapp'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n) =>
  n != null ? `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

/** Precio más reciente por código de producto para un proveedor dado */
function buildLatestPriceMap(comparativaRows, idProveedor) {
  const map = {}
  comparativaRows
    .filter(r => r.id_proveedor === idProveedor)
    .forEach(r => {
      const k = r.codigo_producto
      if (!map[k] || (r.fecha || '') > (map[k].fecha || '')) map[k] = r
    })
  return map
}

// ─── Estilos de impresión (inyectados una vez) ─────────────────────────────────
const PRINT_STYLE_ID = 'simulador-print-styles'
function injectPrintStyles() {
  if (document.getElementById(PRINT_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = PRINT_STYLE_ID
  style.textContent = `
    @media print {
      .sidebar, .page-header, .sim-controls, .sim-add-bar, .no-print { display: none !important; }
      .app-layout { display: block !important; }
      .main-content { margin: 0 !important; padding: 0 !important; }
      .page-body { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
      .sim-factura { box-shadow: none !important; border: none !important; padding: 24px !important; }
      body { background: white !important; }
    }
  `
  document.head.appendChild(style)
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function SimuladorFactura() {
  const [proveedores, setProveedores]     = useState([])
  const [comparativa, setComparativa]     = useState([])
  const [productos, setProductos]         = useState([])
  const [loading, setLoading]             = useState(false)

  const [selectedProvId, setSelectedProvId] = useState('')
  const [items, setItems]                 = useState([])
  const [searchProd, setSearchProd]       = useState('')
  const [showDropdown, setShowDropdown]   = useState(false)

  const [appSettings, setAppSettings]     = useState({ restaurantName: '', logoBase64: '' })
  const [historialModal, setHistorialModal] = useState(false)
  const [historial,      setHistorial]      = useState([])
  const [histLoading,    setHistLoading]    = useState(false)
  const [waSending,      setWaSending]      = useState(false)
  const [fechaFactura, setFechaFactura]   = useState(todayStr())
  const [nroOrden, setNroOrden]           = useState('')
  const [notas, setNotas]                 = useState('')

  const searchRef  = useRef(null)
  const dropdownEl = useRef(null)

  useEffect(() => {
    injectPrintStyles()
    const s = loadAppSettings()
    setAppSettings(s)
  }, [])

  const loadHistorial = async () => {
    if (!window.api?.pedidos) return
    setHistLoading(true)
    try {
      const data = await api.pedidos.getAll()
      setHistorial(data)
    } finally { setHistLoading(false) }
  }

  const load = async () => {
    setLoading(true)
    try {
      const [provs, comp, prods] = await Promise.all([
        api.proveedores.getAll(),
        api.comparador.getComparativa({}),
        api.productos.getAll(),
      ])
      setProveedores(provs.filter(p => p.activo !== 0))
      setComparativa(comp)
      setProductos(prods.filter(p => p.activo !== 0))
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handler = (e) => {
      if (dropdownEl.current && !dropdownEl.current.contains(e.target) &&
          searchRef.current && !searchRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Datos del proveedor seleccionado ──────────────────────────────────────
  const prov         = proveedores.find(p => p.id_proveedor === selectedProvId) || null
  const latestPrices = selectedProvId ? buildLatestPriceMap(comparativa, selectedProvId) : {}

  // Cuántos productos tiene precio de este proveedor
  const cantPreciosDisponibles = Object.keys(latestPrices).length

  // ── Búsqueda de productos ─────────────────────────────────────────────────
  const q = searchProd.trim().toLowerCase()
  const prodResults = q.length >= 1
    ? productos.filter(p =>
        p.producto?.toLowerCase().includes(q) ||
        p.codigo?.toLowerCase().includes(q)
      ).slice(0, 10)
    : []

  // ── Agregar ítem ─────────────────────────────────────────────────────────
  const addItem = (prod) => {
    const pr = latestPrices[prod.codigo]
    setItems(prev => [...prev, {
      id:          Date.now() + Math.random(),
      codigoProd:  prod.codigo,
      nombre:      prod.producto,
      presentacion: pr?.presentacion_original || prod.presentacion_referencia || '',
      tipoCompra:  pr?.tipo_compra || 'UNIDAD',
      precio:      pr?.precio_informado ?? null,
      qty:         1,
    }])
    setSearchProd('')
    setShowDropdown(false)
    searchRef.current?.focus()
  }

  const updateItem  = (id, field, value) => setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
  const removeItem  = (id) => setItems(prev => prev.filter(it => it.id !== id))
  const clearItems  = () => { if (window.confirm('¿Limpiar todos los ítems?')) setItems([]) }

  // ── Cálculos fiscales ─────────────────────────────────────────────────────
  const subtotalNeto = items.reduce((acc, it) => acc + (it.precio ?? 0) * it.qty, 0)
  const descuento    = subtotalNeto * ((prov?.descuento_pct || 0) / 100)
  const baseImpon    = subtotalNeto - descuento
  const iva          = baseImpon * (prov?.aplica_iva         ? 0.21 : 0)
  const percepcion   = baseImpon * (prov?.aplica_percepcion  ? 0.03 : 0)
  const interno      = baseImpon * ((prov?.impuesto_interno  || 0) / 100)
  const totalFinal   = baseImpon + iva + percepcion + interno
  const hayImpuestos = descuento > 0 || iva > 0 || percepcion > 0 || interno > 0

  const handlePrint = () => window.print()

  const handleEnviarWA = async () => {
    if (!prov || !items.length) return
    setWaSending(true)
    try {
      const restaurante = appSettings.restaurantName || ''
      const message = buildOrderMessage({
        restaurante,
        proveedor: prov.proveedor,
        fecha: fechaFactura,
        items: items.map(it => ({ producto: it.nombre, cantidad: it.qty, unidad: '' })),
        total: totalFinal,
      })

      // Guardar en historial
      if (window.api?.pedidos) {
        await api.pedidos.create({
          pedido: {
            fecha: fechaFactura,
            restaurante,
            id_proveedor: prov.id_proveedor,
            proveedor: prov.proveedor,
            notas: notas || null,
            total: totalFinal,
            estado: 'enviado',
            nro_orden: nroOrden || null,
          },
          items: items.map(it => ({
            codigo_producto: it.codigoProd,
            producto: it.nombre,
            cantidad: it.qty,
            unidad: '',
            precio_unitario: it.precio,
            subtotal: (it.precio ?? 0) * it.qty,
          })),
        })
      }

      // Abrir WhatsApp
      const link = prov.whatsapp ? buildWALink(prov.whatsapp, message) : null
      if (link) {
        window.open(link, '_blank')
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = message
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        alert(`📋 Mensaje copiado.\n\n${prov.proveedor} no tiene WhatsApp cargado.\nAgregalo en Proveedores para enviar directo.`)
      }
    } finally { setWaSending(false) }
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="page-header no-print">
        <div>
          <h2 className="page-title">🧾 Simulador de Factura</h2>
          <p className="page-subtitle">Armá una orden de compra y calculá el total con impuestos</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-secondary"
            onClick={() => { setHistorialModal(true); loadHistorial() }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>history</span>
            Historial
          </button>
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            {loading ? '⏳...' : '↺ Actualizar'}
          </button>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 900 }}>

        {/* ── Panel de controles (oculto al imprimir) ────────────────────── */}
        <div className="sim-controls no-print">

          {/* Selección de proveedor + encabezado */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontSize: '22px' }}>🚚</span>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>Proveedor y encabezado</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '0' }}>
              {/* Proveedor */}
              <div style={{ gridColumn: '1 / span 1' }}>
                <label style={labelStyle}>Proveedor *</label>
                <select
                  className="form-select"
                  value={selectedProvId}
                  onChange={e => { setSelectedProvId(e.target.value); setItems([]) }}
                  style={{ width: '100%' }}
                >
                  <option value="">— Seleccioná un proveedor —</option>
                  {proveedores.map(p => (
                    <option key={p.id_proveedor} value={p.id_proveedor}>{p.proveedor}</option>
                  ))}
                </select>
              </div>

              {/* Fecha */}
              <div>
                <label style={labelStyle}>Fecha</label>
                <input
                  type="date"
                  className="form-input"
                  value={fechaFactura}
                  onChange={e => setFechaFactura(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              {/* N° Orden */}
              <div>
                <label style={labelStyle}>N° Orden (opcional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="OC-0001"
                  value={nroOrden}
                  onChange={e => setNroOrden(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            {/* Info fiscal del proveedor */}
            {prov && (
              <div style={{
                marginTop: '12px',
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'var(--accent-light)',
                fontSize: '13px',
                display: 'flex',
                gap: '16px',
                flexWrap: 'wrap',
                alignItems: 'center',
              }}>
                <span style={{ fontWeight: 600, color: 'var(--accent)' }}>Condiciones:</span>
                {prov.descuento_pct > 0      && <span className="badge badge-green">Descuento {prov.descuento_pct}%</span>}
                {prov.aplica_iva             && <span className="badge badge-blue">IVA 21%</span>}
                {prov.aplica_percepcion      && <span className="badge badge-blue">Perc. IIBB 3%</span>}
                {prov.impuesto_interno > 0   && <span className="badge badge-yellow">Imp. Interno {prov.impuesto_interno}%</span>}
                {!prov.descuento_pct && !prov.aplica_iva && !prov.aplica_percepcion && !prov.impuesto_interno && (
                  <span style={{ color: 'var(--text-muted)' }}>Sin impuestos/descuentos configurados</span>
                )}
                {cantPreciosDisponibles > 0 && (
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '12px' }}>
                    📋 {cantPreciosDisponibles} productos con precio de lista
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Agregar productos */}
          {selectedProvId && (
            <div className="card sim-add-bar" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '22px' }}>➕</span>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>Agregar productos</div>
                {items.length > 0 && (
                  <button className="btn btn-secondary" style={{ marginLeft: 'auto', fontSize: '12px' }} onClick={clearItems}>
                    🗑 Limpiar todo
                  </button>
                )}
              </div>

              <div style={{ position: 'relative' }}>
                <input
                  ref={searchRef}
                  type="text"
                  className="form-input"
                  placeholder="Buscar producto por nombre o código..."
                  value={searchProd}
                  onChange={e => { setSearchProd(e.target.value); setShowDropdown(true) }}
                  onFocus={() => setShowDropdown(true)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { setShowDropdown(false); setSearchProd('') }
                    if (e.key === 'Enter' && prodResults.length === 1) addItem(prodResults[0])
                  }}
                  style={{ width: '100%' }}
                />

                {showDropdown && prodResults.length > 0 && (
                  <div
                    ref={dropdownEl}
                    style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                      maxHeight: '280px', overflowY: 'auto', marginTop: '4px',
                    }}
                  >
                    {prodResults.map(prod => {
                      const pr = latestPrices[prod.codigo]
                      return (
                        <button
                          key={prod.codigo}
                          onClick={() => addItem(prod)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            width: '100%', padding: '10px 14px', textAlign: 'left',
                            background: 'none', border: 'none', cursor: 'pointer',
                            borderBottom: '1px solid var(--border)',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '60px' }}>{prod.codigo}</span>
                          <span style={{ flex: 1, fontWeight: 500 }}>{prod.producto}</span>
                          {prod.categoria && <span className="badge badge-gray" style={{ fontSize: '10px' }}>{prod.categoria}</span>}
                          {pr ? (
                            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                              {fmt(pr.precio_informado)}
                            </span>
                          ) : (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>sin precio</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                {showDropdown && q.length >= 1 && prodResults.length === 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: '8px', padding: '12px 16px', marginTop: '4px',
                    fontSize: '13px', color: 'var(--text-muted)',
                  }}>
                    No se encontraron productos con "{searchProd}"
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notas */}
          {selectedProvId && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ ...labelStyle, display: 'block', marginBottom: '6px' }}>Notas / Observaciones (opcional)</label>
              <textarea
                className="form-input"
                rows={2}
                placeholder="Ej: Entrega el jueves, pedir factura tipo B..."
                value={notas}
                onChange={e => setNotas(e.target.value)}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>
          )}
        </div>

        {/* ── FACTURA (se imprime) ───────────────────────────────────────── */}
        {!selectedProvId ? (
          <div className="card no-print">
            <div className="empty-state">
              <div className="icon">🧾</div>
              <p>Seleccioná un proveedor para comenzar a armar la orden de compra</p>
            </div>
          </div>
        ) : (
          <div className="card sim-factura" style={{
            padding: '32px',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
          }}>

            {/* ── Encabezado factura ─────────────────────────────────────── */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              marginBottom: '28px', gap: '20px',
            }}>
              {/* Logo + nombre del negocio */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {appSettings.logoBase64 ? (
                  <img
                    src={appSettings.logoBase64}
                    alt="Logo"
                    style={{ width: '56px', height: '56px', objectFit: 'contain', borderRadius: '8px' }}
                  />
                ) : (
                  <div style={{
                    width: '56px', height: '56px', borderRadius: '8px',
                    background: 'var(--accent-light)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '28px',
                  }}>🍴</div>
                )}
                <div>
                  <div style={{ fontWeight: 800, fontSize: '18px' }}>
                    {appSettings.restaurantName || 'Mi Negocio'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Sistema de Gestión de Proveedores
                  </div>
                </div>
              </div>

              {/* Título + número de orden */}
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontSize: '22px', fontWeight: 900, color: 'var(--accent)',
                  letterSpacing: '.03em', textTransform: 'uppercase',
                }}>
                  Orden de Compra
                </div>
                {nroOrden && (
                  <div style={{ fontSize: '14px', fontWeight: 700, marginTop: '4px' }}>
                    N° {nroOrden}
                  </div>
                )}
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Fecha: <strong>{fechaFactura}</strong>
                </div>
              </div>
            </div>

            {/* ── Info del proveedor ─────────────────────────────────────── */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0',
              borderTop: '2px solid var(--accent)',
              borderBottom: '1px solid var(--border)',
              padding: '14px 0',
              marginBottom: '24px',
            }}>
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '4px' }}>
                  Proveedor
                </div>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>{prov?.proveedor}</div>
                {prov?.contacto && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{prov.contacto}</div>}
                {prov?.whatsapp && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>WhatsApp: {prov.whatsapp}</div>}
                {prov?.email    && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{prov.email}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '4px' }}>
                  Condiciones comerciales
                </div>
                <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {prov?.descuento_pct > 0    && <span className="badge badge-green">Desc. {prov.descuento_pct}%</span>}
                  {prov?.aplica_iva            && <span className="badge badge-blue">IVA 21%</span>}
                  {prov?.aplica_percepcion     && <span className="badge badge-blue">Perc. 3%</span>}
                  {prov?.impuesto_interno > 0  && <span className="badge badge-yellow">Int. {prov.impuesto_interno}%</span>}
                  {!prov?.descuento_pct && !prov?.aplica_iva && !prov?.aplica_percepcion && !prov?.impuesto_interno && (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Precio de lista</span>
                  )}
                </div>
              </div>
            </div>

            {/* ── Tabla de ítems ─────────────────────────────────────────── */}
            {items.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '40px', border: '2px dashed var(--border)',
                borderRadius: '10px', color: 'var(--text-muted)', marginBottom: '24px',
              }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>📦</div>
                <div>Buscá productos arriba para agregarlos a la orden</div>
              </div>
            ) : (
              <div className="table-wrapper" style={{ marginBottom: '24px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--accent)', color: '#fff' }}>
                      <th style={thStyle}>Código</th>
                      <th style={{ ...thStyle, textAlign: 'left', width: '35%' }}>Producto</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Presentación</th>
                      <th style={thStyle}>Tipo</th>
                      <th style={thStyle}>Cant.</th>
                      <th style={thStyle}>Precio unit.</th>
                      <th style={thStyle}>Subtotal</th>
                      <th style={{ ...thStyle, width: '36px' }} className="no-print"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const lineTotal = (item.precio ?? 0) * item.qty
                      const sinPrecio = item.precio == null
                      return (
                        <tr key={item.id} style={{ background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)' }}>
                          <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)' }}>
                            {item.codigoProd}
                          </td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>
                            {item.nombre}
                          </td>
                          <td style={{ ...tdStyle, fontSize: '12px', color: 'var(--text-muted)' }}>
                            {item.presentacion || '—'}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <span className={`badge ${item.tipoCompra === 'CAJA' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: '10px' }}>
                              {item.tipoCompra}
                            </span>
                          </td>
                          {/* Qty con +/- */}
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}>
                              <button
                                onClick={() => updateItem(item.id, 'qty', Math.max(0.5, item.qty - (item.qty > 1 ? 1 : 0.5)))}
                                style={qtyBtnStyle}
                              >−</button>
                              <input
                                type="number"
                                min="0.1"
                                step="0.5"
                                value={item.qty}
                                onChange={e => {
                                  const v = parseFloat(e.target.value)
                                  if (!isNaN(v) && v > 0) updateItem(item.id, 'qty', v)
                                }}
                                style={{
                                  width: '50px', textAlign: 'center',
                                  padding: '4px', borderRadius: '6px',
                                  border: '1px solid var(--border)',
                                  background: 'var(--bg)', color: 'var(--text)',
                                  fontSize: '13px',
                                }}
                              />
                              <button
                                onClick={() => updateItem(item.id, 'qty', item.qty + 1)}
                                style={qtyBtnStyle}
                              >+</button>
                            </div>
                            {/* Solo para impresión */}
                            <span className="print-only" style={{ display: 'none' }}>{item.qty}</span>
                          </td>
                          {/* Precio editable */}
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>$</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.precio ?? ''}
                                placeholder="0.00"
                                onChange={e => {
                                  const v = e.target.value === '' ? null : parseFloat(e.target.value)
                                  updateItem(item.id, 'precio', isNaN(v) ? null : v)
                                }}
                                style={{
                                  width: '90px', textAlign: 'right',
                                  padding: '4px 6px', borderRadius: '6px',
                                  border: sinPrecio ? '1px solid var(--warning)' : '1px solid var(--border)',
                                  background: sinPrecio ? '#fff8e1' : 'var(--bg)',
                                  color: 'var(--text)', fontSize: '13px',
                                }}
                              />
                            </div>
                            <span className="print-only" style={{ display: 'none', fontWeight: 600 }}>
                              {sinPrecio ? '—' : fmt(item.precio)}
                            </span>
                            {sinPrecio && (
                              <div style={{ fontSize: '10px', color: 'var(--warning)', marginTop: '2px' }}>
                                sin precio
                              </div>
                            )}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: sinPrecio ? 'var(--text-muted)' : 'var(--text)' }}>
                            {sinPrecio ? '—' : fmt(lineTotal)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center', padding: '4px' }} className="no-print">
                            <button
                              onClick={() => removeItem(item.id)}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--danger)', fontSize: '16px', padding: '2px 6px',
                                borderRadius: '4px',
                              }}
                              title="Eliminar"
                            >×</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Totales ────────────────────────────────────────────────── */}
            {items.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{
                  minWidth: '320px',
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  overflow: 'hidden',
                }}>

                  {/* Subtotal neto */}
                  <TotalRow label="Subtotal" value={subtotalNeto} />

                  {/* Descuento */}
                  {(prov?.descuento_pct || 0) > 0 && (
                    <>
                      <TotalRow
                        label={`Descuento comercial (${prov.descuento_pct}%)`}
                        value={-descuento}
                        color="#22863a"
                      />
                      <TotalRow label="Subtotal c/descuento" value={baseImpon} muted />
                    </>
                  )}

                  {/* Impuestos */}
                  {prov?.aplica_iva && (
                    <TotalRow label="IVA (21%)" value={iva} color="#1a6fa8" />
                  )}
                  {prov?.aplica_percepcion && (
                    <TotalRow label="Percepción IIBB (3%)" value={percepcion} color="#1a6fa8" />
                  )}
                  {(prov?.impuesto_interno || 0) > 0 && (
                    <TotalRow label={`Impuesto interno (${prov.impuesto_interno}%)`} value={interno} color="#e67e22" />
                  )}

                  {/* TOTAL */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    padding: '14px 18px',
                    background: 'var(--accent)',
                    color: '#fff',
                  }}>
                    <span style={{ fontWeight: 800, fontSize: '16px' }}>TOTAL A PAGAR</span>
                    <span style={{ fontWeight: 900, fontSize: '20px' }}>{fmt(totalFinal)}</span>
                  </div>

                  {/* Ahorro por descuento */}
                  {descuento > 0 && (
                    <div style={{
                      padding: '8px 18px', background: '#f0fdf4', textAlign: 'right',
                      fontSize: '12px', color: '#22863a', fontWeight: 600,
                    }}>
                      ✅ Ahorrás {fmt(descuento)} con el descuento comercial
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Notas ──────────────────────────────────────────────────── */}
            {notas && (
              <div style={{
                marginTop: '24px', padding: '12px 16px',
                borderRadius: '8px', background: 'var(--bg)',
                border: '1px solid var(--border)',
                fontSize: '13px',
              }}>
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>Notas:</div>
                <div style={{ color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{notas}</div>
              </div>
            )}

            {/* ── Footer de la factura ───────────────────────────────────── */}
            <div style={{
              marginTop: '32px', paddingTop: '16px',
              borderTop: '1px dashed var(--border)',
              fontSize: '11px', color: 'var(--text-muted)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
            }}>
              <div>
                Generado por Sistema de Gestión de Proveedores
                {appSettings.restaurantName && ` — ${appSettings.restaurantName}`}
              </div>
              <div>{fechaFactura}</div>
            </div>

            {/* ── Botón imprimir ─────────────────────────────────────────── */}
            {items.length > 0 && (
              <div className="no-print" style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', gap: '10px' }}>
                <button className="btn btn-accent" onClick={handlePrint} style={{ fontSize: '14px', padding: '10px 28px' }}>
                  🖨 Imprimir / Guardar PDF
                </button>
                <button className="btn btn-accent" onClick={handleEnviarWA} disabled={waSending || !prov || !items.length}>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>send</span>
                  {waSending ? 'Enviando...' : 'Pedir por WhatsApp'}
                </button>
                <button className="btn btn-secondary" onClick={clearItems} style={{ fontSize: '14px' }}>
                  🗑 Limpiar orden
                </button>
              </div>
            )}

          </div>
        )}
      </div>

      {/* ── Modal Historial de Pedidos ──────────────────────────────────────── */}
      {historialModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--surface)', borderRadius: '14px', width: '100%', maxWidth: '720px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px' }}>Historial de pedidos</h3>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{historial.length} pedido{historial.length !== 1 ? 's' : ''} guardados</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setHistorialModal(false)}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '12px 20px' }}>
              {histLoading && <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>Cargando…</div>}
              {!histLoading && historial.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '13px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '10px' }}>📋</div>
                  <div>Todavía no hay pedidos guardados.</div>
                  <div style={{ marginTop: '6px', fontSize: '12px' }}>Los pedidos se guardan automáticamente cuando usás "Pedir por WhatsApp".</div>
                </div>
              )}
              {!histLoading && historial.map(p => (
                <div key={p.id} style={{ background: 'var(--surface-2)', borderRadius: '10px', marginBottom: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface-3)' }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: '14px' }}>{p.proveedor}</span>
                      {p.nro_orden && <span style={{ marginLeft: '8px', fontSize: '11px', background: 'var(--primary-light)', color: 'var(--primary)', borderRadius: '4px', padding: '1px 6px' }}>{p.nro_orden}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-AR')}</span>
                      <span style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '14px' }}>
                        {p.total > 0 ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(p.total) : '—'}
                      </span>
                      <select
                        value={p.estado}
                        onChange={async e => {
                          await api.pedidos.updateEstado({ id: p.id, estado: e.target.value })
                          loadHistorial()
                        }}
                        style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '6px', border: '1px solid var(--border)', background: p.estado === 'recibido' ? 'rgba(110,231,183,0.15)' : p.estado === 'cancelado' ? 'rgba(255,100,100,0.12)' : 'rgba(252,197,112,0.12)', color: p.estado === 'recibido' ? 'var(--success)' : p.estado === 'cancelado' ? 'var(--danger)' : 'var(--primary)', fontFamily: 'inherit', cursor: 'pointer' }}
                      >
                        <option value="enviado">📤 Enviado</option>
                        <option value="recibido">✅ Recibido</option>
                        <option value="cancelado">❌ Cancelado</option>
                      </select>
                      <button
                        className="btn btn-ghost btn-xs"
                        style={{ color: 'var(--danger)' }}
                        onClick={async () => {
                          if (!window.confirm('¿Eliminar este pedido del historial?')) return
                          await api.pedidos.delete(p.id)
                          loadHistorial()
                        }}
                        title="Eliminar"
                      >✕</button>
                    </div>
                  </div>
                  <div style={{ padding: '6px 14px 8px' }}>
                    {(p.items || []).map((it, idx) => (
                      <div key={idx} style={{ fontSize: '12px', padding: '3px 0', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-light)' }}>
                        <span>{it.producto} <span style={{ color: 'var(--text-muted)' }}>× {it.cantidad} {it.unidad || ''}</span></span>
                        <span style={{ color: 'var(--text-muted)' }}>{it.subtotal > 0 ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(it.subtotal) : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────
function TotalRow({ label, value, color, muted }) {
  const fmt2 = (n) =>
    `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '8px 18px',
      borderBottom: '1px solid var(--border)',
      background: muted ? 'var(--bg)' : 'transparent',
    }}>
      <span style={{ fontSize: '13px', color: muted ? 'var(--text-muted)' : 'var(--text)' }}>{label}</span>
      <span style={{
        fontSize: '13px', fontWeight: 700,
        color: color || (muted ? 'var(--text-muted)' : 'var(--text)'),
      }}>
        {fmt2(value)}
      </span>
    </div>
  )
}

// ─── Estilos inline ───────────────────────────────────────────────────────────
const labelStyle = {
  fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)',
  marginBottom: '4px', display: 'block',
}

const thStyle = {
  padding: '10px 12px', textAlign: 'center',
  fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em',
  whiteSpace: 'nowrap',
}

const tdStyle = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border)',
  fontSize: '13px',
}

const qtyBtnStyle = {
  width: '26px', height: '26px',
  borderRadius: '6px', border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text)',
  cursor: 'pointer', fontSize: '16px', lineHeight: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
}
