import { useState, useEffect } from 'react'
import api from '../api'

const ACCIONES = [
  { icon: '📋', title: 'Importar lista',         desc: 'Subir un Excel o PDF de proveedor', page: 'importar',      color: '#2d5a3d' },
  { icon: '💰', title: 'Comparar precios',        desc: 'Ver quién vende más barato',        page: 'comparador',    color: '#c9943a' },
  { icon: '⚖️', title: 'Resolver equivalencias', desc: 'Vincular productos sin código',     page: 'equivalencias', color: '#1a6b9a' },
  { icon: '🧺', title: 'Gestionar productos',     desc: 'Alta y edición de insumos',         page: 'productos',     color: '#6b4d2a' },
  { icon: '🚚', title: 'Gestionar proveedores',   desc: 'Alta y edición de proveedores',     page: 'proveedores',   color: '#5a3d6b' },
]

const PASOS = [
  { n: '1', t: 'Cargá tus productos',      d: 'En Productos, registrá los insumos con código alfanumérico y unidad base.' },
  { n: '2', t: 'Registrá tus proveedores', d: 'En Proveedores, cargá cada proveedor con su ID y datos de contacto.' },
  { n: '3', t: 'Importá una lista',        d: 'En Importar Lista, subí el Excel o PDF del proveedor. La IA detecta los datos.' },
  { n: '4', t: 'Resolvé pendientes',       d: 'En Equivalencias usá "Automáticas con IA" para vincular de un clic.' },
  { n: '5', t: 'Comparar precios',         d: 'En Comparador, filtrá por producto y compará el precio real por unidad.' },
]

export default function Dashboard({ onNavigate }) {
  const [stats, setStats] = useState({ productos: 0, proveedores: 0, listas: 0, pendientes: 0 })

  useEffect(() => {
    Promise.all([
      api.productos.getAll(),
      api.proveedores.getAll(),
      api.listas.getAll(),
    ]).then(([productos, proveedores, listas]) => {
      setStats({
        productos:   productos.filter(p => p.activo).length,
        proveedores: proveedores.filter(p => p.activo).length,
        listas:      listas.length,
        pendientes:  listas.filter(l => l.estado_match === 'PENDIENTE').length,
      })
    })
  }, [])

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div>
          <h2>Bienvenido</h2>
          <p>Panel general del sistema de gestión de proveedores</p>
        </div>
      </div>

      <div className="page-body">

        {/* ── Stats ──────────────────────────────────────────────────────── */}
        <div className="stats-grid">
          {[
            { icon: '🧺', label: 'Productos activos',    val: stats.productos,   color: 'var(--primary)' },
            { icon: '🚚', label: 'Proveedores activos',  val: stats.proveedores, color: 'var(--primary)' },
            { icon: '📋', label: 'Registros en listas',  val: stats.listas,      color: 'var(--primary)' },
            { icon: '⚖️', label: 'Sin código asignado',  val: stats.pendientes,  color: stats.pendientes > 0 ? 'var(--warning)' : 'var(--primary)' },
          ].map(s => (
            <div className="stat-card" key={s.label}>
              <span className="stat-icon">{s.icon}</span>
              <div className="stat-number" style={{ color: s.color }}>{s.val}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Alerta pendientes */}
        {stats.pendientes > 0 && (
          <div className="alert alert-warning mb-3" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' }}>
            <span>⚠️ Hay <strong>{stats.pendientes}</strong> productos sin código. Usá <strong>Equivalencias → Automáticas con IA</strong> para resolverlos en segundos.</span>
            <button className="btn btn-sm btn-accent" onClick={() => onNavigate('equivalencias')} style={{ flexShrink:0 }}>
              Ir ahora →
            </button>
          </div>
        )}

        {/* ── Acciones rápidas ───────────────────────────────────────────── */}
        <div className="card mb-3">
          <div className="card-header">
            <h3>Acciones rápidas</h3>
          </div>
          <div className="card-body">
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(170px, 1fr))', gap:'12px' }}>
              {ACCIONES.map(a => (
                <button key={a.page} onClick={() => onNavigate(a.page)}
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    padding: '16px 14px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all .18s',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = '#fff'
                    e.currentTarget.style.borderColor = a.color
                    e.currentTarget.style.boxShadow = `0 4px 12px ${a.color}22`
                    e.currentTarget.style.transform = 'translateY(-1px)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'var(--surface-2)'
                    e.currentTarget.style.borderColor = 'var(--border)'
                    e.currentTarget.style.boxShadow = 'none'
                    e.currentTarget.style.transform = 'translateY(0)'
                  }}>
                  <div style={{
                    width: '38px', height: '38px', borderRadius: '9px',
                    background: `${a.color}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '20px', marginBottom: '10px',
                  }}>
                    {a.icon}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text)', marginBottom: '4px' }}>{a.title}</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: 1.4 }}>{a.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Guía de uso ────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <h3>¿Cómo usar el sistema?</h3>
          </div>
          <div className="card-body">
            <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
              {PASOS.map((s, i) => (
                <div key={s.n} style={{ display:'flex', gap:'14px', alignItems:'flex-start' }}>
                  <div style={{
                    background: i === 0 ? 'var(--accent)' : 'var(--primary)',
                    color: '#fff',
                    borderRadius: '50%',
                    width: '26px', height: '26px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: 800, flexShrink: 0,
                    boxShadow: i === 0 ? '0 2px 6px rgba(201,148,58,.4)' : '0 2px 6px rgba(45,90,61,.25)',
                  }}>{s.n}</div>
                  <div style={{ paddingTop: '2px' }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>{s.t}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px', lineHeight: 1.5 }}>{s.d}</div>
                  </div>
                  {i < PASOS.length - 1 && (
                    <div style={{ position:'relative' }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </>
  )
}
