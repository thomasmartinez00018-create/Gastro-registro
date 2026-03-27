import { useState, useEffect } from 'react'
import api from '../api'

const fmt = (n) => n != null ? `$${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })}` : '—'

export default function Comparador() {
  const [data, setData] = useState([])
  const [productos, setProductos] = useState([])
  const [cats, setCats] = useState([])
  const [catFilter, setCatFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [rows, prods] = await Promise.all([
        api.comparador.getComparativa({}),
        api.productos.getAll(),
      ])
      setData(rows)
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

  const grouped = {}
  data.forEach(row => {
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

  const totalProductos = entries.length
  const conAhorro = entries.filter(([, g]) => {
    const precios = g.rows.map(r => r.precio_por_medida_base).filter(p => p != null && p > 0)
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
            <div className="stat-number">{data.length}</div>
            <div className="stat-label">Registros de precios</div>
          </div>
        </div>

        <div className="card mb-3">
          <div className="card-body" style={{ padding: '10px 16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div className="search-bar" style={{ flex: 1 }}>
              <input className="form-input" placeholder="Buscar producto o código..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="form-select" style={{ width: '180px' }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="">Todas las categorías</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
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
              const rowsSorted = [...g.rows].sort((a, b) => (a.precio_por_medida_base ?? Infinity) - (b.precio_por_medida_base ?? Infinity))
              const precios = rowsSorted.map(r => r.precio_por_medida_base).filter(p => p != null && p > 0)
              const minP = precios.length ? Math.min(...precios) : null
              const maxP = precios.length ? Math.max(...precios) : null
              const ahorro = minP && maxP && maxP > minP ? ((maxP - minP) / maxP * 100).toFixed(0) : 0

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
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Mejor precio/{g.unidad_medida || 'unidad'}</div>
                          <div style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '16px' }}>{fmt(minP)}</div>
                        </div>
                      )}
                      {ahorro > 0 && <span className="badge badge-yellow">Ahorro posible: {ahorro}%</span>}
                    </div>
                  </div>
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>Proveedor</th><th>Producto original</th><th>Presentación</th><th>Tipo</th>
                          <th>Precio lista</th><th>Precio/unidad</th><th>Precio/{g.unidad_medida || 'medida'}</th><th>Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowsSorted.map((r, i) => {
                          const isBest = r.precio_por_medida_base === minP && minP != null
                          const isWorst = r.precio_por_medida_base === maxP && maxP != null && maxP !== minP
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
                                  {fmt(r.precio_por_medida_base)}
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
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
