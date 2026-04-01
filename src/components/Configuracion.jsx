import { useState, useEffect, useRef } from 'react'
import api from '../api'

// ─── Temas ────────────────────────────────────────────────────────────────────
export const THEMES = {
  gastronomica: {
    label: 'Gastronómica',
    emoji: '🍴',
    vars: {
      '--accent':           '#e07b2c',
      '--accent-hover':     '#c96820',
      '--accent-light':     '#fff7ed',
      '--accent-ring':      'rgba(224,123,44,.2)',
      '--sidebar-bg':       '#0f172a',
      '--sidebar-text':     '#7c8fa6',
      '--sidebar-text-dim': '#38485c',
      '--sidebar-active':   '#e07b2c',
    },
    chips: ['#e07b2c', '#0f172a', '#7c8fa6'],
  },
  marino: {
    label: 'Marino',
    emoji: '🌊',
    vars: {
      '--accent':           '#2d82d4',
      '--accent-hover':     '#1c6eb8',
      '--accent-light':     '#eff6ff',
      '--accent-ring':      'rgba(45,130,212,.2)',
      '--sidebar-bg':       '#07192d',
      '--sidebar-text':     '#6d8ea8',
      '--sidebar-text-dim': '#304558',
      '--sidebar-active':   '#2d82d4',
    },
    chips: ['#2d82d4', '#07192d', '#6d8ea8'],
  },
  oscuro: {
    label: 'Oscuro',
    emoji: '🌙',
    vars: {
      '--accent':           '#a855f7',
      '--accent-hover':     '#9333ea',
      '--accent-light':     '#faf5ff',
      '--accent-ring':      'rgba(168,85,247,.2)',
      '--sidebar-bg':       '#080810',
      '--sidebar-text':     '#7070a0',
      '--sidebar-text-dim': '#363660',
      '--sidebar-active':   '#a855f7',
    },
    chips: ['#a855f7', '#080810', '#7070a0'],
  },
  claro: {
    label: 'Claro',
    emoji: '☀️',
    vars: {
      '--accent':           '#16a34a',
      '--accent-hover':     '#15803d',
      '--accent-light':     '#f0fdf4',
      '--accent-ring':      'rgba(22,163,74,.18)',
      '--sidebar-bg':       '#1a2e20',
      '--sidebar-text':     '#6b8c72',
      '--sidebar-text-dim': '#2e4a34',
      '--sidebar-active':   '#16a34a',
    },
    chips: ['#16a34a', '#1a2e20', '#6b8c72'],
  },
  borgona: {
    label: 'Borgoña',
    emoji: '🍷',
    vars: {
      '--accent':           '#be123c',
      '--accent-hover':     '#9f1239',
      '--accent-light':     '#fff1f2',
      '--accent-ring':      'rgba(190,18,60,.2)',
      '--sidebar-bg':       '#150608',
      '--sidebar-text':     '#8a5c64',
      '--sidebar-text-dim': '#4a2028',
      '--sidebar-active':   '#be123c',
    },
    chips: ['#be123c', '#150608', '#8a5c64'],
  },
}

export function applyTheme(key) {
  const theme = THEMES[key]
  if (!theme) return
  Object.entries(theme.vars).forEach(([prop, val]) => {
    document.documentElement.style.setProperty(prop, val)
  })
}

// ─── Tamaños de fuente ────────────────────────────────────────────────────────
export const FONT_SIZES = {
  chica:   { label: 'Chica',   icon: 'text_decrease', zoom: 0.82, desc: 'Más contenido en pantalla' },
  normal:  { label: 'Normal',  icon: 'text_fields',   zoom: 1.00, desc: 'Tamaño por defecto'        },
  grande:  { label: 'Grande',  icon: 'text_increase', zoom: 1.25, desc: 'Mayor legibilidad'          },
}

export function applyFontSize(key) {
  const sz = FONT_SIZES[key]
  if (!sz) return
  // Solo aplica en Electron vía IPC — en browser no hay zoom real disponible
  // sin romper los event handlers de React (coordinate shifting)
  if (window.api?.app?.setZoom) {
    window.api.app.setZoom(sz.zoom)
  }
}

export function loadAppSettings() {
  try {
    const raw = localStorage.getItem('app_settings')
    if (!raw) return { restaurantName: '', logoBase64: '', theme: 'gastronomica', fontSize: 'normal' }
    const s = JSON.parse(raw)
    return { fontSize: 'normal', ...s }
  } catch { return { restaurantName: '', logoBase64: '', theme: 'gastronomica', fontSize: 'normal' } }
}

function saveAppSettings(settings) {
  localStorage.setItem('app_settings', JSON.stringify(settings))
  window.dispatchEvent(new CustomEvent('app-settings-changed', { detail: settings }))
}

// ─── Componente ───────────────────────────────────────────────────────────────
export default function Configuracion() {
  const [restaurantName, setRestaurantName] = useState('')
  const [logoBase64, setLogoBase64]         = useState('')
  const [theme, setTheme]                   = useState('gastronomica')
  const [fontSize, setFontSize]             = useState('normal')
  const [settingsSaved, setSettingsSaved]   = useState(false)
  const [backupStatus, setBackupStatus]     = useState(null)  // { type: 'ok'|'error', msg }
  const [backupLoading, setBackupLoading]   = useState(false)
  const logoInputRef = useRef(null)

  useEffect(() => {
    const s = loadAppSettings()
    setRestaurantName(s.restaurantName || '')
    setLogoBase64(s.logoBase64 || '')
    setTheme(s.theme || 'gastronomica')
    setFontSize(s.fontSize || 'normal')
    applyFontSize(s.fontSize || 'normal')
  }, [])

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500 * 1024) { alert('La imagen no puede superar 500 KB.'); return }
    const reader = new FileReader()
    reader.onload = (ev) => setLogoBase64(ev.target.result)
    reader.readAsDataURL(file)
  }

  const handleThemePreview = (key) => {
    setTheme(key)
    applyTheme(key)
  }

  const handleFontSizePreview = (key) => {
    setFontSize(key)
    applyFontSize(key)
  }

  const handleBackupExport = async () => {
    if (!window.api) { setBackupStatus({ type: 'error', msg: 'Solo disponible en la app de escritorio' }); return }
    setBackupLoading(true); setBackupStatus(null)
    try {
      const r = await api.backup.export()
      if (r.canceled) { setBackupLoading(false); return }
      if (r.ok) setBackupStatus({ type: 'ok', msg: `✅ Backup guardado correctamente` })
      else setBackupStatus({ type: 'error', msg: `Error: ${r.error}` })
    } catch (e) {
      setBackupStatus({ type: 'error', msg: `Error: ${e.message}` })
    } finally { setBackupLoading(false) }
  }

  const handleBackupRestore = async () => {
    if (!window.api) { setBackupStatus({ type: 'error', msg: 'Solo disponible en la app de escritorio' }); return }
    const ok = window.confirm(
      '⚠️ Restaurar un backup reemplazará TODOS los datos actuales.\n\n' +
      'Esta acción no se puede deshacer. ¿Querés continuar?'
    )
    if (!ok) return
    setBackupLoading(true); setBackupStatus(null)
    try {
      const r = await api.backup.restore()
      if (r.canceled) { setBackupLoading(false); return }
      if (r.ok) {
        setBackupStatus({ type: 'ok', msg: '✅ Base de datos restaurada. Reiniciá la app para ver los cambios.' })
      } else {
        setBackupStatus({ type: 'error', msg: `Error al restaurar: ${r.error}` })
      }
    } catch (e) {
      setBackupStatus({ type: 'error', msg: `Error: ${e.message}` })
    } finally { setBackupLoading(false) }
  }

  const handleSaveSettings = () => {
    const s = { restaurantName: restaurantName.trim(), logoBase64, theme, fontSize }
    saveAppSettings(s)
    applyTheme(theme)
    applyFontSize(fontSize)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2500)
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Configuración</h2>
          <p>Personalización del sistema</p>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 680 }}>

        {/* ── Card: Personalización ─────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: '20px' }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>store</span>
              <div>
                <h3>Identidad del negocio</h3>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Nombre, logo y tema visual
                </div>
              </div>
            </div>
          </div>

          <div className="card-body">
            {/* Nombre */}
            <div className="form-group">
              <label className="form-label">Nombre del restaurante / negocio</label>
              <input
                type="text"
                className="form-input"
                value={restaurantName}
                onChange={e => setRestaurantName(e.target.value)}
                placeholder="Ej: Parrilla El Gaucho"
              />
            </div>

            {/* Logo */}
            <div className="form-group">
              <label className="form-label">Logo (opcional · máx. 500 KB)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {logoBase64 ? (
                  <img
                    src={logoBase64}
                    alt="Logo"
                    style={{
                      width: '64px', height: '64px', objectFit: 'contain',
                      borderRadius: '10px', border: '1px solid var(--border)',
                      background: 'var(--surface-2)',
                    }}
                  />
                ) : (
                  <div style={{
                    width: '64px', height: '64px', borderRadius: '10px',
                    border: '2px dashed var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-muted)',
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>restaurant</span>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => logoInputRef.current?.click()}>
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>folder_open</span>
                    Seleccionar imagen
                  </button>
                  {logoBase64 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setLogoBase64('')}
                      style={{ color: 'var(--danger)', fontSize: '12px' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
                      Quitar logo
                    </button>
                  )}
                </div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleLogoChange}
                />
              </div>
            </div>

            {/* Temas */}
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">Tema de color</label>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                gap: '10px',
              }}>
                {Object.entries(THEMES).map(([k, t]) => {
                  const active = theme === k
                  return (
                    <button
                      key={k}
                      onClick={() => handleThemePreview(k)}
                      style={{
                        padding: '12px 8px',
                        borderRadius: '10px',
                        border: active ? '2px solid var(--accent)' : '2px solid var(--border)',
                        background: active ? 'var(--accent-light)' : 'var(--surface-2)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'all 0.15s',
                        fontFamily: 'inherit',
                      }}
                    >
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {t.chips.map((c, i) => (
                          <div key={i} style={{
                            width: '16px', height: '16px', borderRadius: '50%',
                            background: c, border: '1px solid rgba(0,0,0,0.15)',
                          }} />
                        ))}
                      </div>
                      <span style={{ fontSize: '18px' }}>{t.emoji}</span>
                      <span style={{
                        fontSize: '11px', fontWeight: active ? 700 : 500,
                        color: active ? 'var(--accent)' : 'var(--text)',
                        textAlign: 'center',
                      }}>
                        {t.label}
                      </span>
                      {active && (
                        <span style={{
                          fontSize: '10px', background: 'var(--accent)', color: '#fff',
                          borderRadius: '10px', padding: '1px 7px', fontWeight: 700,
                        }}>
                          Activo
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Tamaño de fuente */}
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">Tamaño de texto</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                {Object.entries(FONT_SIZES).map(([k, sz]) => {
                  const active = fontSize === k
                  return (
                    <button
                      key={k}
                      onClick={() => handleFontSizePreview(k)}
                      style={{
                        flex: 1,
                        padding: '14px 10px',
                        borderRadius: '10px',
                        border: active ? '2px solid var(--accent)' : '2px solid var(--border)',
                        background: active ? 'var(--accent-light)' : 'var(--surface-2)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: k === 'chica' ? '18px' : k === 'normal' ? '22px' : '28px',
                          color: active ? 'var(--accent)' : 'var(--text-muted)',
                        }}
                      >
                        {sz.icon}
                      </span>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: active ? 700 : 500,
                        color: active ? 'var(--accent)' : 'var(--text)',
                      }}>
                        {sz.label}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
                        {sz.desc}
                      </span>
                      {active && (
                        <span style={{
                          fontSize: '10px', background: 'var(--accent)', color: '#fff',
                          borderRadius: '10px', padding: '1px 7px', fontWeight: 700,
                        }}>
                          Activo
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            <button className="btn btn-accent" onClick={handleSaveSettings}>
              {settingsSaved
                ? <><span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check_circle</span> Guardado</>
                : <><span className="material-symbols-outlined" style={{ fontSize: '16px' }}>save</span> Guardar configuración</>
              }
            </button>
          </div>
        </div>

        {/* ── Card: Backup / Restore ────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: '20px' }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>backup</span>
              <div>
                <h3>Backup de datos</h3>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Exportar o restaurar la base de datos local
                </div>
              </div>
            </div>
          </div>
          <div className="card-body">
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: 1.6 }}>
              Se recomienda hacer un backup antes de cada actualización o cambio importante.
              El archivo <code style={{ fontSize: '11px', background: 'var(--surface-3)', padding: '1px 5px', borderRadius: '4px' }}>.db</code> contiene
              todos tus productos, proveedores y listas de precios.
            </p>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                onClick={handleBackupExport}
                disabled={backupLoading}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>download</span>
                {backupLoading ? 'Procesando...' : 'Exportar backup'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={handleBackupRestore}
                disabled={backupLoading}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--warning)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>restore</span>
                Restaurar desde backup
              </button>
            </div>

            {backupStatus && (
              <div style={{
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '12.5px',
                background: backupStatus.type === 'ok' ? 'rgba(110,231,183,0.08)' : 'rgba(255,180,171,0.08)',
                border: `1px solid ${backupStatus.type === 'ok' ? 'rgba(110,231,183,0.2)' : 'rgba(255,180,171,0.2)'}`,
                color: backupStatus.type === 'ok' ? 'var(--success)' : 'var(--danger)',
              }}>
                {backupStatus.msg}
              </div>
            )}

            <div style={{
              background: 'var(--surface-2)',
              borderRadius: '8px',
              padding: '10px 14px',
              fontSize: '12px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '14px',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--info)' }}>info</span>
              <span><strong style={{ color: 'var(--text)' }}>Ubicación:</strong> AppData\Roaming\Gestión Proveedores (Windows)</span>
            </div>
          </div>
        </div>

        {/* ── Card: Datos locales ───────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>storage</span>
              <div>
                <h3>Datos locales</h3>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Almacenamiento en este dispositivo
                </div>
              </div>
            </div>
          </div>
          <div className="card-body">
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.6 }}>
              Todos los datos del sistema — productos, proveedores y listas de precios — se guardan
              exclusivamente en este dispositivo. No se envía información a ningún servidor externo.
            </p>
          </div>
        </div>

      </div>
    </>
  )
}
