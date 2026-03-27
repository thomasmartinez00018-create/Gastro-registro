import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import api from '../api'
import { callAI } from '../ai'

const PAGE_SIZE = 50

const PREFIXES = {
  'Aceites':'ACE','Aderezos':'ADE','Almacén':'ALM','Bebidas':'BEB',
  'Carnes':'CAR','Embutidos':'EMB','Especias':'ESP','Frutas':'FRU',
  'Harinas':'HAR','Lácteos':'LAC','Legumbres':'LEG','Limpieza':'LIM',
  'Mariscos':'MAR','Panificados':'PAN','Pescados':'PES','Secos':'SEC',
  'Verduras':'VER','Otros':'OTR',
}
const CATEGORIAS = Object.keys(PREFIXES)

const CONFIANZA_BADGE = {
  alta:  { bg: 'rgba(16,185,129,0.18)',  color: '#6ee7b7', label: '● Alta'  },
  media: { bg: 'rgba(245,158,11,0.18)',  color: '#fcd34d', label: '● Media' },
  baja:  { bg: 'rgba(239,68,68,0.18)',   color: '#fca5a5', label: '● Baja'  },
  error: { bg: 'rgba(100,116,139,0.18)', color: '#94a3b8', label: '✕ Error' },
}

export default function Equivalencias() {
  const [listas,    setListas]    = useState([])
  const [productos, setProductos] = useState([])
  const [filter,    setFilter]    = useState('PENDIENTE')
  const [provFilter,setProvFilter]= useState('')
  const [saving,    setSaving]    = useState({})
  const [page,      setPage]      = useState(0)

  // ── AI modal ──────────────────────────────────────────────────────────────
  const [aiOpen,     setAiOpen]     = useState(false)
  const [aiLoading,  setAiLoading]  = useState(false)
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0, msg: '' })
  const [aiResults,  setAiResults]  = useState([])
  const [aiApproved, setAiApproved] = useState(new Set())
  const [aiApplying, setAiApplying] = useState(false)
  const [aiDone,     setAiDone]     = useState(false)

  const load = useCallback(async () => {
    const [l, p] = await Promise.all([api.listas.getAll(), api.productos.getAll()])
    setListas(l)
    setProductos(p.filter(x => x.activo))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [filter, provFilter])

  // ── Asignación manual ─────────────────────────────────────────────────────
  const handleAssign = async (lista, codigoProducto) => {
    if (!codigoProducto) return
    setSaving(s => ({ ...s, [lista.id]: true }))
    try {
      await api.listas.updateMatch({ id: lista.id, codigo_producto: codigoProducto, estado_match: 'OK' })
      await api.equivalencias.create({
        id_proveedor: lista.id_proveedor,
        producto_original: lista.producto_original,
        presentacion_original: lista.presentacion_original,
        codigo_producto: codigoProducto,
        comentarios: 'Asignado manualmente',
      })
      // Actualización local para no recargar todo
      setListas(prev => prev.map(l =>
        l.id === lista.id ? { ...l, codigo_producto: codigoProducto, estado_match: 'OK' } : l
      ))
    } finally {
      setSaving(s => ({ ...s, [lista.id]: false }))
    }
  }

  // ── IA: auto-equivalencias ────────────────────────────────────────────────
  const runAI = async () => {
    const pendientes = listas.filter(l => l.estado_match === 'PENDIENTE')
    if (!pendientes.length) return

    setAiOpen(true)
    setAiLoading(true)
    setAiDone(false)
    setAiResults([])
    setAiApproved(new Set())

    const prodList = productos
      .map(p => `${p.codigo}|${p.producto}|${p.categoria || 'Otros'}`)
      .join('\n')

    const BATCH = 20
    const allResults = []
    const totalBatches = Math.ceil(pendientes.length / BATCH)

    for (let b = 0; b < pendientes.length; b += BATCH) {
      const bNum = Math.floor(b / BATCH) + 1
      setAiProgress({
        current: bNum, total: totalBatches,
        msg: `Procesando ${b + 1}–${Math.min(b + BATCH, pendientes.length)} de ${pendientes.length} productos…`
      })

      const batch = pendientes.slice(b, b + BATCH)
      const itemList = batch
        .map((it, i) => `${i}|${it.producto_original}|${it.presentacion_original || ''}|${it.id_proveedor || ''}`)
        .join('\n')

      const prompt = `Sos un experto en insumos gastronómicos de Argentina.
Tenés que identificar a qué producto interno corresponde cada producto de proveedor.

PRODUCTOS INTERNOS (CODIGO|NOMBRE|CATEGORIA):
${prodList}

PRODUCTOS DE PROVEEDOR (IDX|NOMBRE|PRESENTACIÓN|PROVEEDOR):
${itemList}

Respondé ÚNICAMENTE con JSON válido (sin markdown ni texto extra):
[
  {"idx":0,"codigo":"LAC001","confianza":"alta"},
  {"idx":1,"codigo":null,"nombre_sugerido":"Queso Parmesano","categoria":"Lácteos","unidad":"kg"}
]

Reglas:
- Si el producto del proveedor es claramente el mismo insumo que uno interno → ponés su codigo
- Si no existe en la lista interna → codigo:null, nombre_sugerido genérico (sin marca), categoria de: ${CATEGORIAS.join(', ')}, unidad (kg/litro/unidad/g/ml)
- confianza: "alta" (muy seguro), "media" (razonablemente seguro), "baja" (con dudas)`

      try {
        const resp = await callAI([{ role: 'user', content: prompt }], 3000)
        const clean = resp.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()
        const parsed = JSON.parse(clean)
        for (const m of parsed) {
          if (typeof m.idx === 'number' && m.idx >= 0 && m.idx < batch.length) {
            allResults.push({ ...batch[m.idx], ...m })
          }
        }
      } catch {
        batch.forEach(item => allResults.push({ ...item, codigo: null, confianza: 'error', _aiError: true }))
      }
    }

    setAiResults(allResults)
    // Pre-aprobar matcheos de confianza alta y media
    setAiApproved(new Set(
      allResults
        .filter(r => !r._aiError && (r.codigo || r.nombre_sugerido) && r.confianza !== 'baja')
        .map(r => r.id)
    ))
    setAiLoading(false)
    setAiDone(true)
    setAiProgress({ current: 0, total: 0, msg: '' })
  }

  const toggleApprove = id =>
    setAiApproved(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const selectAll   = () => setAiApproved(new Set(aiResults.filter(r => !r._aiError && (r.codigo || r.nombre_sugerido)).map(r => r.id)))
  const deselectAll = () => setAiApproved(new Set())

  const applyAI = async () => {
    setAiApplying(true)
    const toApply = aiResults.filter(r => aiApproved.has(r.id))

    // Calcular próximos códigos por prefijo para nuevos productos
    const fresh = await api.productos.getAll()
    const countByPrefix = {}
    for (const p of fresh) {
      const prefix = p.codigo.replace(/\d+$/, '')
      countByPrefix[prefix] = (countByPrefix[prefix] || 0) + 1
    }

    for (const item of toApply) {
      if (item.codigo) {
        // Match a producto existente
        await api.listas.updateMatch({ id: item.id, codigo_producto: item.codigo, estado_match: 'OK' })
        await api.equivalencias.create({
          id_proveedor: item.id_proveedor,
          producto_original: item.producto_original,
          presentacion_original: item.presentacion_original,
          codigo_producto: item.codigo,
          comentarios: `IA automática (confianza: ${item.confianza})`,
        })
      } else if (item.nombre_sugerido) {
        // Crear nuevo producto
        const cat    = item.categoria || 'Otros'
        const prefix = PREFIXES[cat] || cat.slice(0,3).toUpperCase()
        countByPrefix[prefix] = (countByPrefix[prefix] || 0) + 1
        const codigo = `${prefix}${String(countByPrefix[prefix]).padStart(3,'0')}`

        await api.productos.create({
          codigo, producto: item.nombre_sugerido, categoria: cat,
          unidad_base: item.unidad || 'kg', contenido_unitario: null,
          unidad_medida: null, marca: '', alias: '', activo: 1,
        })
        await api.listas.updateMatch({ id: item.id, codigo_producto: codigo, estado_match: 'OK' })
        await api.equivalencias.create({
          id_proveedor: item.id_proveedor,
          producto_original: item.producto_original,
          presentacion_original: item.presentacion_original,
          codigo_producto: codigo,
          comentarios: 'Producto creado automáticamente por IA',
        })
      }
    }

    await load()
    setAiOpen(false)
    setAiApplying(false)
    setAiResults([])
    setAiApproved(new Set())
    setAiDone(false)
  }

  // ── Datos derivados ───────────────────────────────────────────────────────
  const pendientes  = listas.filter(l => l.estado_match === 'PENDIENTE')
  const resueltos   = listas.filter(l => l.estado_match === 'OK')
  const provsList   = [...new Set(listas.map(l => l.id_proveedor).filter(Boolean))]

  const filtered = listas.filter(l => {
    const mF = filter === 'ALL' || l.estado_match === filter
    const mP = !provFilter || l.id_proveedor === provFilter
    return mF && mP
  })

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageItems  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Estadísticas del modal IA
  const aiMatches = aiResults.filter(r => r.codigo && !r._aiError)
  const aiNuevos  = aiResults.filter(r => !r.codigo && r.nombre_sugerido && !r._aiError)
  const aiErrors  = aiResults.filter(r => r._aiError)
  const approvedCount  = aiResults.filter(r => aiApproved.has(r.id)).length
  const approvedNuevos = aiResults.filter(r => aiApproved.has(r.id) && !r.codigo && r.nombre_sugerido).length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Cabecera ──────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h2>Equivalencias</h2>
          <p>Asignar código interno a productos importados sin identificar</p>
        </div>
        {pendientes.length > 0 && (
          <button className="btn btn-primary" onClick={runAI} style={{ gap: '6px' }}>
            🤖 Equivalencias automáticas ({pendientes.length} pendientes)
          </button>
        )}
      </div>

      <div className="page-body">
        {/* ── Stats ─────────────────────────────────────────────────────── */}
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div className="stat-card">
            <div className="stat-number" style={{ color:'var(--warning)' }}>{pendientes.length}</div>
            <div className="stat-label">Sin identificar</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{resueltos.length}</div>
            <div className="stat-label">Identificados</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{listas.length}</div>
            <div className="stat-label">Total en listas</div>
          </div>
        </div>

        {pendientes.length === 0 && filter === 'PENDIENTE' && (
          <div className="alert alert-success mb-3">✅ Todos los productos están identificados.</div>
        )}

        {/* ── Filtros ───────────────────────────────────────────────────── */}
        <div className="card mb-3">
          <div className="card-body" style={{ padding:'10px 16px', display:'flex', gap:'12px', alignItems:'center', flexWrap:'wrap' }}>
            <div style={{ display:'flex', gap:'4px' }}>
              {[
                ['PENDIENTE', `⏳ Pendientes (${pendientes.length})`],
                ['OK',        `✓ Identificados (${resueltos.length})`],
                ['ALL',       'Todos'],
              ].map(([v, l]) => (
                <button key={v}
                  className={`btn btn-sm ${filter === v ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setFilter(v)}>{l}</button>
              ))}
            </div>
            <select className="form-select" style={{ width:'180px' }}
              value={provFilter} onChange={e => setProvFilter(e.target.value)}>
              <option value="">Todos los proveedores</option>
              {provsList.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <span className="text-muted">{filtered.length} registros</span>
          </div>
        </div>

        {/* ── Tabla paginada ────────────────────────────────────────────── */}
        <div className="card">
          <div className="table-wrapper">
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="icon">🔗</div>
                <p>{listas.length === 0 ? 'Aún no hay listas importadas.' : 'No hay registros con estos filtros.'}</p>
              </div>
            ) : (
              <>
                <table>
                  <thead>
                    <tr>
                      <th>Proveedor</th>
                      <th>Producto original</th>
                      <th>Presentación</th>
                      <th>Precio</th>
                      <th>Código asignado</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map(item => (
                      <tr key={item.id}>
                        <td><span className="font-mono text-muted">{item.id_proveedor}</span></td>
                        <td style={{ fontWeight:500, maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                            title={item.producto_original}>{item.producto_original}</td>
                        <td className="text-muted">{item.presentacion_original || '—'}</td>
                        <td style={{ fontWeight:600 }}>
                          {item.precio_informado ? `$${Number(item.precio_informado).toLocaleString('es-AR')}` : '—'}
                        </td>
                        <td style={{ minWidth:'210px' }}>
                          {item.estado_match === 'OK' ? (
                            <span className="font-mono badge badge-green">{item.codigo_producto}</span>
                          ) : (
                            <select className="form-select" style={{ fontSize:'12px', padding:'4px 8px' }}
                              value={item.codigo_producto || ''}
                              onChange={e => handleAssign(item, e.target.value)}
                              disabled={saving[item.id]}>
                              <option value="">— Seleccioná el producto —</option>
                              {productos.map(p => (
                                <option key={p.codigo} value={p.codigo}>[{p.codigo}] {p.producto}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${item.estado_match === 'OK' ? 'badge-green' : 'badge-yellow'}`}>
                            {item.estado_match === 'OK' ? '✓ OK' : '⏳ Pendiente'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Paginación */}
                {totalPages > 1 && (
                  <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:'8px', padding:'12px 16px', borderTop:'1px solid var(--border)' }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => setPage(0)} disabled={page === 0}>««</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => p-1)} disabled={page === 0}>‹ Anterior</button>
                    <span className="text-muted" style={{ fontSize:'13px' }}>
                      Página {page+1} de {totalPages} &nbsp;·&nbsp; {filtered.length} registros
                    </span>
                    <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => p+1)} disabled={page >= totalPages-1}>Siguiente ›</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => setPage(totalPages-1)} disabled={page >= totalPages-1}>»»</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Modal IA — montado en document.body via Portal ────────────────── */}
      {aiOpen && createPortal(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}>
          <div style={{ background:'#1e2028', borderRadius:'14px', width:'100%', maxWidth:'880px', maxHeight:'88vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 80px rgba(0,0,0,0.7)', border:'1px solid rgba(255,255,255,0.08)' }}>

            {/* Header del modal */}
            <div style={{ padding:'20px 24px', borderBottom:'1px solid rgba(255,255,255,0.08)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <h3 style={{ margin:0, color:'#f1f5f9', fontSize:'17px' }}>🤖 Equivalencias automáticas con IA</h3>
                <p style={{ margin:'5px 0 0', color:'#94a3b8', fontSize:'13px' }}>
                  {aiLoading
                    ? aiProgress.msg || 'Iniciando…'
                    : aiDone
                      ? `${aiMatches.length} matcheados · ${aiNuevos.length} nuevos a crear · ${aiErrors.length} errores`
                      : 'Analizando productos pendientes…'}
                </p>
              </div>
              {!aiLoading && !aiApplying && (
                <button onClick={() => { setAiOpen(false); setAiDone(false); setAiResults([]) }}
                  style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.12)', color:'#cbd5e1', borderRadius:'8px', padding:'6px 14px', cursor:'pointer', fontSize:'13px' }}>
                  ✕ Cerrar
                </button>
              )}
            </div>

            {/* Loading */}
            {aiLoading && (
              <div style={{ padding:'56px 24px', textAlign:'center' }}>
                <div style={{ fontSize:'36px', marginBottom:'16px' }}>⏳</div>
                <div style={{ fontSize:'15px', marginBottom:'24px', color:'#94a3b8' }}>{aiProgress.msg}</div>
                <div style={{ background:'rgba(255,255,255,0.08)', borderRadius:'999px', height:'8px', maxWidth:'400px', margin:'0 auto', overflow:'hidden' }}>
                  <div style={{
                    background:'#10b981', height:'100%', borderRadius:'999px', transition:'width 0.4s ease',
                    width: aiProgress.total ? `${(aiProgress.current / aiProgress.total) * 100}%` : '5%'
                  }} />
                </div>
                <div style={{ marginTop:'12px', color:'#64748b', fontSize:'12px' }}>
                  Lote {aiProgress.current} de {aiProgress.total}
                </div>
              </div>
            )}

            {/* Resultados */}
            {aiDone && !aiApplying && (
              <>
                {/* Controles */}
                <div style={{ padding:'12px 20px', borderBottom:'1px solid rgba(255,255,255,0.08)', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap', background:'rgba(255,255,255,0.02)' }}>
                  <button onClick={selectAll}
                    style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.12)', color:'#cbd5e1', borderRadius:'6px', padding:'5px 12px', cursor:'pointer', fontSize:'12px' }}>
                    ✓ Seleccionar todos
                  </button>
                  <button onClick={deselectAll}
                    style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.12)', color:'#cbd5e1', borderRadius:'6px', padding:'5px 12px', cursor:'pointer', fontSize:'12px' }}>
                    ✕ Deseleccionar todos
                  </button>
                  <span style={{ marginLeft:'auto', color:'#94a3b8', fontSize:'13px' }}>
                    <strong style={{ color:'#f1f5f9' }}>{approvedCount}</strong> seleccionados
                    {approvedNuevos > 0 && <span style={{ color:'#60a5fa' }}> · {approvedNuevos} productos nuevos</span>}
                  </span>
                </div>

                {/* Tabla de resultados */}
                <div style={{ overflowY:'auto', flex:1 }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
                    <thead style={{ position:'sticky', top:0, background:'#161820', zIndex:1 }}>
                      <tr>
                        <th style={{ padding:'10px 14px', textAlign:'left', width:'36px', color:'#64748b', fontWeight:500 }}></th>
                        <th style={{ padding:'10px 14px', textAlign:'left', color:'#64748b', fontWeight:500 }}>Producto del proveedor</th>
                        <th style={{ padding:'10px 14px', textAlign:'left', color:'#64748b', fontWeight:500 }}>Sugerencia IA</th>
                        <th style={{ padding:'10px 14px', textAlign:'center', width:'90px', color:'#64748b', fontWeight:500 }}>Confianza</th>
                        <th style={{ padding:'10px 14px', textAlign:'center', width:'80px', color:'#64748b', fontWeight:500 }}>Tipo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiResults.map(item => {
                        const approved = aiApproved.has(item.id)
                        const conf = CONFIANZA_BADGE[item.confianza] || CONFIANZA_BADGE.error
                        const matched = productos.find(p => p.codigo === item.codigo)
                        const canApprove = !item._aiError && (item.codigo || item.nombre_sugerido)

                        return (
                          <tr key={item.id} style={{
                            background: approved ? 'rgba(16,185,129,0.08)' : 'transparent',
                            opacity: item._aiError ? 0.45 : 1,
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            transition: 'background 0.15s',
                          }}>
                            <td style={{ padding:'9px 14px', textAlign:'center' }}>
                              <input type="checkbox"
                                checked={approved}
                                disabled={!canApprove}
                                onChange={() => toggleApprove(item.id)}
                                style={{ width:'16px', height:'16px', cursor: canApprove ? 'pointer' : 'default', accentColor:'#10b981' }} />
                            </td>
                            <td style={{ padding:'9px 14px' }}>
                              <div style={{ fontWeight:500, color:'#e2e8f0' }}>{item.producto_original}</div>
                              <div style={{ color:'#64748b', fontSize:'11px', marginTop:'2px' }}>{item.presentacion_original}{item.presentacion_original && ' · '}{item.id_proveedor}</div>
                            </td>
                            <td style={{ padding:'9px 14px' }}>
                              {item._aiError ? (
                                <span style={{ color:'#64748b' }}>Error al procesar</span>
                              ) : item.codigo ? (
                                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                                  <span style={{ background:'rgba(16,185,129,0.15)', color:'#10b981', padding:'2px 8px', borderRadius:'4px', fontSize:'11px', fontFamily:'monospace', fontWeight:700 }}>{item.codigo}</span>
                                  <span style={{ color:'#cbd5e1' }}>{matched?.producto || '—'}</span>
                                </div>
                              ) : item.nombre_sugerido ? (
                                <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                                  <span style={{ background:'rgba(96,165,250,0.15)', color:'#60a5fa', padding:'2px 8px', borderRadius:'4px', fontSize:'11px', fontWeight:700 }}>NUEVO</span>
                                  <strong style={{ color:'#e2e8f0' }}>{item.nombre_sugerido}</strong>
                                  <span style={{ color:'#64748b', fontSize:'11px' }}>{item.categoria}{item.unidad ? ' · ' + item.unidad : ''}</span>
                                </div>
                              ) : (
                                <span style={{ color:'#64748b' }}>Sin coincidencia</span>
                              )}
                            </td>
                            <td style={{ padding:'9px 14px', textAlign:'center' }}>
                              <span style={{ background:conf.bg, color:conf.color, padding:'3px 9px', borderRadius:'999px', fontSize:'11px', fontWeight:600 }}>
                                {conf.label}
                              </span>
                            </td>
                            <td style={{ padding:'9px 14px', textAlign:'center' }}>
                              {item.codigo ? (
                                <span style={{ color:'#34d399', fontSize:'11px', fontWeight:700 }}>Match</span>
                              ) : item.nombre_sugerido ? (
                                <span style={{ color:'#60a5fa', fontSize:'11px', fontWeight:700 }}>Crear</span>
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footer del modal */}
                <div style={{ padding:'16px 24px', borderTop:'1px solid rgba(255,255,255,0.08)', display:'flex', justifyContent:'flex-end', gap:'10px', background:'rgba(0,0,0,0.2)' }}>
                  <button onClick={() => { setAiOpen(false); setAiDone(false); setAiResults([]) }}
                    style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.12)', color:'#cbd5e1', borderRadius:'8px', padding:'8px 18px', cursor:'pointer', fontSize:'14px' }}>
                    Cancelar
                  </button>
                  <button onClick={applyAI} disabled={approvedCount === 0}
                    style={{ background: approvedCount === 0 ? '#374151' : '#10b981', border:'none', color: approvedCount === 0 ? '#6b7280' : '#fff', borderRadius:'8px', padding:'8px 20px', cursor: approvedCount === 0 ? 'not-allowed' : 'pointer', fontSize:'14px', fontWeight:600 }}>
                    ✓ Aplicar {approvedCount} equivalencias{approvedNuevos > 0 ? ` + ${approvedNuevos} nuevos` : ''}
                  </button>
                </div>
              </>
            )}

            {/* Aplicando */}
            {aiApplying && (
              <div style={{ padding:'56px 24px', textAlign:'center' }}>
                <div style={{ fontSize:'36px', marginBottom:'12px' }}>💾</div>
                <div style={{ color:'#94a3b8', fontSize:'15px' }}>Guardando equivalencias…</div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
