import { useState, useEffect, useMemo, useRef } from 'react'
import api from '../api'
import { parsePresentacion } from '../utils/presentacion'
import { buildWALink, buildOrderMessage } from '../utils/whatsapp'
import { loadAppSettings } from './Configuracion'

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
  const [catFilter,    setCatFilter]    = useState('')
  const [search,       setSearch]       = useState('')
  const [multiSearch,  setMultiSearch]  = useState('')
  const [useMultiSearch, setUseMultiSearch] = useState(false)
  const [filterDiff,   setFilterDiff]   = useState(false)
  const [desde,        setDesde]        = useState(defaultDesde())
  const [hasta,        setHasta]        = useState(todayStr())
  const [viewMode,     setViewMode]     = useState('ultima')   // 'ultima' | 'evolucion' | 'lista'
  const [expandedEvo,  setExpandedEvo]  = useState({})
  const [conImpuestos, setConImpuestos] = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [exporting,    setExporting]    = useState(false)

  // ── selección para exportar (modo comparador) ──────────────────────────────
  const [selectedProds, setSelectedProds] = useState(new Set())

  // ── settings ────────────────────────────────────────────────────────────────
  const [appSettings, setAppSettings] = useState({ restaurantName: '' })
  useEffect(() => { setAppSettings(loadAppSettings()) }, [])

  // ── lista de compra ────────────────────────────────────────────────────────
  const [listaItems,    setListaItems]    = useState([])   // {codigo,producto,categoria,unidad_base,cantidad}
  const [listaSearch,   setListaSearch]   = useState('')
  const [listaSearchCat, setListaSearchCat] = useState('')
  const [listaLoading,  setListaLoading]  = useState(false)

  // ── lector de código de barras (lista de compra) ────────────────────────────
  const [scannerMode,  setScannerMode]  = useState(false)
  const [scannerInput, setScannerInput] = useState('')
  const [scannerFeedback, setScannerFeedback] = useState(null) // {type:'ok'|'warn'|'dup', msg, prod?}
  const scannerRef = useRef(null)

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

  const multiTerms = useMemo(() =>
    multiSearch.split('\n').map(t => t.trim().toLowerCase()).filter(Boolean)
  , [multiSearch])

  const entries = useMemo(() =>
    Object.entries(grouped).filter(([cod, g]) => {
      const mC = !catFilter || g.categoria === catFilter
      let mS = true
      if (useMultiSearch && multiTerms.length > 0) {
        mS = multiTerms.some(t => g.producto?.toLowerCase().includes(t) || cod.toLowerCase().includes(t))
      } else {
        const q = search.toLowerCase()
        mS = !q || g.producto?.toLowerCase().includes(q) || cod.toLowerCase().includes(q)
      }
      let mD = true
      if (filterDiff) {
        const ps = getUltimaRows(g.rows).map(r => adjustedPxm(r)).filter(p => p != null && p > 0)
        mD = ps.length > 1 && Math.max(...ps) > Math.min(...ps)
      }
      return mC && mS && mD
    })
  , [grouped, catFilter, search, useMultiSearch, multiTerms, filterDiff]) // eslint-disable-line

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

  // ── Lector de código de barras → lista de compra ─────────────────────────────
  const handleScannerInput = (val) => {
    const code = val.trim()
    if (!code) return
    setScannerInput('')
    // Buscar por: código de barras, código interno, código maxirest, o nombre exacto
    const found = productos.find(p =>
      p.activo !== 0 && (
        (p.codigo_barras && p.codigo_barras.trim() === code) ||
        p.codigo === code ||
        (p.codigos_maxirest || '').split(',').map(s => s.trim()).includes(code)
      )
    )
    if (!found) {
      setScannerFeedback({ type: 'warn', msg: `Código "${code}" no encontrado` })
      setTimeout(() => setScannerFeedback(null), 2500)
      return
    }
    if (listaItems.find(i => i.codigo === found.codigo)) {
      setScannerFeedback({ type: 'dup', msg: `"${found.producto}" ya está en la lista`, prod: found })
      setTimeout(() => setScannerFeedback(null), 2000)
      return
    }
    addToLista(found)
    setScannerFeedback({ type: 'ok', msg: `✓ ${found.producto}`, prod: found })
    setTimeout(() => setScannerFeedback(null), 1800)
    // Mantener foco para el próximo escaneo
    setTimeout(() => scannerRef.current?.focus(), 50)
  }

  // Precios calculados para la lista de compra
  const listaConPrecios = useMemo(() => listaItems.map(item => {
    const g = grouped[item.codigo]
    if (!g) return { ...item, bestProveedor: null, bestPxm: null, subtotal: null, opciones: [] }
    const rows = [...getUltimaRows(g.rows)].sort((a, b) => (adjustedPxm(a) ?? Infinity) - (adjustedPxm(b) ?? Infinity))
    const best = rows[0]; const bestPxm = best ? adjustedPxm(best) : null
    return {
      ...item,
      bestProveedor:   best?.proveedor || best?.id_proveedor || null,
      bestIdProveedor: best?.id_proveedor || null,
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
      if (!m[it.bestProveedor]) m[it.bestProveedor] = { items: [], total: 0, id_proveedor: it.bestIdProveedor }
      m[it.bestProveedor].items.push(it)
      m[it.bestProveedor].total += it.subtotal || 0
    })
    return m
  }, [listaConPrecios])

  // ─── Enviar pedido por WhatsApp ───────────────────────────────────────────────
  const handleEnviarPedido = async (provNombre, provData) => {
    const provInfo = proveedores.find(p => p.id_proveedor === provData.id_proveedor)
    const waNumber = provInfo?.whatsapp
    const fecha    = new Date().toISOString().split('T')[0]
    const restaurante = appSettings?.restaurantName || ''

    const message = buildOrderMessage({
      restaurante,
      proveedor: provNombre,
      fecha,
      items: provData.items,
      total: provData.total,
    })

    // Guardar en historial
    if (window.api?.pedidos) {
      try {
        await api.pedidos.create({
          pedido: {
            fecha,
            restaurante,
            id_proveedor: provData.id_proveedor || null,
            proveedor: provNombre,
            notas: null,
            total: provData.total,
            estado: 'enviado',
            nro_orden: null,
          },
          items: provData.items.map(it => ({
            codigo_producto: it.codigo,
            producto: it.producto,
            cantidad: it.cantidad,
            unidad: it.unidadLabel || it.unidad_base || '',
            precio_unitario: it.bestPxm,
            subtotal: it.subtotal,
          })),
        })
      } catch (e) {
        console.warn('[Comparador] No se pudo guardar pedido:', e.message)
      }
    }

    // Abrir WhatsApp
    const link = waNumber ? buildWALink(waNumber, message) : null
    if (link) {
      window.open(link, '_blank')
    } else {
      // Si no hay número, mostrar el mensaje para copiar
      const textarea = document.createElement('textarea')
      textarea.value = message
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      alert(`📋 Mensaje copiado al portapapeles.\n\n${provNombre} no tiene número de WhatsApp cargado.\nPodés pegarlo directamente en la conversación.`)
    }
  }

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

  // Export lista → PDF (Auditoría de Precios)
  const handleExportListaPDF = () => {
    if (!listaItems.length) return
    const date = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })

    // ── métricas de ahorro ─────────────────────────────────────────────────
    const conDatos = listaConPrecios.filter(i => i.bestPxm != null)
    const sinDatos = listaConPrecios.filter(i => i.bestPxm == null)

    // ahorro potencial: para cada prod con >1 proveedor, máximo vs mínimo
    let ahorroTotal = 0
    let prodConAhorro = 0
    listaConPrecios.forEach(it => {
      if (!it.opciones || it.opciones.length < 2) return
      const ps = it.opciones.map(r => adjustedPxm(r)).filter(p => p != null && p > 0)
      if (ps.length < 2) return
      const minP = Math.min(...ps); const maxP = Math.max(...ps)
      if (maxP > minP) {
        ahorroTotal += (maxP - minP) * it.cantidad
        prodConAhorro++
      }
    })

    // resumen por categoría
    const catMap = {}
    listaConPrecios.forEach(it => {
      const cat = it.categoria || 'Sin categoría'
      if (!catMap[cat]) catMap[cat] = { total: 0, items: 0 }
      catMap[cat].items++
      catMap[cat].total += it.subtotal || 0
    })

    const fmtH = n => n != null ? `$${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })}` : '—'

    let html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:12px;color:#111;background:#fff}
.hdr{padding:20px 24px 14px;border-bottom:3px solid #d4a024;display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px}
.htitle{font-size:22px;font-weight:900;color:#111;letter-spacing:-.3px}
.hsub{font-size:11px;color:#666;margin-top:4px}
.hdate{font-size:11px;color:#666;text-align:right}
.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:22px;page-break-inside:avoid}
.scard{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px}
.scard-num{font-size:22px;font-weight:900;color:#d4a024;line-height:1}
.scard-lbl{font-size:10px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:.04em}
.scard.green .scard-num{color:#16a34a}
.scard.red .scard-num{color:#dc2626}
.section-title{font-size:13px;font-weight:800;color:#111;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;padding-bottom:6px;page-break-after:avoid}
table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:4px}
th{background:#1e293b;color:#f1f5f9;padding:6px 8px;text-align:left;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
td{padding:5px 8px;border-bottom:1px solid #f0f0f0;vertical-align:top}
tr.best-row td{background:#fefce8}
tr.best-row td.pxm{color:#15803d;font-weight:800}
tr.other-row td.pxm{color:#6b7280}
.badge-best{background:#d4a024;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;white-space:nowrap}
.badge-cat{background:#e5e7eb;color:#374151;font-size:9px;padding:1px 5px;border-radius:4px}
.prov-section{margin-bottom:16px;page-break-inside:avoid}
.prov-header{background:#1e293b;color:#f1f5f9;padding:8px 14px;display:flex;justify-content:space-between;align-items:center;border-radius:6px 6px 0 0}
.prov-header-name{font-weight:700;font-size:13px}
.prov-header-total{font-weight:800;color:#fcd34d;font-size:14px}
.grand{text-align:right;padding:16px 0 0;font-size:18px;font-weight:900;color:#111;border-top:2px solid #e5e7eb;margin-top:12px}
.ahorro-box{background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;gap:14px;page-break-inside:avoid}
.no-data{background:#fef9c3;border:1px solid #fde68a;padding:8px 12px;border-radius:6px;font-size:11px;color:#92400e;margin-top:12px}
.cat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px}
.cat-card{border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px}
.cat-name{font-weight:700;font-size:11px;color:#374151}
.cat-total{font-size:13px;font-weight:800;color:#d4a024;margin-top:2px}
.cat-items{font-size:10px;color:#9ca3af}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.prov-section{page-break-inside:avoid}}
</style>
<title>Auditoría de Precios</title></head><body>

<div class="hdr">
  <div>
    <div class="htitle">📊 Auditoría de Precios</div>
    <div class="hsub">${listaItems.length} productos analizados · ${conImpuestos ? 'Precios con IVA y otros impuestos' : 'Precios de lista sin impuestos'}</div>
  </div>
  <div class="hdate">${date}</div>
</div>

<div class="summary">
  <div class="scard"><div class="scard-num">${listaItems.length}</div><div class="scard-lbl">Productos</div></div>
  <div class="scard"><div class="scard-num">${Object.keys(listaByProv).filter(k=>k!=='__sin_datos__').length}</div><div class="scard-lbl">Proveedores</div></div>
  <div class="scard green"><div class="scard-num">${fmtH(listaTotal)}</div><div class="scard-lbl">Total estimado (mejor precio)</div></div>
  <div class="scard ${ahorroTotal > 0 ? 'red' : ''}"><div class="scard-num">${ahorroTotal > 0 ? fmtH(ahorroTotal) : '—'}</div><div class="scard-lbl">Ahorro potencial vs precio más caro</div></div>
</div>`

    // Ahorro potencial si existe
    if (ahorroTotal > 0) {
      html += `<div class="ahorro-box">
  <span style="font-size:24px">💡</span>
  <div>
    <div style="font-weight:700;font-size:13px;color:#15803d">Ahorro potencial: ${fmtH(ahorroTotal)}</div>
    <div style="font-size:11px;color:#166534;margin-top:2px">${prodConAhorro} producto${prodConAhorro!==1?'s':''} con diferencia de precio entre proveedores. Elegir siempre el mejor proveedor por producto genera este ahorro estimado.</div>
  </div>
</div>`
    }

    // Resumen por categoría
    const catEntries = Object.entries(catMap).filter(([,v]) => v.total > 0).sort((a,b) => b[1].total - a[1].total)
    if (catEntries.length > 1) {
      html += `<div class="section-title">Distribución por categoría</div>
<div class="cat-grid">`
      catEntries.forEach(([cat, v]) => {
        html += `<div class="cat-card"><div class="cat-name">${cat}</div><div class="cat-total">${fmtH(v.total)}</div><div class="cat-items">${v.items} producto${v.items!==1?'s':''}</div></div>`
      })
      html += `</div>`
    }

    // ── Tabla principal: mejor precio por producto ─────────────────────────
    html += `<div class="section-title">Mejor precio por producto</div>
<table>
<thead><tr><th>Producto</th><th>Categoría</th><th>Cant.</th><th>Mejor proveedor</th><th>Precio/unidad</th><th>Subtotal</th><th>Alternativas (▲% vs mejor)</th></tr></thead>
<tbody>`
    listaConPrecios.forEach(it => {
      const alts = it.opciones?.slice(1) || []
      const altStr = alts.slice(0,3).map(r => {
        const p = adjustedPxm(r)
        const diff = it.bestPxm && p ? ((p - it.bestPxm)/it.bestPxm*100).toFixed(0) : null
        return `${r.proveedor||r.id_proveedor}${diff!=null&&diff>0?` <span style="color:#dc2626">▲${diff}%</span>`:''}`
      }).join(' &nbsp;|&nbsp; ')
      html += `<tr class="${it.bestPxm!=null?'best-row':''}">
  <td style="font-weight:600">${it.producto}</td>
  <td><span class="badge-cat">${it.categoria||'—'}</span></td>
  <td>${it.cantidad} ${it.unidadLabel||it.unidad_base}</td>
  <td>${it.bestProveedor?`<span class="badge-best">⭐ ${it.bestProveedor}</span>`:'<span style="color:#9ca3af">Sin datos</span>'}</td>
  <td class="pxm">${fmtH(it.bestPxm)}</td>
  <td style="font-weight:700">${fmtH(it.subtotal)}</td>
  <td style="font-size:10px;color:#6b7280">${altStr||'—'}</td>
</tr>`
    })
    html += `</tbody></table>
<div class="grand">TOTAL ESTIMADO (MEJOR PRECIO): ${fmtH(listaTotal)}</div>`

    // ── Pedidos por proveedor ──────────────────────────────────────────────
    const provEntries = Object.entries(listaByProv).filter(([k]) => k !== '__sin_datos__').sort((a,b) => b[1].total - a[1].total)
    if (provEntries.length > 0) {
      html += `<div class="section-title" style="margin-top:28px">Pedidos por proveedor</div>`
      provEntries.forEach(([prov, { items: pitems, total }]) => {
        html += `<div class="prov-section">
<div class="prov-header"><span class="prov-header-name">${prov}</span><span class="prov-header-total">${fmtH(total)}</span></div>
<table><thead><tr><th>Producto</th><th>Categoría</th><th>Cantidad</th><th>Unidad</th><th>$/unidad</th><th>Subtotal</th></tr></thead><tbody>`
        pitems.forEach(it => {
          html += `<tr><td>${it.producto}</td><td><span class="badge-cat">${it.categoria||'—'}</span></td><td>${it.cantidad}</td><td>${it.unidadLabel||it.unidad_base}</td><td>${fmtH(it.bestPxm)}</td><td style="font-weight:700">${fmtH(it.subtotal)}</td></tr>`
        })
        html += `</tbody></table></div>`
      })
    }

    // Sin datos
    if (sinDatos.length > 0) {
      html += `<div class="no-data">⚠ Sin datos de precio: ${sinDatos.map(i => i.producto).join(', ')}</div>`
    }

    html += `</body></html>`
    const pw = window.open('', '_blank', 'width=920,height=720')
    if (!pw) { alert('Permitir popups para exportar PDF'); return }
    pw.document.write(html); pw.document.close(); pw.focus()
    setTimeout(() => pw.print(), 400)
  }

  // ─── agregar toda una categoría a la lista ───────────────────────────────
  const addCategoryToLista = cat => {
    if (!cat) return
    const candidatos = productos.filter(p =>
      p.activo && p.categoria === cat && !listaItems.find(i => i.codigo === p.codigo)
    )
    if (candidatos.length === 0) return
    setListaItems(prev => [...prev, ...candidatos.map(p => ({
      codigo: p.codigo, producto: p.producto, categoria: p.categoria || '',
      unidad_base: p.unidad_base || 'kg', cantidad: 1,
    }))])
  }

  // ─── productos filtrados para agregar a lista ──────────────────────────────
  const productosParaLista = useMemo(() => {
    const q = listaSearch.toLowerCase()
    return productos
      .filter(p => p.activo
        && (!listaSearchCat || p.categoria === listaSearchCat)
        && (!q || p.producto.toLowerCase().includes(q) || (p.codigo || '').toLowerCase().includes(q)))
      .filter(p => !listaItems.find(i => i.codigo === p.codigo))
      .slice(0, 80)
  }, [productos, listaSearch, listaSearchCat, listaItems])

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
            <div
              className="stat-card"
              onClick={() => setFilterDiff(v => !v)}
              title={filterDiff ? 'Mostrar todos los productos' : 'Filtrar solo productos con diferencia de precio'}
              style={{ cursor: 'pointer', outline: filterDiff ? '2px solid var(--warning)' : 'none', outlineOffset: '2px', transition: 'outline .15s' }}
            >
              <div className="stat-number" style={{ color: 'var(--warning)' }}>{conAhorro}</div>
              <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                Con diferencia de precio
                {filterDiff
                  ? <span style={{ fontSize: '10px', background: 'var(--warning)', color: '#000', borderRadius: '4px', padding: '1px 5px', fontWeight: 700 }}>ACTIVO</span>
                  : <span style={{ fontSize: '10px', color: 'var(--text-light)' }}>▶ clic para filtrar</span>}
              </div>
            </div>
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
                {/* Buscador: modo simple o multi-lista */}
                <div style={{ flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-start' }}>
                    {!useMultiSearch ? (
                      <div className="search-bar" style={{ flex: 1 }}>
                        <input
                          className="form-input"
                          placeholder="Buscar producto o código..."
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                        />
                      </div>
                    ) : (
                      <div style={{ flex: 1, position: 'relative' }}>
                        <textarea
                          className="form-input"
                          rows={3}
                          placeholder={"Pegá una lista (uno por línea):\nMorrón\nArveja\nCebolla..."}
                          value={multiSearch}
                          onChange={e => setMultiSearch(e.target.value)}
                          style={{ resize: 'vertical', fontSize: '12px', lineHeight: '1.5', fontFamily: 'inherit', minHeight: '64px' }}
                        />
                        {multiTerms.length > 0 && (
                          <span style={{ position: 'absolute', top: '4px', right: '6px', fontSize: '10px', background: 'var(--primary)', color: '#000', borderRadius: '4px', padding: '1px 5px', fontWeight: 700 }}>
                            {multiTerms.length} términos
                          </span>
                        )}
                      </div>
                    )}
                    <button
                      className={`btn btn-sm ${useMultiSearch ? 'btn-accent' : 'btn-secondary'}`}
                      title={useMultiSearch ? 'Volver a búsqueda simple' : 'Buscar varios productos a la vez'}
                      onClick={() => { setUseMultiSearch(v => !v); setSearch(''); setMultiSearch('') }}
                      style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {useMultiSearch ? '✕ Lista' : '☰ Lista'}
                    </button>
                  </div>
                  {useMultiSearch && (
                    <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                      Modo lista — un producto por línea. Busca coincidencia parcial.
                    </div>
                  )}
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
            <div style={{ width: '268px', flexShrink: 0 }}>
              <div className="card" style={{ position: 'sticky', top: '0' }}>
                <div className="card-header" style={{ background: 'var(--surface-2)' }}>
                  <h3 style={{ fontSize: '13px' }}>Agregar productos</h3>
                </div>
                <div className="card-body" style={{ padding: '12px' }}>

                  {/* Filtro por categoría con botón "Agregar todos" */}
                  <div style={{ marginBottom: '8px', display: 'flex', gap: '5px', alignItems: 'center' }}>
                    <select
                      className="form-select"
                      style={{ flex: 1, fontSize: '12px', padding: '5px 8px' }}
                      value={listaSearchCat}
                      onChange={e => setListaSearchCat(e.target.value)}
                    >
                      <option value="">Todas las categorías</option>
                      {cats.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {listaSearchCat && (
                      <button
                        className="btn btn-accent btn-sm"
                        title={`Agregar todos los productos de "${listaSearchCat}"`}
                        onClick={() => addCategoryToLista(listaSearchCat)}
                        style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                      >
                        + Todo
                      </button>
                    )}
                  </div>

                  <input className="form-input" style={{ marginBottom: '8px', fontSize: '12px' }}
                    placeholder="Buscar producto..." value={listaSearch} onChange={e => setListaSearch(e.target.value)} />

                  <div style={{ maxHeight: '340px', overflowY: 'auto', margin: '0 -4px' }}>
                    {productosParaLista.length === 0 && (
                      <div className="text-muted" style={{ padding: '12px', textAlign: 'center', fontSize: '12px' }}>
                        {listaSearch || listaSearchCat ? 'Sin resultados' : 'No quedan productos por agregar'}
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

                    {/* Lector de código de barras */}
                    <button
                      className={`btn btn-sm ${scannerMode ? 'btn-accent' : 'btn-secondary'}`}
                      style={{ width: '100%', justifyContent: 'center', gap: '5px' }}
                      onClick={() => {
                        setScannerMode(v => !v)
                        setScannerInput('')
                        setScannerFeedback(null)
                        if (!scannerMode) setTimeout(() => scannerRef.current?.focus(), 80)
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>barcode_scanner</span>
                      {scannerMode ? 'Cerrar escáner' : 'Lector de código de barras'}
                    </button>

                    {scannerMode && (
                      <div style={{ background: 'var(--surface-3)', borderRadius: '8px', padding: '10px', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textAlign: 'center' }}>
                          Apuntá el lector al producto
                        </div>
                        <input
                          ref={scannerRef}
                          className="form-input font-mono"
                          style={{ fontSize: '13px', textAlign: 'center', letterSpacing: '1px' }}
                          placeholder="Esperando escaneo…"
                          value={scannerInput}
                          onChange={e => setScannerInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleScannerInput(scannerInput) }}
                          autoFocus
                        />
                        {scannerFeedback && (
                          <div style={{
                            marginTop: '6px', padding: '6px 8px', borderRadius: '6px', fontSize: '12px', textAlign: 'center', fontWeight: 600,
                            background: scannerFeedback.type === 'ok' ? 'rgba(110,231,183,0.12)' : scannerFeedback.type === 'dup' ? 'rgba(252,197,112,0.12)' : 'rgba(255,100,100,0.12)',
                            color: scannerFeedback.type === 'ok' ? 'var(--success)' : scannerFeedback.type === 'dup' ? 'var(--primary)' : 'var(--danger)',
                          }}>
                            {scannerFeedback.msg}
                          </div>
                        )}
                      </div>
                    )}

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
                          🖨 PDF Auditoría
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
                            <div style={{ padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                {pitems.length} ítem{pitems.length !== 1 ? 's' : ''}
                              </span>
                              <button
                                className="btn btn-accent btn-sm"
                                style={{ gap: '5px', fontSize: '12px' }}
                                onClick={() => handleEnviarPedido(prov, { items: pitems, total, id_proveedor: listaByProv[prov].id_proveedor })}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>send</span>
                                Pedir por WhatsApp
                              </button>
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
                              <tr key={i} style={isBest ? { background: 'rgba(252,197,112,0.07)', borderLeft: '3px solid var(--primary)' } : { borderLeft: '3px solid transparent' }}>
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
