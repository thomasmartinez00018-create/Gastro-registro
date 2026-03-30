import { useState, useEffect, useMemo } from 'react'
import api from '../api'
import { parsePresentacion } from '../utils/presentacion'

// ─── helpers de precio ────────────────────────────────────────────────────────
function effectivePxm(row) {
  const parsed = parsePresentacion(row.presentacion_original)
  if (parsed && parsed.totalQty > 0 && row.precio_por_unidad != null)
    return row.precio_por_unidad / parsed.totalQty
  return row.precio_por_medida_base
}
function effectiveBaseUnit(rows) {
  for (const r of rows) {
    const p = parsePresentacion(r.presentacion_original)
    if (p) return p.baseUnit
  }
  return rows[0]?.unidad_medida || 'medida'
}
const fmt = n => n != null
  ? `$${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
  : '—'
const pct = (a, b) => b && b !== 0 ? ((a - b) / b * 100) : null

function defaultDesde() {
  const d = new Date(); d.setDate(d.getDate() - 90)
  return d.toISOString().split('T')[0]
}
const todayStr = () => new Date().toISOString().split('T')[0]

// ─── badge de variación % ─────────────────────────────────────────────────────
function PctBadge({ value, small }) {
  if (value == null) return <span style={{ color: 'var(--text-light)' }}>—</span>
  const up = value > 0
  const col = up ? 'var(--danger)' : value < 0 ? 'var(--success)' : 'var(--text-muted)'
  return (
    <span style={{ color: col, fontWeight: 600, fontSize: small ? '11px' : '12px', whiteSpace: 'nowrap' }}>
      {up ? '▲' : value < 0 ? '▼' : '='} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

export default function Comparador() {
  // ── datos base ──────────────────────────────────────────────────────────────
  const [data,        setData]        = useState([])
  const [allListas,   setAllListas]   = useState([])
  const [productos,   setProductos]   = useState([])
  const [proveedores, setProveedores] = useState([])
  const [cats,        setCats]        = useState([])

  // ── filtros comparador ──────────────────────────────────────────────────────
  const [catFilter,  setCatFilter]  = useState('')
  const [search,     setSearch]     = useState('')
  const [desde,      setDesde]      = useState(defaultDesde())
  const [hasta,      setHasta]      = useState(todayStr())
  const [viewMode,   setViewMode]   = useState('ultima')   // 'ultima' | 'evolucion' | 'lista'
  const [expandedEvo,setExpandedEvo]= useState({})
  const [conImpuestos,setConImpuestos]=useState(false)
  const [loading,    setLoading]    = useState(false)
  const [exporting,  setExporting]  = useState(false)

  // ── selección para exportar (modo comparador) ──────────────────────────────
  const [selectedProds, setSelectedProds] = useState(new Set())

  // ── lista de compra ────────────────────────────────────────────────────────
  const [listaItems,   setListaItems]   = useState([])   // {codigo,producto,categoria,unidad_base,cantidad}
  const [listaSearch,  setListaSearch]  = useState('')
  const [listaLoading, setListaLoading] = useState(false)

  // ─── impuestos por proveedor ────────────────────────────────────────────────
  const provMap = useMemo(() => {
    const m = {}; proveedores.forEach(p => { m[p.id_proveedor] = p }); return m
  }, [proveedores])

  const multProv = id => {
    const p = provMap[id]; if (!p) return 1
    return (1 - (p.descuento_pct || 0) / 100)
      * (1 + (p.aplica_iva ? 0.21 : 0))
      * (1 + (p.aplica_percepcion ? 0.03 : 0))
      * (1 + (p.impuesto_interno || 0) / 100)
  }
  const adjustedPxm = row => {
    const base = effectivePxm(row); if (base == null) return null
    return conImpuestos ? base * multProv(row.id_proveedor) : base
  }

  // ─── carga de datos ──────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true)
    try {
      const [rows, prods, listas, provs] = await Promise.all([
        api.comparador.getComparativa({}),
        api.productos.getAll(),
        api.listas.getAll(),
        api.proveedores.getAll(),
      ])
      setData(rows); setAllListas(listas); setProductos(prods); setProveedores(provs)
      setCats([...new Set(prods.map(p => p.categoria).filter(Boolean))].sort())
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  // ─── agrupamiento ────────────────────────────────────────────────────────────
  const dataInRange = useMemo(() =>
    data.filter(r => !r.fecha || (r.fecha >= desde && r.fecha <= hasta))
  , [data, desde, hasta])

  const grouped = useMemo(() => {
    const g = {}
    dataInRange.forEach(row => {
      if (!g[row.codigo_producto])
        g[row.codigo_producto] = { producto: row.producto_estandar, categoria: row.categoria, rows: [] }
      g[row.codigo_producto].rows.push(row)
    })
    return g
  }, [dataInRange])

  const entries = useMemo(() =>
    Object.entries(grouped).filter(([cod, g]) => {
      const mC = !catFilter || g.categoria === catFilter
      const q  = search.toLowerCase()
      const mS = !q || g.producto?.toLowerCase().includes(q) || cod.toLowerCase().includes(q)
      return mC && mS
    })
  , [grouped, catFilter, search])

  const getUltimaRows = rows => {
    const byProv = {}
    rows.forEach(r => {
      const k = r.id_proveedor || r.proveedor
      if (!byProv[k] || (r.fecha || '') > (byProv[k].fecha || '')) byProv[k] = r
    })
    return Object.values(byProv)
  }
  const getEvoRows = cod =>
    allListas
      .filter(l => l.codigo_producto === cod && l.estado_match === 'OK' && l.precio_por_medida_base != null)
      .filter(l => !l.fecha || (l.fecha >= desde && l.fecha <= hasta))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))

  // ─── selección (modo comparador) ─────────────────────────────────────────────
  const toggleSelect  = cod => setSelectedProds(prev => { const s = new Set(prev); s.has(cod) ? s.delete(cod) : s.add(cod); return s })
  const selectAllVis  = ()  => setSelectedProds(new Set(entries.map(([c]) => c)))
  const clearSel      = ()  => setSelectedProds(new Set())

  // ─── exportar selección (comparador) ─────────────────────────────────────────
  const handleExportMaxirest = async () => {
    setExporting(true)
    try {
      const prodMap = {}; productos.forEach(p => { prodMap[p.codigo] = p })
      const enriched = data.map(r => ({ ...r,
        codigo_maxirest: prodMap[r.codigo_producto]?.codigos_maxirest?.split(',')[0]?.trim() || r.codigo_producto,
      }))
      if (!window.api) { alert('Solo disponible en la app de escritorio'); return }
      const sp = await api.dialog.saveFile({ defaultName: `comparativa_maxirest_${todayStr()}.xlsx` })
      if (!sp) return
      await api.maxirest.exportarComparativa({ rows: enriched, outputPath: sp })
      alert(`✅ Guardado en:\n${sp}`)
    } finally { setExporting(false) }
  }

  const handleExportSelExcel = async () => {
    if (!selectedProds.size) return; setExporting(true)
    try {
      const grupos = entries.filter(([c]) => selectedProds.has(c)).map(([cod, g]) => {
        const rows = [...getUltimaRows(g.rows)].sort((a, b) => (adjustedPxm(a) ?? Infinity) - (adjustedPxm(b) ?? Infinity))
        return {
          codigo: cod, producto: g.producto || cod, categoria: g.categoria || '',
          unidad_base: effectiveBaseUnit(g.rows),
          proveedores: rows.map(r => ({
            proveedor: r.proveedor || r.id_proveedor || '', presentacion: r.presentacion_original || '',
            tipo_compra: r.tipo_compra || '', precio_lista: r.precio_informado,
            precio_por_medida: adjustedPxm(r), fecha: r.fecha || '',
          })),
        }
      })
      if (!window.api) { alert('Solo disponible en la app de escritorio'); return }
      const sp = await api.dialog.saveFile({ defaultName: `comparativa_${todayStr()}.xlsx` })
      if (!sp) return
      await api.comparador.exportarSeleccion({ grupos, outputPath: sp, conImpuestos })
      alert(`✅ Excel guardado en:\n${sp}`)
    } catch (e) { alert(`Error: ${e.message}`) } finally { setExporting(false) }
  }

  const handleExportSelPDF = () => {
    if (!selectedProds.size) return
    const selEntries = entries.filter(([c]) => selectedProds.has(c))
    const date = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
    let html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;color:#111;background:#fff}
.hdr{padding:18px 24px 12px;border-bottom:2px solid #e07b2c;display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:18px}
.htitle{font-size:20px;font-weight:800}.hmeta{font-size:11px;color:#666;margin-top:3px}.hdate{font-size:11px;color:#666}
.prod{margin-bottom:18px;page-break-inside:avoid}
.ph{background:#f5f5f5;padding:7px 12px;border-left:4px solid #e07b2c;display:flex;align-items:center;gap:8px}
.pname{font-weight:700;font-size:13px}.pcode{font-family:monospace;font-size:10px;background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:4px}
.pcat,.psav{font-size:10px;padding:1px 6px;border-radius:4px}.pcat{background:#f0f0f0;color:#666}.psav{background:#fef9c3;color:#a16207;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:11px}th{background:#f9f9f9;padding:5px 8px;text-align:left;font-weight:700;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #ddd}
td{padding:5px 8px;border-bottom:1px solid #f0f0f0}tr.best td{background:#f0fdf4}.bp{color:#15803d;font-weight:700}.wp{color:#dc2626}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>
<title>Comparativa</title></head><body>
<div class="hdr"><div><div class="htitle">📊 Comparativa de Precios</div><div class="hmeta">${selEntries.length} productos · ${conImpuestos ? 'Precio final c/impuestos' : 'Precio de lista'}</div></div><div class="hdate">${date}</div></div>`

    for (const [cod, g] of selEntries) {
      const rows = [...getUltimaRows(g.rows)].sort((a, b) => (adjustedPxm(a) ?? Infinity) - (adjustedPxm(b) ?? Infinity))
      const ps = rows.map(r => adjustedPxm(r)).filter(p => p != null && p > 0)
      const minP = ps.length ? Math.min(...ps) : null; const maxP = ps.length ? Math.max(...ps) : null
      const ahorro = minP && maxP && maxP > minP ? ((maxP - minP) / maxP * 100).toFixed(0) : 0
      const unidad = effectiveBaseUnit(g.rows)
      html += `<div class="prod"><div class="ph"><span class="pname">${g.producto || cod}</span><span class="pcode">${cod}</span>${g.categoria ? `<span class="pcat">${g.categoria}</span>` : ''}${ahorro > 0 ? `<span class="psav">Ahorro posible: ${ahorro}%</span>` : ''}</div>
<table><thead><tr><th>Proveedor</th><th>Presentación</th><th>Precio lista</th><th>$/${unidad}</th><th>Fecha</th></tr></thead><tbody>`
      rows.forEach(r => {
        const px = adjustedPxm(r); const isBest = px === minP && minP != null; const isWorst = px === maxP && maxP != null && maxP !== minP
        html += `<tr${isBest ? ' class="best"' : ''}><td>${r.proveedor || r.id_proveedor}${isBest ? ' ⭐' : ''}</td><td>${r.presentacion_original || '—'}</td><td>${r.precio_informado != null ? '$' + Number(r.precio_informado).toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '—'}</td><td class="${isBest ? 'bp' : isWorst ? 'wp' : ''}">${fmt(px)}</td><td>${r.fecha || '—'}</td></tr>`
      })
      html += `</tbody></table></div>`
    }
    html += `</body></html>`
    const pw = window.open('', '_blank', 'width=920,height=720')
    if (!pw) { alert('Permitir popups para exportar PDF'); return }
    pw.document.write(html); pw.document.close(); pw.focus()
    setTimeout(() => pw.print(), 400)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LISTA DE COMPRA
  // ═══════════════════════════════════════════════════════════════════════════
  const addToLista = prod => {
    if (listaItems.find(i => i.codigo === prod.codigo)) return
    setListaItems(prev => [...prev, {
      codigo: prod.codigo, producto: prod.producto, categoria: prod.categoria || '',
      unidad_base: prod.unidad_base || 'kg', cantidad: 1,
    }])
  }
  const removeFromLista  = cod => setListaItems(prev => prev.filter(i => i.codigo !== cod))
  const updateCantidad   = (cod, val) => setListaItems(prev => prev.map(i => i.codigo === cod ? { ...i, cantidad: parseFloat(val) || 1 } : i))
  const clearLista       = () => setListaItems([])

  // Cargar lista desde Maxirest INSUMO.XLSX
  const cargarDesdeMaxirest = async () => {
    if (!window.api) { alert('Solo disponible en la app de escritorio'); return }
    const filePath = await api.dialog.openFile()
    if (!filePath) return
    setListaLoading(true)
    try {
      const { unicos } = await api.maxirest.parseInsumos(filePath)
      let agregados = 0
      for (const ins of unicos) {
        // Buscar producto interno por codigos_maxirest
        const match = productos.find(p =>
          p.activo && p.codigos_maxirest &&
          p.codigos_maxirest.split(',').map(c => c.trim()).includes(ins.codigo_maxirest)
        )
        if (match && !listaItems.find(i => i.codigo === match.codigo)) {
          setListaItems(prev => [...prev, {
            codigo: match.codigo, producto: match.producto, categoria: match.categoria || '',
            unidad_base: match.unidad_base || 'kg', cantidad: 1,
          }])
          agregados++
        }
      }
      if (agregados === 0)
        alert('No se encontraron insumos del Maxirest con equivalencia en productos internos.\nAsegurate de tener los códigos Maxirest asignados en cada producto.')
      else
        alert(`✅ ${agregados} productos agregados desde Maxirest.`)
    } catch (e) {
      alert(`Error al leer el archivo: ${e.message}`)
    } finally { setListaLoading(false) }
  }

  // Precios calculados para la lista de compra
  const listaConPrecios = useMemo(() => listaItems.map(item => {
    const g = grouped[item.codigo]
    if (!g) return { ...item, bestProveedor: null, bestPxm: null, subtotal: null, opciones: [] }
    const rows = [...getUltimaRows(g.rows)].sort((a, b) => (adjustedPxm(a) ?? Infinity) - (adjustedPxm(b) ?? Infinity))
    const best = rows[0]; const bestPxm = best ? adjustedPxm(best) : null
    return {
      ...item,
      bestProveedor: best?.proveedor || best?.id_proveedor || null,
      bestPxm,
      subtotal:  bestPxm != null ? bestPxm * item.cantidad : null,
      opciones:  rows,
      unidadLabel: effectiveBaseUnit(g.rows),
    }
  }), [listaItems, grouped, conImpuestos]) // eslint-disable-line

  const listaTotal = listaConPrecios.reduce((s, i) => s + (i.subtotal || 0), 0)

  const listaByProv = useMemo(() => {
    const m = {}
    listaConPrecios.forEach(it => {
      if (!it.bestProveedor) { if (!m['__sin_datos__']) m['__sin_datos__'] = { items: [], total: 0 }; m['__sin_datos__'].items.push(it); return }
      if (!m[it.bestProveedor]) m[it.bestProveedor] = { items: [], total: 0 }
      m[it.bestProveedor].items.push(it)
      m[it.bestProveedor].total += it.subtotal || 0
    })
    return m
  }, [listaConPrecios])

  // Export lista → Excel
  const handleExportListaExcel = async () => {
    if (!listaItems.length) return; setExporting(true)
    try {
      if (!window.api) { alert('Solo disponible en la app de escritorio'); return }
      const sp = await api.dialog.saveFile({ defaultName: `lista_compra_${todayStr()}.xlsx` })
      if (!sp) return
      const items = listaConPrecios.map(it => ({
        codigo: it.codigo, producto: it.producto, categoria: it.categoria,
        cantidad: it.cantidad, unidad_base: it.unidadLabel || it.unidad_base,
        bestProveedor: it.bestProveedor, bestPxm: it.bestPxm, subtotal: it.subtotal,
      }))
      await api.comparador.exportarLista({ items, outputPath: sp })
      alert(`✅ Excel guardado en:\n${sp}`)
    } catch (e) { alert(`Error: ${e.message}`) } finally { setExporting(false) }
  }

  // Export lista → PDF
  const handleExportListaPDF = () => {
    if (!listaItems.length) return
    const date = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
    let html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;color:#111}
.hdr{padding:18px 24px 12px;border-bottom:2px solid #e07b2c;display:flex;justify-content:space-between;margin-bottom:18px}
.htitle{font-size:20px;font-weight:800}.hmeta{font-size:11px;color:#666;margin-top:3px}.hdate{font-size:11px;color:#666}
.section{margin-bottom:20px;page-break-inside:avoid}
.sh{background:#0f172a;color:#f1f5f9;padding:7px 14px;font-size:13px;font-weight:700;display:flex;justify-content:space-between}
.sh span{font-size:12px;opacity:.8}
table{width:100%;border-collapse:collapse;font-size:11px}th{background:#f5f5f5;padding:5px 8px;text-align:left;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #ddd}
td{padding:5px 8px;border-bottom:1px solid #f0f0f0}
.total-row td{font-weight:700;background:#f0fdf4;border-top:2px solid #16a34a}
.grand{text-align:right;padding:14px 0;font-size:16px;font-weight:800;color:#111}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>
<title>Lista de Compra</title></head><body>
<div class="hdr"><div><div class="htitle">🛒 Lista de Compra</div><div class="hmeta">${listaItems.length} productos · ${conImpuestos ? 'Precios con impuestos' : 'Precios de lista'}</div></div><div class="hdate">${date}</div></div>`

    // Tabla por proveedor
    for (const [prov, { items: pitems, total }] of Object.entries(listaByProv)) {
      if (prov === '__sin_datos__') continue
      html += `<div class="section"><div class="sh">${prov}<span>Subtotal: ${fmt(total)}</span></div>
<table><thead><tr><th>Producto</th><th>Código</th><th>Cantidad</th><th>Unidad</th><th>Precio/unidad</th><th>Subtotal</th></tr></thead><tbody>`
      pitems.forEach(it => {
        html += `<tr><td>${it.producto}</td><td style="font-family:monospace">${it.codigo}</td><td>${it.cantidad}</td><td>${it.unidadLabel || it.unidad_base}</td><td>${fmt(it.bestPxm)}</td><td style="font-weight:700">${fmt(it.subtotal)}</td></tr>`
      })
      html += `</tbody></table></div>`
    }
    // Sin datos
    if (listaByProv['__sin_datos__']?.items.length) {
      html += `<div class="section"><div class="sh" style="background:#6b7280">Sin datos de precio disponibles</div><table><thead><tr><th>Producto</th><th>Código</th><th>Cantidad</th></tr></thead><tbody>`
      listaByProv['__sin_datos__'].items.forEach(it => {
        html += `<tr><td>${it.producto}</td><td style="font-family:monospace">${it.codigo}</td><td>${it.cantidad} ${it.unidad_base}</td></tr>`
      })
      html += `</tbody></table></div>`
    }
    html += `<div class="grand">TOTAL ESTIMADO: ${fmt(listaTotal)}</div></body></html>`

    const pw = window.open('', '_blank', 'width=840,height=700')
    if (!pw) { alert('Permitir popups para exportar PDF'); return }
    pw.document.write(html); pw.document.close(); pw.focus()
    setTimeout(() => pw.print(), 400)
  }

  // ─── productos filtrados para agregar a lista ──────────────────────────────
  const productosParaLista = useMemo(() => {
    const q = listaSearch.toLowerCase()
    return productos
      .filter(p => p.activo && (!q || p.producto.toLowerCase().includes(q) || (p.codigo || '').toLowerCase().includes(q)))
      .filter(p => !listaItems.find(i => i.codigo === p.codigo))
      .slice(0, 80)
  }, [productos, listaSearch, listaItems])

  // ─── stats resumen ─────────────────────────────────────────────────────────
  const totalProductos = entries.length
  const conAhorro = entries.filter(([, g]) => {
    const ps = getUltimaRows(g.rows).map(r => adjustedPxm(r)).filter(p => p != null && p > 0)
    return ps.length > 1 && Math.max(...ps) > Math.min(...ps)
  }).length

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <>
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <div className="page-title">Comparador de Precios</div>
          <div className="page-subtitle">Mejor precio real por unidad de medida entre proveedores</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {viewMode !== 'lista' && (
            <button className="btn btn-secondary" onClick={handleExportMaxirest} disabled={exporting || !data.length}>
              {exporting ? '⏳...' : '📤 Exportar Maxirest'}
            </button>
          )}
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            {loading ? '⏳...' : '↺ Actualizar'}
          </button>
        </div>
      </div>

      <div className="page-body" style={{ paddingBottom: selectedProds.size > 0 && viewMode !== 'lista' ? '72px' : undefined }}>

        {/* ── Stats ── */}
        {viewMode !== 'lista' && (
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '16px' }}>
            <div className="stat-card"><div className="stat-number">{totalProductos}</div><div className="stat-label">Productos comparados</div></div>
            <div className="stat-card"><div className="stat-number" style={{ color: 'var(--warning)' }}>{conAhorro}</div><div className="stat-label">Con diferencia de precio</div></div>
            <div className="stat-card"><div className="stat-number">{dataInRange.length}</div><div className="stat-label">Registros de precios</div></div>
          </div>
        )}

        {/* ── Filtros ── */}
        <div className="card mb-3">
          <div className="card-body" style={{ padding: '10px 16px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Tabs de modo */}
            <div style={{ display: 'flex', gap: '3px', background: 'var(--surface-3)', padding: '3px', borderRadius: '9px' }}>
              {[
                ['ultima',   '📅 Última lista'],
                ['evolucion','📈 Evolución'],
                ['lista',    '🛒 Lista de compra'],
              ].map(([mode, label]) => (
                <button key={mode}
                  className={`btn btn-sm ${viewMode === mode ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ borderRadius: '7px' }}
                  onClick={() => setViewMode(mode)}>{label}</button>
              ))}
            </div>

            {viewMode !== 'lista' && (
              <>
                <div className="search-bar" style={{ flex: 1, minWidth: '160px' }}>
                  <input className="form-input" placeholder="Buscar producto o código..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <select className="form-select" style={{ width: '160px' }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                  <option value="">Todas las categorías</option>
                  {cats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input className="form-input" type="date" style={{ width: '130px', fontSize: '12px' }} value={desde} onChange={e => setDesde(e.target.value)} />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>→</span>
                <input className="form-input" type="date" style={{ width: '130px', fontSize: '12px' }} value={hasta} onChange={e => setHasta(e.target.value)} />
                <button className={`btn btn-sm ${conImpuestos ? 'btn-accent' : 'btn-secondary'}`} onClick={() => setConImpuestos(v => !v)}>
                  {conImpuestos ? '💰 Con impuestos' : '💰 Ver c/impuestos'}
                </button>
                {entries.length > 0 && (
                  <button className="btn btn-sm btn-secondary" onClick={selectAllVis}>☑ Sel. todos</button>
                )}
                {selectedProds.size > 0 && (
                  <button className="btn btn-sm btn-ghost" onClick={clearSel}>✕ Limpiar</button>
                )}
              </>
            )}

            {viewMode === 'lista' && (
              <button className={`btn btn-sm ${conImpuestos ? 'btn-accent' : 'btn-secondary'}`} onClick={() => setConImpuestos(v => !v)}>
                {conImpuestos ? '💰 Con impuestos' : '💰 Ver c/impuestos'}
              </button>
            )}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            VISTA: LISTA DE COMPRA
        ══════════════════════════════════════════════════════════════════════ */}
        {viewMode === 'lista' && (
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>

            {/* Panel izquierdo: agregar productos */}
            <div style={{ width: '256px', flexShrink: 0 }}>
              <div className="card" style={{ position: 'sticky', top: '0' }}>
                <div className="card-header" style={{ background: 'var(--surface-2)' }}>
                  <h3 style={{ fontSize: '13px' }}>Agregar productos</h3>
                </div>
                <div className="card-body" style={{ padding: '12px' }}>
                  <input className="form-input" style={{ marginBottom: '8px', fontSize: '12px' }}
                    placeholder="Buscar..." value={listaSearch} onChange={e => setListaSearch(e.target.value)} />

                  <div style={{ maxHeight: '360px', overflowY: 'auto', margin: '0 -4px' }}>
                    {productosParaLista.length === 0 && (
                      <div className="text-muted" style={{ padding: '12px', textAlign: 'center', fontSize: '12px' }}>
                        {listaSearch ? 'Sin resultados' : 'No quedan productos por agregar'}
                      </div>
                    )}
                    {productosParaLista.map(p => (
                      <button key={p.codigo}
                        onClick={() => addToLista(p)}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 8px', borderRadius: '6px', border: 'none', background: 'none', cursor: 'pointer', marginBottom: '1px', transition: 'background .1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                        <div style={{ fontWeight: 500, fontSize: '12.5px', color: 'var(--text)' }}>{p.producto}</div>
                        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{p.codigo} · {p.categoria || '—'}</div>
                      </button>
                    ))}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-light)', marginTop: '10px', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <button className="btn btn-secondary btn-sm" style={{ width: '100%', justifyContent: 'center' }}
                      onClick={cargarDesdeMaxirest} disabled={listaLoading}>
                      {listaLoading ? '⏳ Cargando...' : '📥 Cargar desde Maxirest'}
                    </button>
                    {listaItems.length > 0 && (
                      <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', color: 'var(--danger)' }}
                        onClick={clearLista}>
                        🗑 Vaciar lista
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Panel derecho: lista + comparativa */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {listaItems.length === 0 ? (
                <div className="card">
                  <div className="empty-state">
                    <div className="icon">🛒</div>
                    <p>Agregá productos desde el panel izquierdo o cargá desde Maxirest para construir tu lista de compra y comparar precios entre proveedores.</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Tabla de ítems */}
                  <div className="card" style={{ marginBottom: '14px' }}>
                    <div className="card-header">
                      <h3>🛒 Lista de compra — {listaItems.length} producto{listaItems.length !== 1 ? 's' : ''}</h3>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-sm btn-secondary" onClick={handleExportListaExcel} disabled={exporting}>
                          {exporting ? '⏳...' : '📊 Excel'}
                        </button>
                        <button className="btn btn-sm btn-secondary" onClick={handleExportListaPDF}>
                          🖨 PDF
                        </button>
                      </div>
                    </div>
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Producto</th>
                            <th>Cantidad</th>
                            <th>Mejor proveedor</th>
                            <th>Otras opciones</th>
                            <th>$/unidad</th>
                            <th>Subtotal</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {listaConPrecios.map(it => (
                            <tr key={it.codigo}>
                              <td>
                                <div style={{ fontWeight: 600 }}>{it.producto}</div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{it.codigo} · {it.categoria}</div>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                  <input type="number" className="form-input" style={{ width: '72px', padding: '4px 7px', fontSize: '12px' }}
                                    min="0.01" step="0.5" value={it.cantidad}
                                    onChange={e => updateCantidad(it.codigo, e.target.value)} />
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{it.unidadLabel || it.unidad_base}</span>
                                </div>
                              </td>
                              <td>
                                {it.bestProveedor
                                  ? <span style={{ fontWeight: 600, color: 'var(--primary)' }}>⭐ {it.bestProveedor}</span>
                                  : <span className="badge badge-gray">Sin datos</span>}
                              </td>
                              <td>
                                {it.opciones.length > 1 && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                    {it.opciones.slice(1, 3).map((r, i) => {
                                      const p = adjustedPxm(r)
                                      const diff = pct(p, it.bestPxm)
                                      return (
                                        <div key={i} style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', gap: '5px' }}>
                                          <span>{r.proveedor || r.id_proveedor}</span>
                                          {diff != null && diff > 0 && <PctBadge value={diff} small />}
                                        </div>
                                      )
                                    })}
                                    {it.opciones.length > 3 && <div style={{ fontSize: '10px', color: 'var(--text-light)' }}>+{it.opciones.length - 3} más</div>}
                                  </div>
                                )}
                              </td>
                              <td>
                                {it.bestPxm != null
                                  ? <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{fmt(it.bestPxm)}</span>
                                  : '—'}
                              </td>
                              <td style={{ fontWeight: 700, fontSize: '14px' }}>
                                {it.subtotal != null ? fmt(it.subtotal) : '—'}
                              </td>
                              <td>
                                <button className="btn btn-ghost btn-xs" onClick={() => removeFromLista(it.codigo)} title="Quitar">✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Total general */}
                    <div style={{ padding: '12px 18px', borderTop: '2px solid var(--border)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px', background: 'var(--surface-2)' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {listaConPrecios.filter(i => i.subtotal == null).length > 0 &&
                          `⚠ ${listaConPrecios.filter(i => i.subtotal == null).length} producto(s) sin precio`}
                      </span>
                      <span style={{ fontWeight: 800, fontSize: '18px', color: 'var(--text)' }}>
                        Total estimado: <span style={{ color: 'var(--primary)' }}>{fmt(listaTotal)}</span>
                      </span>
                    </div>
                  </div>

                  {/* Agrupado por proveedor */}
                  <div className="card">
                    <div className="card-header" style={{ background: 'var(--surface-2)' }}>
                      <h3>📦 Pedidos por proveedor</h3>
                      <span className="text-muted">{Object.keys(listaByProv).filter(k => k !== '__sin_datos__').length} proveedor(es)</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', padding: '14px' }}>
                      {Object.entries(listaByProv)
                        .filter(([k]) => k !== '__sin_datos__')
                        .sort((a, b) => b[1].total - a[1].total)
                        .map(([prov, { items: pitems, total }]) => (
                          <div key={prov} style={{ background: 'var(--bg)', borderRadius: '10px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                            <div style={{ background: 'var(--sidebar-bg)', color: '#f1f5f9', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, fontSize: '13px' }}>{prov}</span>
                              <span style={{ fontWeight: 800, color: 'var(--sidebar-active, #e07b2c)', fontSize: '14px' }}>{fmt(total)}</span>
                            </div>
                            <div style={{ padding: '8px 0' }}>
                              {pitems.map(it => (
                                <div key={it.codigo} style={{ padding: '5px 14px', display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', borderBottom: '1px solid var(--border-light)' }}>
                                  <div>
                                    <span style={{ fontWeight: 500 }}>{it.producto}</span>
                                    <span style={{ color: 'var(--text-muted)', marginLeft: '6px', fontSize: '11px' }}>{it.cantidad} {it.unidadLabel || it.unidad_base}</span>
                                  </div>
                                  <span style={{ fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', marginLeft: '8px' }}>{fmt(it.subtotal)}</span>
                                </div>
                              ))}
                            </div>
                            <div style={{ padding: '8px 14px', textAlign: 'right', fontSize: '12px', color: 'var(--text-muted)' }}>
                              {pitems.length} ítem{pitems.length !== 1 ? 's' : ''}
                            </div>
                          </div>
                        ))}
                    </div>
                    {listaByProv['__sin_datos__']?.items.length > 0 && (
                      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', color: 'var(--warning)', fontSize: '12px' }}>
                        ⚠ Sin datos de precio: {listaByProv['__sin_datos__'].items.map(i => i.producto).join(', ')}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            VISTA: ÚLTIMA LISTA / EVOLUCIÓN
        ══════════════════════════════════════════════════════════════════════ */}
        {viewMode !== 'lista' && (
          entries.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="icon">📊</div>
                <p>{data.length === 0
                  ? 'No hay datos para comparar. Importá listas de proveedores y asigná códigos en Equivalencias.'
                  : 'No se encontraron resultados con estos filtros.'}</p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {entries.map(([cod, g]) => {
                const displayRows = viewMode === 'ultima' ? getUltimaRows(g.rows) : g.rows
                const rowsSorted  = [...displayRows].sort((a, b) => (adjustedPxm(a) ?? Infinity) - (adjustedPxm(b) ?? Infinity))
                const precios     = rowsSorted.map(r => adjustedPxm(r)).filter(p => p != null && p > 0)
                const minP = precios.length ? Math.min(...precios) : null
                const maxP = precios.length ? Math.max(...precios) : null
                const ahorro = minP && maxP && maxP > minP ? ((maxP - minP) / maxP * 100).toFixed(0) : 0
                const evoRows    = viewMode === 'evolucion' ? getEvoRows(cod) : []
                const isExpanded = !!expandedEvo[cod]
                const isSelected = selectedProds.has(cod)
                const unidadLabel = effectiveBaseUnit(g.rows)

                return (
                  <div key={cod} className="card" style={isSelected ? { outline: '2px solid var(--accent)', outlineOffset: '1px' } : {}}>
                    <div className="card-header" style={{ background: 'var(--surface-2)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, flexWrap: 'wrap' }}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(cod)}
                          style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }} />
                        <span className="font-mono badge badge-blue">{cod}</span>
                        <span style={{ fontWeight: 700, fontSize: '14px' }}>{g.producto || cod}</span>
                        {g.categoria && <span className="badge badge-gray">{g.categoria}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexShrink: 0 }}>
                        {minP && (
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Mejor /{unidadLabel}</div>
                            <div style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '16px' }}>{fmt(minP)}</div>
                          </div>
                        )}
                        {ahorro > 0 && <span className="badge badge-yellow">Ahorro posible: {ahorro}%</span>}
                        {viewMode === 'evolucion' && (
                          <button className="btn btn-ghost btn-sm" onClick={() => setExpandedEvo(p => ({ ...p, [cod]: !p[cod] }))}>
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
                            <th>$/unidad</th>
                            <th>${unidadLabel === 'kg' ? '/kg' : unidadLabel === 'litro' ? '/litro' : `/${unidadLabel}`}</th>
                            <th>% vs mejor</th>
                            <th>Fecha</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rowsSorted.map((r, i) => {
                            const px     = adjustedPxm(r)
                            const isBest  = px === minP && minP != null
                            const isWorst = px === maxP && maxP != null && maxP !== minP
                            const vsMejor = isBest ? null : pct(px, minP)
                            const mult    = conImpuestos ? multProv(r.id_proveedor) : 1
                            const provData = provMap[r.id_proveedor]
                            return (
                              <tr key={i} style={isBest ? { background: '#f0fdf4' } : {}}>
                                <td style={{ fontWeight: 600 }}>
                                  {isBest && <span style={{ marginRight: '4px' }}>⭐</span>}
                                  {r.proveedor || r.id_proveedor}
                                  {conImpuestos && provData && (
                                    <div style={{ display: 'flex', gap: '3px', marginTop: '2px', flexWrap: 'wrap' }}>
                                      {provData.descuento_pct > 0 && <span className="badge badge-green" style={{ fontSize: '9px' }}>-{provData.descuento_pct}%</span>}
                                      {provData.aplica_iva && <span className="badge badge-blue" style={{ fontSize: '9px' }}>IVA</span>}
                                      {provData.aplica_percepcion && <span className="badge badge-blue" style={{ fontSize: '9px' }}>Perc.</span>}
                                    </div>
                                  )}
                                </td>
                                <td className="text-muted" style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.producto_original}</td>
                                <td className="text-muted">{r.presentacion_original || '—'}</td>
                                <td><span className={`badge ${r.tipo_compra === 'CAJA' ? 'badge-blue' : 'badge-gray'}`}>{r.tipo_compra}</span></td>
                                <td>
                                  {fmt(r.precio_informado)}
                                  {conImpuestos && mult !== 1 && <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>→ {fmt(r.precio_informado * mult)}</div>}
                                </td>
                                <td>{fmt(conImpuestos ? (r.precio_por_unidad ?? 0) * mult : r.precio_por_unidad)}</td>
                                <td>
                                  <span className={isBest ? 'best-price' : isWorst ? 'worst-price' : ''}>
                                    {fmt(px)}
                                    {isBest  && <span style={{ marginLeft: '4px', fontSize: '10px' }}> ▼ mejor</span>}
                                    {isWorst && <span style={{ marginLeft: '4px', fontSize: '10px' }}> ▲ mayor</span>}
                                  </span>
                                </td>
                                <td>
                                  {isBest
                                    ? <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: '11px' }}>— mejor</span>
                                    : <PctBadge value={vsMejor} small />}
                                </td>
                                <td className="text-muted">{r.fecha || '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Historial de evolución con % cambio */}
                    {viewMode === 'evolucion' && isExpanded && (
                      <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', background: 'var(--surface-2)' }}>
                        <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                          📈 Evolución — {evoRows.length} registros
                        </div>
                        {evoRows.length === 0 ? (
                          <p className="text-muted" style={{ fontSize: '12px' }}>Sin registros en el rango de fechas.</p>
                        ) : (
                          <div className="table-wrapper">
                            <table style={{ fontSize: '12px' }}>
                              <thead>
                                <tr>
                                  <th>Fecha</th>
                                  <th>Proveedor</th>
                                  <th>Presentación</th>
                                  <th>${unidadLabel === 'kg' ? '/kg' : `/${unidadLabel}`}</th>
                                  <th>% vs anterior</th>
                                  <th>Precio lista</th>
                                </tr>
                              </thead>
                              <tbody>
                                {evoRows.map((r, i) => {
                                  const currPxm = effectivePxm(r)
                                  // Próximo en el array = entrada más antigua (mismo proveedor)
                                  const sameProvPrev = evoRows.slice(i + 1).find(
                                    pr => (pr.id_proveedor || pr.proveedor) === (r.id_proveedor || r.proveedor)
                                  )
                                  const prevPxm = sameProvPrev ? effectivePxm(sameProvPrev) : null
                                  const varPct  = pct(currPxm, prevPxm)
                                  return (
                                    <tr key={i}>
                                      <td className="font-mono">{r.fecha || '—'}</td>
                                      <td style={{ fontWeight: 500 }}>{r.proveedor || r.id_proveedor}</td>
                                      <td className="text-muted">{r.presentacion_original || '—'}</td>
                                      <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{fmt(currPxm)}</td>
                                      <td>
                                        {prevPxm != null
                                          ? <PctBadge value={varPct} small />
                                          : <span style={{ color: 'var(--text-light)', fontSize: '11px' }}>primera entrada</span>}
                                      </td>
                                      <td className="text-muted">{fmt(r.precio_informado)}</td>
                                    </tr>
                                  )
                                })}
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
          )
        )}
      </div>

      {/* ── Barra flotante — exportar selección ── */}
      {selectedProds.size > 0 && viewMode !== 'lista' && (
        <div style={{
          position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
          background: '#1e293b', border: '1px solid rgba(255,255,255,.12)', borderRadius: '14px',
          padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '14px',
          boxShadow: '0 8px 32px rgba(0,0,0,.35)', zIndex: 50, animation: 'slideUp .2s ease',
        }}>
          <span style={{ color: '#f1f5f9', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>
            ☑ {selectedProds.size} seleccionado{selectedProds.size !== 1 ? 's' : ''}
          </span>
          <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,.15)' }} />
          <button className="btn btn-sm" style={{ background: '#16a34a', color: '#fff', border: 'none', fontWeight: 600 }}
            onClick={handleExportSelExcel} disabled={exporting}>
            {exporting ? '⏳...' : '📊 Excel'}
          </button>
          <button className="btn btn-sm" style={{ background: '#e07b2c', color: '#fff', border: 'none', fontWeight: 600 }}
            onClick={handleExportSelPDF}>
            🖨 PDF
          </button>
          <button className="btn btn-sm btn-ghost" style={{ color: '#94a3b8' }} onClick={clearSel}>✕</button>
        </div>
      )}
    </>
  )
}
