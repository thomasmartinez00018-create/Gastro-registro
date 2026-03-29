import { useState, useEffect } from 'react'
import { ImportProvider, useImport } from './ImportContext'
import Dashboard     from './components/Dashboard'
import Productos     from './components/Productos'
import Proveedores   from './components/Proveedores'
import ImportarLista from './components/ImportarLista'
import Equivalencias from './components/Equivalencias'
import Comparador    from './components/Comparador'
import Configuracion, { loadAppSettings, applyTheme } from './components/Configuracion'
import SimuladorFactura from './components/SimuladorFactura'

const SECTIONS = [
  {
    title: 'General',
    items: [
      { id: 'dashboard',     label: 'Inicio',          icon: '⌂'  },
      { id: 'configuracion', label: 'Configuración',    icon: '⚙️' },
    ]
  },
  {
    title: 'Catálogos',
    items: [
      { id: 'productos',     label: 'Productos',        icon: '🧺' },
      { id: 'proveedores',   label: 'Proveedores',      icon: '🚚' },
    ]
  },
  {
    title: 'Listas de Precios',
    items: [
      { id: 'importar',      label: 'Importar Lista',   icon: '📋' },
      { id: 'equivalencias', label: 'Equivalencias',    icon: '⚖️' },
    ]
  },
  {
    title: 'Análisis',
    items: [
      { id: 'comparador',    label: 'Comparador',       icon: '💰' },
      { id: 'simulador',     label: 'Simulador de Factura', icon: '🧾' },
    ]
  }
]

const PAGES = {
  dashboard:     Dashboard,
  configuracion: Configuracion,
  productos:     Productos,
  proveedores:   Proveedores,
  importar:      ImportarLista,
  equivalencias: Equivalencias,
  comparador:    Comparador,
  simulador:     SimuladorFactura,
}

// Componente interno — tiene acceso al ImportContext
function AppInner() {
  const [page, setPage] = useState('dashboard')
  const { job } = useImport()
  const Page = PAGES[page] || Dashboard

  // Personalización
  const [appSettings, setAppSettings] = useState({ restaurantName: '', logoBase64: '', theme: 'gastronomica' })

  // Aplicar tema y cargar configuración al iniciar
  useEffect(() => {
    const s = loadAppSettings()
    setAppSettings(s)
    applyTheme(s.theme || 'gastronomica')
  }, [])

  // Escuchar cambios de configuración en tiempo real
  useEffect(() => {
    const handler = (e) => {
      const s = e.detail
      setAppSettings(s)
      applyTheme(s.theme || 'gastronomica')
    }
    window.addEventListener('app-settings-changed', handler)
    return () => window.removeEventListener('app-settings-changed', handler)
  }, [])

  // Exponemos navegación globalmente para que componentes hijos puedan navegar
  useEffect(() => { window._navigateTo = setPage }, [setPage])

  const { restaurantName, logoBase64 } = appSettings

  return (
    <div className="app-layout">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="sidebar">

        {/* Logo / Identidad */}
        <div className="sidebar-logo">
          {logoBase64 ? (
            <img
              src={logoBase64}
              alt="Logo"
              style={{
                width: '48px', height: '48px', objectFit: 'contain',
                borderRadius: '10px',
                marginBottom: '8px',
                background: 'rgba(255,255,255,0.08)',
              }}
            />
          ) : (
            <div className="sidebar-logo-icon">🍴</div>
          )}
          <h1 style={{ wordBreak: 'break-word', textAlign: 'center' }}>
            {restaurantName || 'Gestión de\nProveedores'}
          </h1>
          <p>Sistema gastronómico</p>
        </div>

        {/* Navegación */}
        <nav className="sidebar-nav">
          {SECTIONS.map(section => (
            <div key={section.title}>
              <div className="nav-section-title">{section.title}</div>
              {section.items.map(item => {
                // Indicador animado cuando hay importación activa en segundo plano
                const isImportando = item.id === 'importar' && job.aiProcessing && page !== 'importar'
                return (
                  <button
                    key={item.id}
                    className={`nav-item ${page === item.id ? 'active' : ''}`}
                    onClick={() => setPage(item.id)}
                  >
                    <span className="icon">{item.icon}</span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {isImportando && (
                      <span style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: 'var(--accent)',
                        boxShadow: '0 0 6px var(--accent)',
                        animation: 'pulse-dot 1.2s ease-in-out infinite',
                        flexShrink: 0,
                      }} title="Importación en progreso…" />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <span className="sidebar-footer-badge">v1.2</span>
          <span className="sidebar-footer-text">
            {job.aiProcessing ? '⏳ Procesando…' : 'Gastronomía'}
          </span>
        </div>
      </aside>

      {/* ── Contenido ────────────────────────────────────────────────────── */}
      <main className="main-content">
        <Page onNavigate={setPage} />
      </main>

    </div>
  )
}

// Raíz — provee el contexto
export default function App() {
  return (
    <ImportProvider>
      <AppInner />
    </ImportProvider>
  )
}
