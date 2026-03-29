import { useState, useEffect } from 'react'
import api from '../api'
import { parsePresentacion } from '../utils/presentacion'

function effectivePxm(row) {
  const parsed = parsePresentacion(row.presentacion_original)
  if (parsed && parsed.totalQty > 0 && row.precio_por_unidad != null) {
    return row.precio_por_unidad / parsed.totalQty
  }
  return row.precio_por_medida_base
}

function effectiveBaseUnit(rows) {
  for (const r of rows) {
    const p = parsePresentacion(r.presentacion_original)
    if (p) return p.baseUnit
  }
  return rows[0]?.unidad_medida || 'medida'
}

const fmt = (n) => n != null
  ? `$${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
  : '—'

function defaultDesde() {
  const d = new Date(); d.setDate(d.getDate() - 90)
  return d.toISOString().split('T')[0]
}
function todayStr() { return new Date().toISOString().split('T')[0] }

export default function Comparador() {
  const [data,       setData]       = useState([])
  const [allListas,  setAllListas]  = useState([])
  const [productos,  setProductos]  = useState([])
  const [proveedores,setProveedores]= useState([])
  const [cats,       setCats]       = useState([])
  const [catFilter,  setCatFilter]  = useState('')
  const [search,     setSearch]     = useState('')
  const [loading,    setLoading]    = useState(false)
  const [exporting,  setExporting]  = useState(false)

  const [desde,      setDesde]      = useState(defaultDesde())
  const [hasta,      setHasta]      = useState(todayStr())
  const [viewMode,   setViewMode]   = useState('ultima')
  const [expandedEvo,setExpandedEvo]= useState({})
  const [conImpuestos, setConImpuestos] = useState(false)

  // ── Selección para exportar ─────────────────────────────────────────────────
  const [selectedProds, setSelectedProds] = useState(new Set())

  const provMap = {}
  proveedores.forEach(p => { provMap[p.id_proveedor] = p })

  function multProv(idProv) {
    const p = provMap[idProv]
    if (!p) return 1
    const desc = 1 - (p.descuento_pct || 0) / 100
    const iva  = 1 + (p.aplica_iva ? 0.21 : 0)
    const perc = 1 + (p.aplica_percepcion ? 0.03 : 0)
    const int_ = 1 + (p.impuesto_interno || 0) / 100
    return desc * iva * perc * int_
  }

  function adjustedPxm(row) {
    const base = effectivePxm(row)
    if (base == null) return null
    return conImpuestos ? base * multProv(row.id_proveedor) : base
  }

  const load = async () => {
    setLoading(true)
    try {
      const [rows, prods, listas, provs] = await Promise.all([
        api.comparador.getComparativa({}),
        api.productos.getAll(),
        api.listas.getAll(),
        api.proveedores.getAll(),
      ])
      setData(rows)
      setAllListas(listas)
      setProductos(prods)
      setProveedores(provs)
      setCats([...new Set(prods.map(p => p.categoria).filter(Boolean))].sort())
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  // ── Exportar para Maxirest ──────────────────────────────────────────────────
  const handleExportMaxirest = async () => {
    setExporting(true)
    try {
      const prodMap = {}
      productos.forEach(p => { prodMap[p.codigo] = p })
      const enriched = data.map(r => ({
        ...r,
        codigo_maxirest: prodMap[r.codigo_producto]?.codigos_maxirest?.split(',')[0]?.trim() || r.codigo_producto,
      }))
      if (!window.api) { alert('Exportación a archivo disponible solo en la app de escritorio'); return }
      const savePath = await api.dialog.saveFile({ defaultName: `comparativa_maxirest_${new Date().toISOString().split('T')[0]}.xlsx` })
      if (!savePath) return
      await api.maxirest.exportarComparativa({ rows: enriched, outputPath: savePath })
      alert(`✅ Archivo guardado en:\n${savePath}`)
    } finally { setExporting(false) }
  }

  // ── Filtros y agrupamiento ─────────────────────────────────────────────────
  const dataInRange = data.filter(r => {
    if (!r.fecha) return true
    return r.fecha >= desde && r.fecha <= hasta
  })

  const grouped = {}
  dataInRange.forEach(row => {
    const key = row.codigo_producto
    if (!grouped[key]) grouped[key] = { producto: row.producto_estandar, categoria: row.categoria, unidad_medida: row.unidad_medida, rows: [] }
    grouped[key].rows.push(row)
  })

  const entries = Object.entries(grouped).filter(([cod, g]) => {
    const matchCat = !catFilter || g.categoria === catFilter
    const q = search.toLowerCase()
    const matchSearch = !q || g.producto?.toLowerCase().includes(q) || cod.toLowerCase().includes(q)
    return matchCat && matchSearch
  })

  function getUltimaRows(rows) {
    const byProv = {}
    rows.forEach(r => {
      const key = r.id_proveedor || r.proveedor
      if (!byProv[key] || (r.fecha || '') > (byProv[key].fecha || '')) byProv[key] = r
    })
    return Object.values(byProv)
  }

  function getEvoRows(cod) {
    return allListas
      .filter(l => l.codigo_producto === cod && l.estado_match === 'OK' && l.precio_por_medida_base != null)
      .filter(l => { if (!l.fecha) return true; return l.fecha >= desde && l.fecha <= hasta })
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
  }

  // ── Selección helpers ──────────────────────────────────────────────────────
  const toggleSelect = (cod) => {
    setSelectedProds(prev => {
      const s = new Set(prev)
      s.has(cod) ? s.delete(cod) : s.add(cod)
      return s
    })
  }
  const selectAllVisible = () => setSelectedProds(new Set(entries.map(([cod]) => cod)))
  const clearSelection   = () => setSelectedProds(new Set())

  // ── Exportar selección → Excel ─────────────────────────────────────────────
  const handleExportExcel = async () => {
    if (selectedProds.size === 0) return
    setExporting(true)
    try {
      const selEntries = entries.filter(([cod]) => selectedProds.has(cod))
      const grupos = selEntries.map(([cod, g]) => {
        const displayRows = viewMode === 'ultima' ? getUltimaRows(g.rows) : g.rows
        const sorted = [...displayRows].sort((a, b) => (adjustedPxm(a) ?? Infinity) - (adjustedPxm(b) ?? Infinity))
        return {
          codigo:     cod,
          producto:   g.producto || cod,
          categoria:  g.categoria || '',
          unidad_base: effectiveBaseUnit(g.rows),
          proveedores: sorted.map(r => ({
            proveedor:       r.proveedor || r.id_proveedor || '',
            presentacion:    r.presentacion_original || '',
            tipo_compra:     r.tipo_compra || '',
            precio_lista:    r.precio_informado,
            precio_por_medida: adjustedPxm(r),
            fecha:           r.fecha || '',
          })),
        }
      })

      if (!window.api) { alert('Exportación disponible solo en la app de escritorio'); return }
      const savePath = await api.dialog.saveFile({
        defaultName: `comparativa_${new Date().toISOString().split('T')[0]}.xlsx`,
      })
      if (!savePath) return
      await api.comparador.exportarSeleccion({ grupos, outputPath: savePath, conImpuestos })
      alert(`✅ Excel guardado en:\n${savePath}`)
    } catch (err) {
      alert(`Error al exportar: ${err.message}`)
    } finally { setExporting(false) }
  }

  // ── Exportar selección → PDF (ventana de impresión) ────────────────────────
  const handleExportPDF = () => {
    if (selectedProds.size === 0) return
    const selEntries = entries.filter(([cod]) => selectedProds.has(cod))
    const date = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })

    let html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; background: #fff; }
  .doc-header { padding: 20px 24px 14px; border-bottom: 2px solid #e07b2c; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
  .doc-title { font-size: 20px; font-weight: 800; color: #111; }
  .doc-meta  { font-size: 11px; color: #666; margin-top: 4px; }
  .doc-date  { font-size: 11px; color: #666; text-align: right; }
  .product   { margin-bottom: 20px; page-break-inside: avoid; }
  .prod-head { background: #f5f5f5; padding: 7px 12px; border-left: 4px solid #e07b2c; display: flex; align-items: center; gap: 10px; }
  .prod-name { font-weight: 700; font-size: 13px; }
  .prod-code { font-family: monospace; font-size: 10px; background: #dbeafe; color: #1d4ed8; padding: 1px 6px; border-radius: 4px; }
  .prod-cat  { font-size: 10px; background: #f0f0f0; color: #666; padding: 1px 6px; border-radius: 4px; }
  .prod-savings { font-size: 10px; background: #fef9c3; color: #a16207; padding: 1px 6px; border-radius: 4px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 1px; font-size: 11px; }
  th { background: #f9f9f9; padding: 5px 8px; text-align: left; font-weight: 700; font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #ddd; }
  td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; }
  tr.best td { background: #f0fdf4; }
  .best-price { color: #15803d; font-weight: 700; }
  .worst-price { color: #dc2626; }
  .badge-tipo { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: 700; background: #dbeafe; color: #1d4ed8; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
<title>Comparativa de Precios</title></head><body>
<div class="doc-header">
  <div>
    <div class="doc-title">📊 Comparativa de Precios</div>
    <div class="doc-meta">${selEntries.length} productos · ${conImpuestos ? 'Precios con impuestos' : 'Precios de lista'}</div>
  </div>
  <div class="doc-date">Generado el ${date}</div>
</div>`

    for (const [cod, g] of selEntries) {
      const displayRows = viewMode === 'ultima' ? getUltimaRows(g.rows) : g.rows
      const sorted = [...displayRows].sort((a, b) => (adjustedPxm(a) ?? Infinity) - (adjustedPxm(b) ?? Infinity))
      const precios = sorted.map(r => adjustedPxm(r)).filter(p => p != null && p > 0)
      const minP = precios.length ? Math.min(...precios) : null
      const maxP = precios.length ? Math.max(...precios) : null
      const ahorro = minP && maxP && maxP > minP ? ((maxP - minP) / maxP * 100).toFixed(0) : 0
      const unidad = effectiveBaseUnit(g.rows)

      html += `<div class="product">
<div class="prod-head">
  <span class="prod-name">${g.producto || cod}</span>
  <span class="prod-code">${cod}</span>
  ${g.categoria ? `<span class="prod-cat">${g.categoria}</span>` : ''}
  ${ahorro > 0 ? `<span class="prod-savings">Ahorro posible: ${ahorro}%</span>` : ''}
</div>
<table><thead><tr>
  <th>Proveedor</th><th>Presentación</th><th>Tipo</th>
  <th>Precio lista</th><th>$/${unidad}</th><th>Fecha</th>
</tr></thead><tbody>`

      for (const r of sorted) {
        const pxm     = adjustedPxm(r)
        const isBest  = pxm === minP && minP != null
        const isWorst = pxm === maxP && maxP != null && maxP !== minP
        html += `<tr${isBest ? ' class="best"' : ''}>
  <td>${r.proveedor || r.id_proveedor}${isBest ? ' ⭐' : ''}</td>
  <td>${r.presentacion_original || '—'}</td>
  <td>${r.tipo_compra ? `<span class="badge-tipo">${r.tipo_compra}</span>` : '—'}</td>
  <td>${r.precio_informado != null ? '$' + Number(r.precio_informado).toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '—'}</td>
  <td class="${isBest ? 'best-price' : isWorst ? 'worst-price' : ''}">${pxm != null ? '$' + Number(pxm).toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '—'}</td>
  <td>${r.fecha || '—'}</td>
</tr>`
      }
      html += `</tbody></table></div>`
    }

    html += `</body></html>`

    const pw = window.open('', '_blank', 'width=920,height=720')
    if (!pw) { alert('Permitir popups para exportar PDF'); return }
    pw.document.write(html)
    pw.document.close()
    pw.focus()
    setTimeout(() => { pw.print() }, 400)
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalProductos = entries.length
  const conAhorro = entries.filter(([, g]) => {
    const rowsToCheck = viewMode === 'ultima' ? getUltimaRows(g.rows) : g.rows
    const precios = rowsToCheck.map(r => adjustedPxm(r)).filter(p => p != null && p > 0)
    return precios.length > 1 && Math.max(...precios) > Math.min(...precios)
  }).length

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Comparador de Precios</div>
          <div className="page-subtitle">Mejor precio real por unidad de medida entre proveedores</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={handleExportMaxirest} disabled={exporting || data.length === 0}>
            {exporting ? '⏳ Exportando...' : '📤 Exportar para Maxirest'}
          </button>
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            {loading ? '⏳...' : '↺ Actualizar'}
          </button>
        </div>
      </div>

      <div className="page-body" style={{ paddingBottom: selectedProds.size > 0 ? '72px' : undefined }}>
        {/* Stats */}
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '16px' }}>
          <div className="stat-card">
            <div className="stat-number">{totalProductos}</div>
            <div className="stat-label">Productos comparados</div>
          </div>
          <div className="stat-card">
            <div className="stat-number" style={{ color: 'var(--warning)' }}>{conAhorro}</div>
            <div className="stat-label">Con diferencia de precio</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{dataInRange.length}</div>
            <div className="stat-label">Registros de precios</div>
          </div>
        </div>

        {/* Filtros */}
        <div className="card mb-3">
          <div className="card-body" style={{ padding: '10px 16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="search-bar" style={{ flex: 1, minWidth: '180px' }}>
              <input
                className="form-input"
                placeholder="Buscar por nombre o código interno..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <select className="form-select" style={{ width: '180px' }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="">Todas las categorías</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Desde</span>
              <input className="form-input" type="date" style={{ width: '130px', fontSize: '12px' }} value={desde} onChange={e => setDesde(e.target.value)} />
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Hasta</span>
              <input className="form-input" type="date" style={{ width: '130px', fontSize: '12px' }} value={hasta} onChange={e => setHasta(e.target.value)} />
            </div>

            <div style={{ display: 'flex', gap: '4px' }}>
              <button className={`btn btn-sm ${viewMode === 'ultima' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setViewMode('ultima')}>
                📅 Última lista
              </button>
              <button className={`btn btn-sm ${viewMode === 'evolucion' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setViewMode('evolucion')}>
                📈 Evolución
              </button>
            </div>

            <button
              className={`btn btn-sm ${conImpuestos ? 'btn-accent' : 'btn-secondary'}`}
              onClick={() => setConImpuestos(v => !v)}
              title={conImpuestos ? 'Ver precio de lista' : 'Ver precio final con impuestos y descuentos'}
            >
              {conImpuestos ? '💰 Con impuestos' : '💰 Ver c/impuestos'}
            </button>

            {/* Selección masiva */}
            {entries.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
                <button className="btn btn-sm btn-secondary" onClick={selectAllVisible} title="Seleccionar todos los productos visibles">
                  ☑ Seleccionar todos
                </button>
                {selectedProds.size > 0 && (
                  <button className="btn btn-sm btn-ghost" onClick={clearSelection}>✕ Limpiar</button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Lista de productos */}
        {entries.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="icon">📊</div>
              <p>{data.length === 0
                ? 'No hay datos para comparar. Importá listas de proveedores y asigná códigos en Equivalencias.'
                : 'No se encontraron resultados.'}</p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {entries.map(([cod, g]) => {
              const displayRows = viewMode === 'ultima' ? getUltimaRows(g.rows) : g.rows
              const rowsSorted  = [...displayRows].sort((a, b) => (adjustedPxm(a) ?? Infinity) - (adjustedPxm(b) ?? Infinity))
              const precios     = rowsSorted.map(r => adjustedPxm(r)).filter(p => p != null && p > 0)
              const minP        = precios.length ? Math.min(...precios) : null
              const maxP        = precios.length ? Math.max(...precios) : null
              const ahorro      = minP && maxP && maxP > minP ? ((maxP - minP) / maxP * 100).toFixed(0) : 0
              const evoRows     = viewMode === 'evolucion' ? getEvoRows(cod) : []
              const isExpanded  = !!expandedEvo[cod]
              const isSelected  = selectedProds.has(cod)
              const unidadLabel = effectiveBaseUnit(g.rows)
              const tooltipNorm = `Precio normalizado a la unidad base (${unidadLabel}).`

              return (
                <div
                  key={cod}
                  className="card"
                  style={isSelected ? { outline: '2px solid var(--accent)', outlineOffset: '1px' } : {}}
                >
                  <div className="card-header" style={{ background: 'var(--surface-2)' }}>
                    {/* Checkbox de selección */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, flexWrap: 'wrap' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(cod)}
                        title="Seleccionar para exportar"
                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }}
                      />
                      <span className="font-mono badge badge-blue">{cod}</span>
                      <span style={{ fontWeight: 700, fontSize: '14px' }}>{g.producto || cod}</span>
                      {g.categoria && <span className="badge badge-gray">{g.categoria}</span>}
                    </div>

                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexShrink: 0 }}>
                      {minP && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Mejor precio/{unidadLabel}</div>
                          <div style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '16px' }}>{fmt(minP)}</div>
                        </div>
                      )}
                      {ahorro > 0 && <span className="badge badge-yellow">Ahorro posible: {ahorro}%</span>}
                      {viewMode === 'evolucion' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setExpandedEvo(prev => ({ ...prev, [cod]: !prev[cod] }))}
                        >
                          {isExpanded ? '▲ Ocultar historial' : '▼ Ver historial'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>Proveedor</th>
                          <th>Producto original</th>
                          <th>Presentación</th>
                          <th>Tipo</th>
                          <th>Precio lista</th>
                          <th title={tooltipNorm} style={{ cursor: 'help' }}>$/unidad ℹ</th>
                          <th>${unidadLabel === 'kg' ? '/kg' : unidadLabel === 'litro' ? '/litro' : `/${unidadLabel}`}</th>
                          <th>Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowsSorted.map((r, i) => {
                          const pxm    = adjustedPxm(r)
                          const isBest  = pxm === minP && minP != null
                          const isWorst = pxm === maxP && maxP != null && maxP !== minP
                          const mult    = conImpuestos ? multProv(r.id_proveedor) : 1
                          const provData = provMap[r.id_proveedor]
                          return (
                            <tr key={i} style={isBest ? { background: '#f0fdf4' } : {}}>
                              <td style={{ fontWeight: 600 }}>
                                {isBest && <span style={{ marginRight: '4px' }}>⭐</span>}
                                {r.proveedor || r.id_proveedor}
                                {conImpuestos && provData && (
                                  <div style={{ display: 'flex', gap: '3px', marginTop: '2px', flexWrap: 'wrap' }}>
                                    {provData.descuento_pct > 0 && <span className="badge badge-green" style={{ fontSize: '10px' }}>-{provData.descuento_pct}%</span>}
                                    {provData.aplica_iva         && <span className="badge badge-blue"  style={{ fontSize: '10px' }}>IVA 21%</span>}
                                    {provData.aplica_percepcion  && <span className="badge badge-blue"  style={{ fontSize: '10px' }}>Perc. 3%</span>}
                                    {provData.impuesto_interno > 0 && <span className="badge badge-yellow" style={{ fontSize: '10px' }}>Int. {provData.impuesto_interno}%</span>}
                                  </div>
                                )}
                              </td>
                              <td className="text-muted" style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {r.producto_original}
                              </td>
                              <td className="text-muted">{r.presentacion_original || '—'}</td>
                              <td><span className={`badge ${r.tipo_compra === 'CAJA' ? 'badge-blue' : 'badge-gray'}`}>{r.tipo_compra}</span></td>
                              <td>
                                {fmt(r.precio_informado)}
                                {conImpuestos && mult !== 1 && (
                                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                    x{mult.toFixed(3)} → {fmt(r.precio_informado * mult)}
                                  </div>
                                )}
                              </td>
                              <td>{fmt(conImpuestos ? (r.precio_por_unidad ?? 0) * mult : r.precio_por_unidad)}</td>
                              <td>
                                <span className={isBest ? 'best-price' : isWorst ? 'worst-price' : ''}>
                                  {fmt(pxm)}
                                  {isBest  && <span style={{ marginLeft: '4px', fontSize: '10px' }}>▼ mejor</span>}
                                  {isWorst && <span style={{ marginLeft: '4px', fontSize: '10px' }}>▲ mayor</span>}
                                </span>
                              </td>
                              <td className="text-muted">{r.fecha || '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Historial de evolución */}
                  {viewMode === 'evolucion' && isExpanded && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', background: 'var(--surface-2)' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        📈 Evolución de precios — {evoRows.length} registros
                      </div>
                      {evoRows.length === 0 ? (
                        <p className="text-muted" style={{ fontSize: '12px' }}>No hay registros históricos en el rango de fechas.</p>
                      ) : (
                        <div className="table-wrapper">
                          <table style={{ fontSize: '12px' }}>
                            <thead><tr>
                              <th>Fecha</th><th>Proveedor</th><th>Presentación</th>
                              <th>${unidadLabel === 'kg' ? '/kg' : `/${unidadLabel}`}</th><th>Precio lista</th>
                            </tr></thead>
                            <tbody>
                              {evoRows.map((r, i) => (
                                <tr key={i}>
                                  <td className="font-mono">{r.fecha || '—'}</td>
                                  <td style={{ fontWeight: 500 }}>{r.proveedor || r.id_proveedor}</td>
                                  <td className="text-muted">{r.presentacion_original || '—'}</td>
                                  <td style={{ fontWeight: 600, color: 'var(--primary)' }}>{fmt(effectivePxm(r))}</td>
                                  <td className="text-muted">{fmt(r.precio_informado)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Barra flotante de exportación ──────────────────────────────────────── */}
      {selectedProds.size > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1e293b',
          border: '1px solid rgba(255,255,255,.12)',
          borderRadius: '14px',
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          boxShadow: '0 8px 32px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.2)',
          zIndex: 50,
          animation: 'slideUp .2s ease',
        }}>
          <span style={{ color: '#f1f5f9', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>
            ☑ {selectedProds.size} producto{selectedProds.size !== 1 ? 's' : ''} seleccionado{selectedProds.size !== 1 ? 's' : ''}
          </span>
          <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,.15)' }} />
          <button
            className="btn btn-sm"
            style={{ background: '#16a34a', color: '#fff', border: 'none', fontWeight: 600 }}
            onClick={handleExportExcel}
            disabled={exporting}
            title="Exportar selección a Excel con hoja resumen + hoja detalle"
          >
            {exporting ? '⏳...' : '📊 Excel'}
          </button>
          <button
            className="btn btn-sm"
            style={{ background: '#e07b2c', color: '#fff', border: 'none', fontWeight: 600 }}
            onClick={handleExportPDF}
            title="Exportar selección a PDF (abre ventana de impresión)"
          >
            🖨 PDF
          </button>
          <button
            className="btn btn-sm btn-ghost"
            style={{ color: '#94a3b8' }}
            onClick={clearSelection}
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}
