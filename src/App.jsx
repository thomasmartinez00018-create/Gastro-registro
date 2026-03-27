import { useState } from 'react'
import Dashboard    from './components/Dashboard'
import Productos    from './components/Productos'
import Proveedores  from './components/Proveedores'
import ImportarLista from './components/ImportarLista'
import Equivalencias from './components/Equivalencias'
import Comparador   from './components/Comparador'

const SECTIONS = [
  {
    title: 'General',
    items: [
      { id: 'dashboard',     label: 'Inicio',          icon: '⌂'  },
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
  productos:     Productos,
  proveedores:   Proveedores,
  importar:      ImportarLista,
  equivalencias: Equivalencias,
  comparador:    Comparador,
}

export default function App() {
  const [page, setPage] = useState('dashboard')
  const Page = PAGES[page] || Dashboard

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
              {section.items.map(item => (
                <button
                  key={item.id}
                  className={`nav-item ${page === item.id ? 'active' : ''}`}
                  onClick={() => setPage(item.id)}
                >
                  <span className="icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <span className="sidebar-footer-badge">v1.0</span>
          <span className="sidebar-footer-text">Gastronomía</span>
        </div>
      </aside>

      {/* ── Contenido ────────────────────────────────────────────────────── */}
      <main className="main-content">
        <Page onNavigate={setPage} />
      </main>

    </div>
  )
}
