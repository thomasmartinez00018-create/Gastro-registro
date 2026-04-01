import { useState, useEffect, useMemo } from 'react'
import api from '../api'

const ACCIONES = [
  { icon: 'upload_file',    title: 'Importar lista',         desc: 'Subir un Excel o PDF de proveedor', page: 'importar'      },
  { icon: 'bar_chart',      title: 'Comparar precios',        desc: 'Ver quién vende más barato',        page: 'comparador'    },
  { icon: 'compare_arrows', title: 'Resolver equivalencias', desc: 'Vincular productos sin código',     page: 'equivalencias' },
  { icon: 'inventory_2',    title: 'Gestionar productos',     desc: 'Alta y edición de insumos',         page: 'productos'     },
  { icon: 'factory',        title: 'Gestionar proveedores',   desc: 'Alta y edición de proveedores',     page: 'proveedores'   },
  { icon: 'receipt_long',   title: 'Simular pedido',          desc: 'Generar una orden de compra',       page: 'simulador'     },
]

const PASOS = [
  { n: '1', icon: 'inventory_2',    t: 'Cargá tus productos',      d: 'Registrá los insumos con código alfanumérico y unidad base.' },
  { n: '2', icon: 'factory',        t: 'Registrá tus proveedores', d: 'Cargá cada proveedor con su ID y datos de contacto.' },
  { n: '3', icon: 'upload_file',    t: 'Importá una lista',        d: 'Subí el Excel o PDF del proveedor. La IA detecta los datos.' },
  { n: '4', icon: 'compare_arrows', t: 'Resolvé pendientes',       d: 'Usá "Automáticas con IA" para vincular productos de un clic.' },
  { n: '5', icon: 'bar_chart',      t: 'Comparar precios',         d: 'Filtrá por producto y compará el precio real por unidad.' },
]

function StatCard({ icon, label, value, accent, warn }) {
  const color = warn ? 'var(--danger)' : accent ? 'var(--primary)' : 'var(--text)'
  return (
    <div className="stat-card">
      <div className="stat-icon">
        <span className="material-symbols-outlined" style={{ color: accent || warn ? (warn ? 'var(--danger)' : 'var(--primary)') : 'var(--text-muted)' }}>
          {icon}
        </span>
      </div>
      <div className="stat-number" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

// Detecta productos con subida de precio > umbral% vs su registro anterior
function detectAlertasPrecios(listas, umbralPct = 10) {
  // Agrupar por producto + proveedor, ordenar por fecha desc
  const grupos = {}
  listas.forEach(l => {
    if (!l.codigo_producto || l.estado_match !== 'OK' || !l.precio_por_medida_base) return
    const key = `${l.codigo_producto}__${l.id_proveedor}`
    if (!grupos[key]) grupos[key] = []
    grupos[key].push(l)
  })
  const alertas = []
  Object.values(grupos).forEach(rows => {
    rows.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
    if (rows.length < 2) return
    const actual   = rows[0].precio_por_medida_base
    const anterior = rows[1].precio_por_medida_base
    if (!actual || !anterior || anterior === 0) return
    const variacion = ((actual - anterior) / anterior) * 100
    if (variacion > umbralPct) {
      alertas.push({
        codigo:    rows[0].codigo_producto,
        producto:  rows[0].producto_original || rows[0].codigo_producto,
        proveedor: rows[0].proveedor || rows[0].id_proveedor,
        actual,
        anterior,
        variacion,
        fecha: rows[0].fecha,
      })
    }
  })
  // Ordenar por variación descendente, tomar top 5
  return alertas.sort((a, b) => b.variacion - a.variacion).slice(0, 5)
}

export default function Dashboard({ onNavigate }) {
  const [stats,  setStats]  = useState({ productos: 0, proveedores: 0, listas: 0, pendientes: 0 })
  const [listas, setListas] = useState([])

  useEffect(() => {
    Promise.all([
      api.productos.getAll(),
      api.proveedores.getAll(),
      api.listas.getAll(),
    ]).then(([productos, proveedores, listasData]) => {
      setStats({
        productos:   productos.filter(p => p.activo).length,
        proveedores: proveedores.filter(p => p.activo).length,
        listas:      listasData.length,
        pendientes:  listasData.filter(l => l.estado_match === 'PENDIENTE').length,
      })
      setListas(listasData)
    })
  }, [])

  const alertasPrecios = useMemo(() => detectAlertasPrecios(listas, 10), [listas])
  const fmtPct = v => `+${v.toFixed(1)}%`
  const fmtARS = n => n != null ? `$${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : '—'

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div>
          <h2>Supplier Intelligence</h2>
          <p>Insights en tiempo real · análisis de proveedores y precios</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={() => onNavigate('comparador')}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>bar_chart</span>
            Comparador
          </button>
          <button className="btn btn-accent" onClick={() => onNavigate('importar')}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
            Nueva Importación
          </button>
        </div>
      </div>

      <div className="page-body">

        {/* ── Stats Row ──────────────────────────────────────────────────── */}
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '24px' }}>
          <StatCard icon="inventory_2"    label="Productos activos"   value={stats.productos}   />
          <StatCard icon="factory"        label="Proveedores activos" value={stats.proveedores} accent />
          <StatCard icon="table_chart"    label="Registros en listas" value={stats.listas}      />
          <StatCard icon="pending_actions" label="Sin código asignado" value={stats.pendientes} warn={stats.pendientes > 0} />
        </div>

        {/* ── Bento Grid ─────────────────────────────────────────────────── */}
        <div className="bento-grid">

          {/* Acciones rápidas */}
          <div className="bento-card bento-span-7">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '22px' }}>bolt</span>
              <div>
                <h3 style={{ fontFamily: 'Manrope, sans-serif', fontSize: '16px', fontWeight: 700 }}>Acciones Rápidas</h3>
                <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>Accedé directo a las secciones principales</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {ACCIONES.map(a => (
                <button
                  key={a.page}
                  onClick={() => onNavigate(a.page)}
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    padding: '14px 12px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all .18s',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'var(--surface-3)'
                    e.currentTarget.style.borderColor = 'rgba(252,197,112,0.3)'
                    e.currentTarget.style.transform = 'translateY(-2px)'
                    e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.3)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'var(--surface-2)'
                    e.currentTarget.style.borderColor = 'var(--border)'
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  <div style={{
                    width: '34px', height: '34px', borderRadius: '8px',
                    background: 'var(--accent-light)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: '10px',
                  }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--accent)', fontSize: '18px' }}>{a.icon}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--text)', marginBottom: '3px' }}>{a.title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4 }}>{a.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Estado del sistema */}
          <div className="bento-card bento-span-5">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '22px' }}>monitoring</span>
              <div>
                <h3 style={{ fontFamily: 'Manrope, sans-serif', fontSize: '16px', fontWeight: 700 }}>Estado del Sistema</h3>
                <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>Métricas y alertas activas</p>
              </div>
            </div>

            {/* Métricas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              {[
                { label: 'Cobertura de productos',    val: stats.listas > 0 ? Math.min(100, Math.round(((stats.listas - stats.pendientes) / Math.max(stats.listas,1)) * 100)) : 0, color: 'var(--primary)' },
                { label: 'Proveedores configurados',  val: Math.min(100, stats.proveedores * 20), color: '#adcbda' },
              ].map(m => (
                <div key={m.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '6px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{m.label}</span>
                    <span style={{ color: m.color, fontWeight: 600 }}>{m.val}%</span>
                  </div>
                  <div style={{ height: '5px', background: 'var(--surface-3)', borderRadius: '99px', overflow: 'hidden' }}>
                    <div style={{ width: `${m.val}%`, height: '100%', background: m.color, borderRadius: '99px', transition: 'width .6s ease' }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Alerta pendientes */}
            {stats.pendientes > 0 ? (
              <div style={{
                background: 'rgba(252,197,112,0.08)',
                border: '1px solid rgba(252,197,112,0.2)',
                borderRadius: '10px',
                padding: '14px',
              }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--warning)', fontSize: '18px', flexShrink: 0, marginTop: '1px' }}>warning</span>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--text)', display: 'block', marginBottom: '2px' }}>{stats.pendientes} productos sin código</strong>
                    Usá Equivalencias con IA para resolverlos en segundos.
                  </div>
                </div>
                <button className="btn btn-accent btn-sm" style={{ width: '100%' }} onClick={() => onNavigate('equivalencias')}>
                  <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>auto_awesome</span>
                  Resolver ahora
                </button>
              </div>
            ) : (
              <div style={{
                background: 'rgba(110,231,183,0.08)',
                border: '1px solid rgba(110,231,183,0.15)',
                borderRadius: '10px',
                padding: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--success)', fontSize: '20px' }}>check_circle</span>
                <div style={{ fontSize: '12px' }}>
                  <div style={{ color: 'var(--success)', fontWeight: 600 }}>Sistema al día</div>
                  <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>No hay pendientes por resolver</div>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* ── Alertas de Precio ─────────────────────────────────────────── */}
        {alertasPrecios.length > 0 && (
          <div className="bento-card bento-span-12" style={{ marginBottom: '0', borderLeft: '3px solid var(--danger)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--danger)', fontSize: '22px' }}>trending_up</span>
                <div>
                  <h3 style={{ fontFamily: 'Manrope, sans-serif', fontSize: '16px', fontWeight: 700 }}>Alertas de Precio</h3>
                  <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Productos con aumento {'>'} 10% respecto a la importación anterior
                  </p>
                </div>
              </div>
              <span style={{
                background: 'rgba(255,180,171,0.12)', color: 'var(--danger)',
                border: '1px solid rgba(255,180,171,0.2)',
                borderRadius: '99px', padding: '3px 10px',
                fontSize: '11px', fontWeight: 700,
              }}>
                {alertasPrecios.length} alerta{alertasPrecios.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
              {alertasPrecios.map((a, i) => (
                <div key={i} style={{
                  background: 'var(--surface-2)', border: '1px solid rgba(255,180,171,0.15)',
                  borderRadius: '10px', padding: '12px 14px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.producto}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {a.proveedor}
                    </div>
                    <div style={{ fontSize: '10.5px', color: 'var(--text-light)', marginTop: '2px' }}>
                      {fmtARS(a.anterior)} → {fmtARS(a.actual)}/unidad
                    </div>
                  </div>
                  <div style={{
                    flexShrink: 0, marginLeft: '10px',
                    background: 'rgba(255,180,171,0.12)', color: 'var(--danger)',
                    borderRadius: '8px', padding: '6px 10px',
                    fontWeight: 800, fontSize: '14px', textAlign: 'center',
                  }}>
                    {fmtPct(a.variacion)}
                  </div>
                </div>
              ))}
              <button
                onClick={() => onNavigate('comparador')}
                style={{
                  background: 'none', border: '2px dashed var(--border)',
                  borderRadius: '10px', padding: '12px 14px',
                  cursor: 'pointer', color: 'var(--text-muted)',
                  fontSize: '12px', fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  transition: 'all .15s', fontFamily: 'inherit',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--danger)'; e.currentTarget.style.color = 'var(--danger)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>open_in_new</span>
                Ver en Comparador
              </button>
            </div>
          </div>
        )}

        {/* ── Guía de uso ────────────────────────────────────────────────── */}
        <div className="bento-card bento-span-12" style={{ borderRadius: 'var(--radius-lg)', marginBottom: '0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '22px' }}>route</span>
            <div>
              <h3 style={{ fontFamily: 'Manrope, sans-serif', fontSize: '16px', fontWeight: 700 }}>Flujo de Trabajo</h3>
              <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>Seguí estos pasos para sacar el máximo provecho del sistema</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0' }}>
            {PASOS.map((s, i) => (
              <div key={s.n} style={{ display: 'flex', position: 'relative' }}>
                {/* Conector */}
                {i < PASOS.length - 1 && (
                  <div style={{
                    position: 'absolute',
                    top: '16px',
                    left: 'calc(50% + 16px)',
                    right: '0',
                    height: '1px',
                    background: 'var(--border)',
                    zIndex: 0,
                  }} />
                )}
                <div style={{ padding: '0 16px 0 0', flex: 1, position: 'relative', zIndex: 1 }}>
                  {/* Número + icono */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <div style={{
                      width: '32px', height: '32px',
                      borderRadius: '50%',
                      background: i === 0 ? 'var(--accent)' : 'var(--surface-2)',
                      border: `1px solid ${i === 0 ? 'transparent' : 'var(--border)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <span style={{
                        fontFamily: 'Manrope, sans-serif',
                        fontSize: '13px',
                        fontWeight: 800,
                        color: i === 0 ? '#3d2500' : 'var(--text-muted)',
                      }}>{s.n}</span>
                    </div>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: i === 0 ? 'var(--primary)' : 'var(--text-muted)' }}>{s.icon}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--text)', marginBottom: '4px' }}>{s.t}</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{s.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  )
}
