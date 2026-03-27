import { useState, useEffect } from 'react'
import api from '../api'
import { parsePresentacion } from '../utils/presentacion'

/**
 * Calcula el precio por unidad base real, reinterpretando la presentación.
 * Corrige registros históricos almacenados con el cálculo simple (sin multiplicar).
 * Ej: "10 BOLSAS X 1 KG" con precio $84.000 → $84.000/10 = $8.400/kg (no $84.000/kg)
 */
function effectivePxm(row) {
  const parsed = parsePresentacion(row.presentacion_original)
  if (parsed && parsed.totalQty > 0 && row.precio_por_unidad != null) {
    return row.precio_por_unidad / parsed.totalQty
  }
  return row.precio_por_medida_base
}

/**
 * Infiere la unidad base (kg / litro) a partir de las filas del grupo.
 * Prioriza lo que devuelve parsePresentacion; fallback a unidad_medida almacenada.
 */
function effectiveBaseUnit(rows) {
  for (const r of rows) {
    const p = parsePresentacion(r.presentacion_original)
    if (p) return p.baseUnit
  }
  return rows[0]?.unidad_medida || 'medida'
}

const fmt = (n) => n != null ? `$${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })}` : '—'

function defaultDesde() {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().split('T')[0]
}
function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function Comparador() {
  const [data, setData] = useState([])
  const [allListas, setAllListas] = useState([])
  const [productos, setProductos] = useState([])
  const [cats, setCats] = useState([])
  const [catFilter, setCatFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Feature 6: date range + view toggle
  const [desde, setDesde] = useState(defaultDesde())
  const [hasta, setHasta] = useState(todayStr())
  const [viewMode, setViewMode] = useState('ultima') // 'ultima' | 'evolucion'

  // Feature 6: expandable evolution rows
  const [expandedEvo, setExpandedEvo] = useState({}) // { [cod]: bool }

  const load = async () => {
    setLoading(true)
    try {
      const [rows, prods, listas] = await Promise.all([
        api.comparador.getComparativa({}),
        api.productos.getAll(),
        api.listas.getAll(),
      ])
      setData(rows)
      setAllListas(listas)
      setProductos(prods)
      setCats([...new Set(prods.map(p => p.categoria).filter(Boolean))].sort())
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

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

  // ── Feature 6: filter data by date range ──────────────────────────────────
  const dataInRange = data.filter(r => {
    if (!r.fecha) return true
    return r.fecha >= desde && r.fecha <= hasta
  })

  // ── Group & filter (Feature 1: search also by codigo_producto) ─────────────
  const grouped = {}
  dataInRange.forEach(row => {
    const key = row.codigo_producto
    if (!grouped[key]) grouped[key] = { producto: row.producto_estandar, categoria: row.categoria, unidad_medida: row.unidad_medida, rows: [] }
    grouped[key].rows.push(row)
  })

  const entries = Object.entries(grouped).filter(([cod, g]) => {
    const matchCat = !catFilter || g.categoria === catFilter
    const q = search.toLowerCase()
    // Feature 1: search by product name OR codigo_producto (internal code)
    const matchSearch = !q || g.producto?.toLowerCase().includes(q) || cod.toLowerCase().includes(q)
    return matchCat && matchSearch
  })

  // ── Feature 6 "Última lista" mode: one row per proveedor (most recent) ─────
  function getUltimaRows(rows) {
    const byProv = {}
    rows.forEach(r => {
      const key = r.id_proveedor || r.proveedor
      if (!byProv[key] || (r.fecha || '') > (byProv[key].fecha || '')) {
        byProv[key] = r
      }
    })
    return Object.values(byProv)
  }

  // ── Feature 6 "Evolución histórica": all listas rows for this product ──────
  function getEvoRows(cod) {
    return allListas
      .filter(l => l.codigo_producto === cod && l.estado_match === 'OK' && l.precio_por_medida_base != null)
      .filter(l => {
        if (!l.fecha) return true
        return l.fecha >= desde && l.fecha <= hasta
      })
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
  }

  const totalProductos = entries.length
  const conAhorro = entries.filter(([, g]) => {
    const rowsToCheck = viewMode === 'ultima' ? getUltimaRows(g.rows) : g.rows
    const precios = rowsToCheck.map(r => effectivePxm(r)).filter(p => p != null && p > 0)
    return precios.length > 1 && Math.max(...precios) > Math.min(...precios)
  }).length

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Comparador de Precios</h2>
          <p>Mejor precio real por unidad de medida entre proveedores</p>
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
      <div className="page-body">
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

        {/* ── Filters card ────────────────────────────────────────────────── */}
        <div className="card mb-3">
          <div className="card-body" style={{ padding: '10px 16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Feature 1: search by name OR internal code */}
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

            {/* Feature 6: date range */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Desde</span>
              <input
                className="form-input"
                type="date"
                style={{ width: '130px', fontSize: '12px' }}
                value={desde}
                onChange={e => setDesde(e.target.value)}
              />
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Hasta</span>
              <input
                className="form-input"
                type="date"
                style={{ width: '130px', fontSize: '12px' }}
                value={hasta}
                onChange={e => setHasta(e.target.value)}
              />
            </div>

            {/* Feature 6: view mode toggle */}
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                className={`btn btn-sm ${viewMode === 'ultima' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setViewMode('ultima')}
              >
                📅 Última lista
              </button>
              <button
                className={`btn btn-sm ${viewMode === 'evolucion' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setViewMode('evolucion')}
              >
                📈 Evolución histórica
              </button>
            </div>
          </div>
        </div>

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
              const rowsSorted = [...displayRows].sort((a, b) => (effectivePxm(a) ?? Infinity) - (effectivePxm(b) ?? Infinity))
              const precios = rowsSorted.map(r => effectivePxm(r)).filter(p => p != null && p > 0)
              const minP = precios.length ? Math.min(...precios) : null
              const maxP = precios.length ? Math.max(...precios) : null
              const ahorro = minP && maxP && maxP > minP ? ((maxP - minP) / maxP * 100).toFixed(0) : 0

              // Feature 6: evolution data
              const evoRows = viewMode === 'evolucion' ? getEvoRows(cod) : []
              const isExpanded = !!expandedEvo[cod]

              // Unidad base inferida desde la presentación (corrige unidad_medida almacenada incorrectamente)
              const unidadLabel = effectiveBaseUnit(g.rows)
              // Feature 4: tooltip text for $/unidad column
              const tooltipNorm = `Precio normalizado a la unidad base (${unidadLabel}). Permite comparar presentaciones distintas de un mismo producto (ej: bolsa 5kg vs bolsa 25kg → ambas se expresan en $/kg).`

              return (
                <div key={cod} className="card">
                  <div className="card-header" style={{ background: '#f8fafc' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
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
                      {/* Feature 6: evolucion toggle */}
                      {viewMode === 'evolucion' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setExpandedEvo(prev => ({ ...prev, [cod]: !prev[cod] }))}
                          title="Ver evolución histórica de precios"
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
                          {/* Feature 4: tooltip on $/unidad column */}
                          <th title={tooltipNorm} style={{ cursor: 'help', borderBottom: '1px dashed var(--text-muted)' }}>
                            $/unidad ℹ
                          </th>
                          <th>
                            ${unidadLabel === 'kg' ? '/kg' : unidadLabel === 'litro' ? '/litro' : `/${unidadLabel}`}
                          </th>
                          <th>Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowsSorted.map((r, i) => {
                          const pxm = effectivePxm(r)
                          const isBest = pxm === minP && minP != null
                          const isWorst = pxm === maxP && maxP != null && maxP !== minP
                          return (
                            <tr key={i} style={isBest ? { background: '#f0fdf4' } : {}}>
                              <td style={{ fontWeight: 600 }}>
                                {isBest && <span style={{ marginRight: '4px' }}>⭐</span>}
                                {r.proveedor || r.id_proveedor}
                              </td>
                              <td className="text-muted" style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.producto_original}</td>
                              <td className="text-muted">{r.presentacion_original || '—'}</td>
                              <td><span className={`badge ${r.tipo_compra === 'CAJA' ? 'badge-blue' : 'badge-gray'}`}>{r.tipo_compra}</span></td>
                              <td>{fmt(r.precio_informado)}</td>
                              <td>{fmt(r.precio_por_unidad)}</td>
                              <td>
                                <span className={isBest ? 'best-price' : isWorst ? 'worst-price' : ''}>
                                  {fmt(pxm)}
                                  {isBest && <span style={{ marginLeft: '4px', fontSize: '10px' }}>▼ mejor</span>}
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

                  {/* Feature 6: expandable price evolution section */}
                  {viewMode === 'evolucion' && isExpanded && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', background: '#fafaf8' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        📈 Evolución de precios — {evoRows.length} registros
                      </div>
                      {evoRows.length === 0 ? (
                        <p className="text-muted" style={{ fontSize: '12px' }}>No hay registros históricos en el rango de fechas seleccionado.</p>
                      ) : (
                        <div className="table-wrapper">
                          <table style={{ fontSize: '12px' }}>
                            <thead>
                              <tr>
                                <th>Fecha</th>
                                <th>Proveedor</th>
                                <th>Presentación</th>
                                <th>${unidadLabel === 'kg' ? '/kg' : unidadLabel === 'litro' ? '/litro' : `/${unidadLabel}`}</th>
                                <th>Precio lista</th>
                              </tr>
                            </thead>
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
    </>
  )
}
