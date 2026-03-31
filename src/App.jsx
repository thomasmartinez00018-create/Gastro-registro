import { useState, useEffect } from 'react'
import { ImportProvider, useImport } from './ImportContext'
import Dashboard        from './components/Dashboard'
import Productos        from './components/Productos'
import Proveedores      from './components/Proveedores'
import ImportarLista    from './components/ImportarLista'
import Equivalencias    from './components/Equivalencias'
import Comparador       from './components/Comparador'
import Configuracion, { loadAppSettings, applyTheme } from './components/Configuracion'
import SimuladorFactura from './components/SimuladorFactura'
import ActivacionScreen from './components/ActivacionScreen'
import GeneradorLicencias from './components/GeneradorLicencias'

const IS_DEV = import.meta.env.DEV

const SECTIONS = [
  {
    title: 'General',
    items: [
      { id: 'dashboard',     label: 'Dashboard',        icon: 'dashboard'      },
      { id: 'configuracion', label: 'Configuración',     icon: 'settings'       },
    ]
  },
  {
    title: 'Catálogos',
    items: [
      { id: 'productos',     label: 'Productos',         icon: 'inventory_2'    },
      { id: 'proveedores',   label: 'Proveedores',       icon: 'factory'        },
    ]
  },
  {
    title: 'Listas de Precios',
    items: [
      { id: 'importar',      label: 'Importar Lista',    icon: 'upload_file'    },
      { id: 'equivalencias', label: 'Equivalencias',     icon: 'compare_arrows' },
    ]
  },
  {
    title: 'Análisis',
    items: [
      { id: 'comparador',    label: 'Comparador',        icon: 'bar_chart'      },
      { id: 'simulador',     label: 'Pedidos',           icon: 'receipt_long'   },
    ]
  },
  ...( IS_DEV ? [{
    title: 'Desarrollador',
    items: [{ id: 'licencias', label: 'Generar Licencias', icon: 'key' }],
  }] : []),
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
  licencias:     GeneradorLicencias,
}

function AppInner() {
  const [page, setPage] = useState('dashboard')
  const { job } = useImport()
  const Page = PAGES[page] || Dashboard

  // Licencia
  const [licensed,   setLicensed]   = useState(null)
  const [licCliente, setLicCliente] = useState('')

  useEffect(() => {
    if (!window.api?.license) { setLicensed(true); return }
    window.api.license.check().then(res => {
      setLicensed(res.activated)
      setLicCliente(res.cliente || '')
    }).catch(() => setLicensed(true))
  }, [])

  // Personalización
  const [appSettings, setAppSettings] = useState({ restaurantName: '', logoBase64: '', theme: 'gastronomica' })

  useEffect(() => {
    const s = loadAppSettings()
    setAppSettings(s)
    applyTheme(s.theme || 'gastronomica')
  }, [])

  useEffect(() => {
    const handler = (e) => {
      const s = e.detail
      setAppSettings(s)
      applyTheme(s.theme || 'gastronomica')
    }
    window.addEventListener('app-settings-changed', handler)
    return () => window.removeEventListener('app-settings-changed', handler)
  }, [])

  useEffect(() => { window._navigateTo = setPage }, [setPage])

  const { restaurantName } = appSettings

  // Pantalla de carga
  if (licensed === null) return (
    <div style={{ position: 'fixed', inset: 0, background: '#111316', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#64748b', fontSize: '13px', fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span className="material-symbols-outlined" style={{ animation: 'spin 1.2s linear infinite', color: '#fcc570' }}>autorenew</span>
        Verificando licencia…
      </div>
    </div>
  )

  if (!licensed && !IS_DEV) return (
    <ActivacionScreen onActivated={() => setLicensed(true)} />
  )

  return (
    <div className="app-layout">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="sidebar">

        {/* Logo / Identidad */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-title">
            {restaurantName || 'Gastronomic OS'}
          </div>
          <p>Supplier Management</p>
        </div>

        {/* Navegación */}
        <nav className="sidebar-nav">
          {SECTIONS.map(section => (
            <div key={section.title}>
              <div className="nav-section-title">{section.title}</div>
              {section.items.map(item => {
                const isImportando = item.id === 'importar' && job.aiProcessing && page !== 'importar'
                return (
                  <button
                    key={item.id}
                    className={`nav-item ${page === item.id ? 'active' : ''}`}
                    onClick={() => setPage(item.id)}
                  >
                    <span className="icon">
                      <span className="material-symbols-outlined">{item.icon}</span>
                    </span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {isImportando && (
                      <span style={{
                        width: '7px', height: '7px', borderRadius: '50%',
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
            {job.aiProcessing ? 'Procesando…' : licCliente || 'Gastronomía'}
          </span>
        </div>
      </aside>

      {/* ── Content Shell ────────────────────────────────────────────────── */}
      <div className="content-shell">

        {/* Top Bar */}
        <header className="top-bar">
          <div className="top-bar-search">
            <span className="material-symbols-outlined">search</span>
            <input type="text" placeholder="Buscar productos o proveedores…" />
          </div>
          <div className="top-bar-actions">
            <button className="top-bar-sync-btn">
              <span className="material-symbols-outlined">sync</span>
              Sync Local DB
            </button>
            <span className="material-symbols-outlined top-bar-icon">notifications</span>
            <span className="material-symbols-outlined top-bar-icon">cloud_done</span>
            <div className="top-bar-avatar">
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>person</span>
            </div>
          </div>
        </header>

        {/* Contenido de la página */}
        <main className="main-content">
          <Page onNavigate={setPage} />
        </main>

      </div>
    </div>
  )
}

export default function App() {
  return (
    <ImportProvider>
      <AppInner />
    </ImportProvider>
  )
}
