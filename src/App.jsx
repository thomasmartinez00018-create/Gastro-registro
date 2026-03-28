import { useState, useEffect } from 'react'
import { ImportProvider, useImport } from './ImportContext'
import Dashboard     from './components/Dashboard'
import Productos     from './components/Productos'
import Proveedores   from './components/Proveedores'
import ImportarLista from './components/ImportarLista'
import Equivalencias from './components/Equivalencias'
import Comparador    from './components/Comparador'
import Configuracion from './components/Configuracion'

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
}

// Componente interno — tiene acceso al ImportContext
function AppInner() {
  const [page, setPage] = useState('dashboard')
  const { job } = useImport()
  const Page = PAGES[page] || Dashboard

  // Exponemos navegación globalmente para que componentes hijos puedan navegar
  useEffect(() => { window._navigateTo = setPage }, [setPage])

  return (
    <div className="app-layout">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="sidebar">

        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">🍴</div>
          <h1>Gestión de<br/>Proveedores</h1>
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
          <span className="sidebar-footer-badge">v1.0</span>
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
