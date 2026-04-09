import { useState, useEffect } from 'react'
import { ImportProvider, useImport } from './ImportContext'
import { AuthProvider, useAuth } from './AuthContext'
import Dashboard        from './components/Dashboard'
import Productos        from './components/Productos'
import Proveedores      from './components/Proveedores'
import ImportarLista    from './components/ImportarLista'
import Equivalencias    from './components/Equivalencias'
import Comparador       from './components/Comparador'
import Configuracion, { loadAppSettings, applyTheme, applyFontSize } from './components/Configuracion'
import SimuladorFactura from './components/SimuladorFactura'
import LoginScreen      from './components/LoginScreen'
import GeneradorLicencias from './components/GeneradorLicencias'
import Vincular from './components/Vincular'
import { QRCodeSVG } from 'qrcode.react'
import Usuarios from './components/Usuarios'
import AccesoRed from './components/AccesoRed'
import ErrorBoundary from './components/ErrorBoundary'

const IS_DEV = import.meta.env.DEV
const IS_ELECTRON = !!window.api

// Items fijos en el bottom nav (mobile)
const BOTTOM_NAV = [
  { id: 'dashboard',  label: 'Inicio',    icon: 'home'         },
  { id: 'productos',  label: 'Productos', icon: 'inventory_2'  },
  { id: 'comparador', label: 'Precios',   icon: 'bar_chart'    },
  { id: 'importar',   label: 'Importar',  icon: 'upload_file'  },
  { id: 'mas',        label: 'Más',       icon: 'grid_view'    },
]
const BOTTOM_NAV_IDS = new Set(['dashboard', 'productos', 'comparador', 'importar'])

function buildSections(isAdmin) {
  return [
    {
      title: 'General',
      items: [
        { id: 'dashboard',     label: 'Dashboard',        icon: 'dashboard'      },
        { id: 'configuracion', label: 'Configuración',    icon: 'settings'       },
        ...(isAdmin ? [{ id: 'usuarios', label: 'Usuarios', icon: 'group' }] : []),
        ...(isAdmin && IS_ELECTRON ? [{ id: 'acceso_red', label: 'Acceso Red', icon: 'wifi' }] : []),
      ]
    },
    {
      title: 'Catálogos',
      items: [
        { id: 'productos',   label: 'Productos',   icon: 'inventory_2'    },
        { id: 'proveedores', label: 'Proveedores', icon: 'factory'        },
      ]
    },
    {
      title: 'Listas de Precios',
      items: [
        { id: 'importar',      label: 'Importar Lista', icon: 'upload_file'    },
        { id: 'equivalencias', label: 'Equivalencias',  icon: 'compare_arrows' },
      ]
    },
    {
      title: 'Análisis',
      items: [
        { id: 'comparador', label: 'Comparador', icon: 'bar_chart'    },
        { id: 'simulador',  label: 'Pedidos',    icon: 'receipt_long' },
      ]
    },
    ...(isAdmin ? [{
      title: 'Integración',
      items: [{ id: 'vincular', label: 'Vincular OPS', icon: 'link' }]
    }] : []),
    ...(IS_DEV ? [{
      title: 'Desarrollador',
      items: [{ id: 'licencias', label: 'Generar Licencias', icon: 'key' }],
    }] : []),
  ]
}

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
  vincular:      Vincular,
  usuarios:      Usuarios,
  acceso_red:    AccesoRed,
}

const ADMIN_ONLY_PAGES = new Set(['usuarios', 'acceso_red', 'vincular', 'licencias'])

function AppInner() {
  const [page, setPage] = useState('dashboard')
  const { job } = useImport()
  const { user, logout, isAdmin, loading: authLoading } = useAuth()

  useEffect(() => {
    if (!isAdmin && ADMIN_ONLY_PAGES.has(page)) setPage('dashboard')
  }, [isAdmin, page])

  const effectivePage = (!isAdmin && ADMIN_ONLY_PAGES.has(page)) ? 'dashboard' : page
  const Page = PAGES[effectivePage] || Dashboard

  // Personalización
  const [appSettings, setAppSettings] = useState({ restaurantName: '', logoBase64: '', theme: 'gastronomica' })
  useEffect(() => {
    const s = loadAppSettings()
    setAppSettings(s)
    applyTheme(s.theme || 'gastronomica')
    applyFontSize(s.fontSize || 'normal')
  }, [])
  useEffect(() => {
    const handler = (e) => {
      const s = e.detail
      setAppSettings(s)
      applyTheme(s.theme || 'gastronomica')
      applyFontSize(s.fontSize || 'normal')
    }
    window.addEventListener('app-settings-changed', handler)
    return () => window.removeEventListener('app-settings-changed', handler)
  }, [])
  useEffect(() => { window._navigateTo = setPage }, [setPage])

  const { restaurantName } = appSettings

  // LAN (solo admin en Electron)
  const [lanUrl, setLanUrl] = useState(IS_DEV && isAdmin ? 'http://192.168.1.5:3001' : null)
  const [showQr, setShowQr] = useState(false)
  useEffect(() => {
    if (!isAdmin) { setLanUrl(null); return }
    if (!window.api?.network?.getInfo) return
    window.api.network.getInfo().then(info => {
      if (info?.url) setLanUrl(info.url)
    }).catch(() => {})
  }, [isAdmin])

  // Sidebar desktop colapsable
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === 'true' } catch { return false }
  })
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('sidebar_collapsed', String(next)) } catch {}
      return next
    })
  }

  // Mobile: bottom nav + more sheet
  const [moreOpen, setMoreOpen] = useState(false)
  const navTo = (id) => { setPage(id); setMoreOpen(false) }

  // Pantalla de carga
  if (authLoading) return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '13px', fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span className="material-symbols-outlined" style={{ animation: 'spin 1.2s linear infinite', color: 'var(--accent)' }}>autorenew</span>
        Verificando sesión…
      </div>
    </div>
  )

  if (!user) return <LoginScreen />

  // Items del "Más" en mobile = todo lo que no está en el bottom nav fijo
  const moreItems = buildSections(isAdmin).flatMap(s =>
    s.items.filter(item => !BOTTOM_NAV_IDS.has(item.id))
  )

  return (
    <div className="app-layout">

      {/* ══════════════════════════════════════════
          SIDEBAR — desktop only
      ══════════════════════════════════════════ */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>

        <button className="sidebar-collapse-btn" onClick={toggleSidebar} title={sidebarCollapsed ? 'Expandir' : 'Colapsar'}>
          <span className="material-symbols-outlined">{sidebarCollapsed ? 'chevron_right' : 'chevron_left'}</span>
        </button>

        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-title">{restaurantName || 'Gastronomic OS'}</div>
          <p>Supplier Management</p>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {buildSections(isAdmin).map(section => (
            <div key={section.title}>
              <div className="nav-section-title">{section.title}</div>
              {section.items.map(item => {
                const isImportando = item.id === 'importar' && job.aiProcessing && effectivePage !== 'importar'
                return (
                  <button
                    key={item.id}
                    className={`nav-item ${effectivePage === item.id ? 'active' : ''}`}
                    onClick={() => setPage(item.id)}
                  >
                    <span className="icon">
                      <span className="material-symbols-outlined">{item.icon}</span>
                    </span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {isImportando && (
                      <span style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: 'var(--accent)',
                        animation: 'pulse-dot 1.2s ease-in-out infinite',
                        flexShrink: 0,
                      }} />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="sidebar-footer-badge">{isAdmin ? 'ADMIN' : 'USER'}</span>
            <span className="sidebar-footer-text" style={{ flex: 1 }}>
              {user?.display_name || user?.username || 'Usuario'}
            </span>
          </div>
          <button onClick={logout} style={{
            background: 'none', border: 'none', color: 'var(--text-light)',
            fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
            padding: '2px 0', fontFamily: 'var(--font-body)',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>logout</span>
            Cerrar sesión
          </button>

          {/* LAN indicator */}
          {lanUrl && (
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowQr(v => !v)} style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', padding: '5px 10px',
                color: 'var(--text-muted)', fontSize: '10px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
                fontFamily: 'var(--font-body)',
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: '13px', color: 'var(--success)' }}>wifi</span>
                <code style={{ fontSize: '10px', flex: 1, textAlign: 'left', color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                  {lanUrl.replace('http://', '')}
                </code>
                <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>qr_code_2</span>
              </button>
              {showQr && (
                <div style={{
                  position: 'absolute', bottom: '100%', left: 0, marginBottom: '8px',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-xl)',
                  padding: '16px', zIndex: 200, width: '210px',
                  animation: 'slideModal var(--t-slow) var(--ease-spring)',
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ background: '#fff', padding: '10px', borderRadius: 'var(--radius-sm)', display: 'inline-block', marginBottom: '8px' }}>
                      <QRCodeSVG value={lanUrl} size={130} />
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Escaneá para conectarte</p>
                    <code style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{lanUrl}</code>
                  </div>
                  <button onClick={() => setShowQr(false)} style={{
                    position: 'absolute', top: '6px', right: '6px',
                    background: 'none', border: 'none', color: 'var(--text-light)', cursor: 'pointer',
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ══════════════════════════════════════════
          CONTENT SHELL
      ══════════════════════════════════════════ */}
      <div className="content-shell">
        <main className="main-content">
          <ErrorBoundary key={effectivePage}>
            <Page onNavigate={setPage} />
          </ErrorBoundary>
        </main>
      </div>

      {/* ══════════════════════════════════════════
          BOTTOM NAV — mobile only
      ══════════════════════════════════════════ */}
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {BOTTOM_NAV.map(item => {
            const isActive = item.id === 'mas'
              ? moreOpen
              : effectivePage === item.id
            const isImportando = item.id === 'importar' && job.aiProcessing
            return (
              <button
                key={item.id}
                className={`bottom-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  if (item.id === 'mas') setMoreOpen(v => !v)
                  else { navTo(item.id) }
                }}
              >
                <span className="material-symbols-outlined" style={{ position: 'relative' }}>
                  {item.icon}
                  {isImportando && (
                    <span style={{
                      position: 'absolute', top: -2, right: -2,
                      width: '7px', height: '7px', borderRadius: '50%',
                      background: 'var(--accent)',
                      animation: 'pulse-dot 1.2s ease-in-out infinite',
                    }} />
                  )}
                </span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* ══════════════════════════════════════════
          MORE SHEET — mobile
      ══════════════════════════════════════════ */}
      {moreOpen && (
        <>
          <div className="more-overlay" onClick={() => setMoreOpen(false)} />
          <div className="more-sheet">

            {/* Navegación extra */}
            <div className="more-sheet-header">Secciones</div>
            {moreItems.map(item => (
              <button
                key={item.id}
                className={`more-sheet-item ${effectivePage === item.id ? 'active' : ''}`}
                onClick={() => navTo(item.id)}
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                {item.label}
              </button>
            ))}

            <div className="more-sheet-divider" />

            {/* Usuario + logout */}
            <div className="more-sheet-user">
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                  {user?.display_name || user?.username}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {isAdmin ? 'Administrador' : 'Usuario'}
                </div>
              </div>
              <button onClick={() => { setMoreOpen(false); logout() }} style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', padding: '7px 14px',
                color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--font-body)',
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>logout</span>
                Salir
              </button>
            </div>

            {/* LAN en más */}
            {lanUrl && (
              <div style={{ padding: '0 20px 12px' }}>
                <div style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', padding: '8px 12px',
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--success)' }}>wifi</span>
                  <code style={{ fontSize: '11px', color: 'var(--text)', fontFamily: 'var(--font-mono)', flex: 1 }}>
                    {lanUrl.replace('http://', '')}
                  </code>
                </div>
              </div>
            )}
          </div>
        </>
      )}

    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ImportProvider>
        <AppInner />
      </ImportProvider>
    </AuthProvider>
  )
}
