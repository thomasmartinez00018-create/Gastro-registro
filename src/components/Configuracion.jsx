import { useState, useEffect, useRef } from 'react'
import { getAIKey, AI_MODEL } from '../config'
import { callAI } from '../ai'

// ─── Temas ────────────────────────────────────────────────────────────────────
export const THEMES = {
  gastronomica: {
    label: 'Gastronómica',
    emoji: '🍴',
    vars: {
      '--accent':       '#e67e22',
      '--accent-hover': '#d35400',
      '--accent-light': '#fef0e7',
      '--sidebar-bg':   '#1a1a2e',
      '--sidebar-text': '#ecf0f1',
      '--sidebar-active':'#e67e22',
    },
    chips: ['#e67e22', '#1a1a2e', '#ecf0f1'],
  },
  marino: {
    label: 'Marino',
    emoji: '🌊',
    vars: {
      '--accent':       '#2980b9',
      '--accent-hover': '#1a6a9f',
      '--accent-light': '#e8f4fd',
      '--sidebar-bg':   '#0d2137',
      '--sidebar-text': '#d6eaf8',
      '--sidebar-active':'#2980b9',
    },
    chips: ['#2980b9', '#0d2137', '#d6eaf8'],
  },
  oscuro: {
    label: 'Oscuro',
    emoji: '🌙',
    vars: {
      '--accent':       '#9b59b6',
      '--accent-hover': '#8e44ad',
      '--accent-light': '#f5eef8',
      '--sidebar-bg':   '#0d0d0d',
      '--sidebar-text': '#e8e8e8',
      '--sidebar-active':'#9b59b6',
    },
    chips: ['#9b59b6', '#0d0d0d', '#e8e8e8'],
  },
  claro: {
    label: 'Claro',
    emoji: '☀️',
    vars: {
      '--accent':       '#27ae60',
      '--accent-hover': '#1e8449',
      '--accent-light': '#eafaf1',
      '--sidebar-bg':   '#2c3e50',
      '--sidebar-text': '#ecf0f1',
      '--sidebar-active':'#27ae60',
    },
    chips: ['#27ae60', '#2c3e50', '#ecf0f1'],
  },
  borgona: {
    label: 'Borgoña',
    emoji: '🍷',
    vars: {
      '--accent':       '#922b21',
      '--accent-hover': '#7b241c',
      '--accent-light': '#fdedec',
      '--sidebar-bg':   '#1c0a0a',
      '--sidebar-text': '#f9ebea',
      '--sidebar-active':'#922b21',
    },
    chips: ['#922b21', '#1c0a0a', '#f9ebea'],
  },
}

export function applyTheme(key) {
  const theme = THEMES[key]
  if (!theme) return
  Object.entries(theme.vars).forEach(([prop, val]) => {
    document.documentElement.style.setProperty(prop, val)
  })
}

export function loadAppSettings() {
  try {
    const raw = localStorage.getItem('app_settings')
    if (!raw) return { restaurantName: '', logoBase64: '', theme: 'gastronomica' }
    return JSON.parse(raw)
  } catch { return { restaurantName: '', logoBase64: '', theme: 'gastronomica' } }
}

function saveAppSettings(settings) {
  localStorage.setItem('app_settings', JSON.stringify(settings))
  window.dispatchEvent(new CustomEvent('app-settings-changed', { detail: settings }))
}

// ─── Componente ───────────────────────────────────────────────────────────────
export default function Configuracion() {
  // API Key
  const [key, setKey]         = useState('')
  const [show, setShow]       = useState(false)
  const [saved, setSaved]     = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState('')

  // Personalización
  const [restaurantName, setRestaurantName] = useState('')
  const [logoBase64, setLogoBase64]         = useState('')
  const [theme, setTheme]                   = useState('gastronomica')
  const [settingsSaved, setSettingsSaved]   = useState(false)
  const logoInputRef = useRef(null)

  useEffect(() => {
    const stored = localStorage.getItem('openai_api_key') || ''
    setKey(stored)
    const s = loadAppSettings()
    setRestaurantName(s.restaurantName || '')
    setLogoBase64(s.logoBase64 || '')
    setTheme(s.theme || 'gastronomica')
  }, [])

  // ── API Key ─────────────────────────────────────────────────────────────────
  const handleSave = () => {
    const trimmed = key.trim()
    if (trimmed) localStorage.setItem('openai_api_key', trimmed)
    else localStorage.removeItem('openai_api_key')
    setSaved(true)
    setTestMsg('')
    setTimeout(() => setSaved(false), 2500)
  }

  const handleTest = async () => {
    const trimmed = key.trim()
    if (!trimmed) { setTestMsg('⚠️ Ingresá una API key primero.'); return }
    localStorage.setItem('openai_api_key', trimmed)
    setTesting(true)
    setTestMsg('')
    try {
      const resp = await callAI([{ role: 'user', content: 'Respondé solo con: OK' }], 10)
      if (resp) setTestMsg('✅ Conexión exitosa. La IA está funcionando correctamente.')
      else setTestMsg('⚠️ Respuesta vacía. Verificá el modelo configurado.')
    } catch (err) {
      setTestMsg('❌ Error: ' + err.message)
    } finally { setTesting(false) }
  }

  // ── Personalización ─────────────────────────────────────────────────────────
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

  const handleSaveSettings = () => {
    const s = { restaurantName: restaurantName.trim(), logoBase64, theme }
    saveAppSettings(s)
    applyTheme(theme)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2500)
  }

  const hasKey = !!key.trim()

  return (
    <div className="page-body" style={{ maxWidth: 680 }}>

      <div className="page-header">
        <div>
          <h2 className="page-title">⚙️ Configuración</h2>
          <p className="page-subtitle">Personalización y ajustes del sistema</p>
        </div>
      </div>

      {/* ── Banner sin key ──────────────────────────────────────────────────── */}
      {!hasKey && (
        <div style={{
          background: '#fff3cd', border: '1px solid #ffc107',
          borderRadius: '10px', padding: '14px 18px', marginBottom: '24px',
          display: 'flex', gap: '10px', alignItems: 'flex-start'
        }}>
          <span style={{ fontSize: '20px' }}>⚠️</span>
          <div>
            <strong style={{ display: 'block', marginBottom: '4px' }}>Sin API key configurada</strong>
            <span style={{ fontSize: '13px', color: '#856404' }}>
              Las funciones de IA no funcionarán hasta que configures tu API key de OpenAI.
            </span>
          </div>
        </div>
      )}

      {/* ── Card: Personalización ───────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <span style={{ fontSize: '24px' }}>🏪</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>Personalización</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Nombre del restaurante, logo y tema visual
            </div>
          </div>
        </div>

        {/* Nombre del restaurante */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '13px' }}>
            Nombre del restaurante / negocio
          </label>
          <input
            type="text"
            value={restaurantName}
            onChange={e => setRestaurantName(e.target.value)}
            placeholder="Ej: Parrilla El Gaucho"
            style={{
              width: '100%', padding: '9px 12px', borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--bg)', color: 'var(--text)', fontSize: '14px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Logo */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '8px', fontSize: '13px' }}>
            Logo (opcional, máx. 500 KB)
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            {logoBase64 ? (
              <img
                src={logoBase64}
                alt="Logo"
                style={{
                  width: '64px', height: '64px', objectFit: 'contain',
                  borderRadius: '10px', border: '1px solid var(--border)',
                  background: 'var(--bg)',
                }}
              />
            ) : (
              <div style={{
                width: '64px', height: '64px', borderRadius: '10px',
                border: '2px dashed var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '28px', color: 'var(--text-muted)',
              }}>
                🍴
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => logoInputRef.current?.click()}
                style={{ fontSize: '13px' }}
              >
                📁 Seleccionar imagen
              </button>
              {logoBase64 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setLogoBase64('')}
                  style={{ fontSize: '12px', color: 'var(--danger)' }}
                >
                  🗑 Quitar logo
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

        {/* Selector de temas */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '10px', fontSize: '13px' }}>
            Tema de color
          </label>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
            gap: '10px',
          }}>
            {Object.entries(THEMES).map(([key, t]) => {
              const active = theme === key
              return (
                <button
                  key={key}
                  onClick={() => handleThemePreview(key)}
                  style={{
                    padding: '12px 8px',
                    borderRadius: '10px',
                    border: active ? '2px solid var(--accent)' : '2px solid var(--border)',
                    background: active ? 'var(--accent-light)' : 'var(--surface)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.15s',
                  }}
                >
                  {/* Chips de color */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {t.chips.map((c, i) => (
                      <div key={i} style={{
                        width: '16px', height: '16px', borderRadius: '50%',
                        background: c,
                        border: '1px solid rgba(0,0,0,0.1)',
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

        <button
          className="btn btn-accent"
          onClick={handleSaveSettings}
          style={{ marginTop: '4px' }}
        >
          {settingsSaved ? '✅ Guardado' : '💾 Guardar configuración'}
        </button>
      </div>

      {/* ── Card: API Key ───────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
          <span style={{ fontSize: '24px' }}>🔑</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>OpenAI API Key</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Modelo activo: <code style={{ background: 'var(--bg)', padding: '1px 6px', borderRadius: '4px' }}>{AI_MODEL}</code>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '13px' }}>
            API Key
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type={show ? 'text' : 'password'}
              value={key}
              onChange={e => { setKey(e.target.value); setSaved(false); setTestMsg('') }}
              placeholder="sk-proj-..."
              style={{
                flex: 1,
                padding: '9px 12px', borderRadius: '8px',
                border: '1px solid var(--border)',
                background: 'var(--bg)', color: 'var(--text)',
                fontFamily: 'monospace', fontSize: '13px',
              }}
            />
            <button className="btn btn-secondary" onClick={() => setShow(v => !v)} style={{ minWidth: '70px' }}>
              {show ? '🙈 Ocultar' : '👁 Ver'}
            </button>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
            Obtenés tu key en{' '}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer"
               style={{ color: 'var(--accent)' }}>
              platform.openai.com/api-keys
            </a>
            . Se guarda solo en este dispositivo.
          </p>
        </div>

        {testMsg && (
          <div style={{
            padding: '10px 14px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px',
            background: testMsg.startsWith('✅') ? '#d4edda' : testMsg.startsWith('❌') ? '#f8d7da' : '#fff3cd',
            color:      testMsg.startsWith('✅') ? '#155724' : testMsg.startsWith('❌') ? '#721c24' : '#856404',
            border:    `1px solid ${testMsg.startsWith('✅') ? '#c3e6cb' : testMsg.startsWith('❌') ? '#f5c6cb' : '#ffc107'}`,
          }}>
            {testMsg}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-accent" onClick={handleSave}>
            {saved ? '✅ Guardado' : '💾 Guardar key'}
          </button>
          <button className="btn btn-secondary" onClick={handleTest} disabled={testing}>
            {testing ? '⏳ Verificando...' : '🔌 Verificar conexión'}
          </button>
        </div>
      </div>

      {/* ── Card: ¿Cómo obtener key? ────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ fontWeight: 700, marginBottom: '12px', display: 'flex', gap: '8px' }}>
          <span>ℹ️</span> ¿Cómo obtener una API key?
        </div>
        <ol style={{ paddingLeft: '20px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.8' }}>
          <li>Entrá a <strong style={{ color: 'var(--text)' }}>platform.openai.com</strong> y creá una cuenta</li>
          <li>En el menú lateral, hacé clic en <strong style={{ color: 'var(--text)' }}>API Keys</strong></li>
          <li>Hacé clic en <strong style={{ color: 'var(--text)' }}>Create new secret key</strong></li>
          <li>Copiá la key (empieza con <code>sk-proj-</code>) y pegala arriba</li>
          <li>Cargá crédito en <strong style={{ color: 'var(--text)' }}>Billing → Add credit</strong> (recomendado: U$D 5)</li>
        </ol>
        <div style={{
          marginTop: '12px', padding: '10px 14px', borderRadius: '8px',
          background: 'var(--bg)', fontSize: '12px', color: 'var(--text-muted)'
        }}>
          💡 El modelo <strong>{AI_MODEL}</strong> es muy económico — U$D 5 alcanza para miles de listas de precios.
        </div>
      </div>

      {/* ── Card: Datos locales ─────────────────────────────────────────────── */}
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: '8px', display: 'flex', gap: '8px' }}>
          <span>🗑️</span> Datos locales
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
          Todos los datos (productos, proveedores, listas) se guardan localmente en este dispositivo.
          La API key también se almacena solo aquí.
        </p>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          <strong>Ubicación de base de datos:</strong> carpeta de datos de la aplicación (AppData en Windows)
        </div>
      </div>

    </div>
  )
}
