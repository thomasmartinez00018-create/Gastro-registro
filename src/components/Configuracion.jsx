import { useState, useEffect } from 'react'
import { getAIKey, AI_MODEL } from '../config'
import { callAI } from '../ai'

export default function Configuracion() {
  const [key, setKey]         = useState('')
  const [show, setShow]       = useState(false)
  const [saved, setSaved]     = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState('')

  useEffect(() => {
    const stored = localStorage.getItem('openai_api_key') || ''
    setKey(stored)
  }, [])

  const handleSave = () => {
    const trimmed = key.trim()
    if (trimmed) {
      localStorage.setItem('openai_api_key', trimmed)
    } else {
      localStorage.removeItem('openai_api_key')
    }
    setSaved(true)
    setTestMsg('')
    setTimeout(() => setSaved(false), 2500)
  }

  const handleTest = async () => {
    const trimmed = key.trim()
    if (!trimmed) { setTestMsg('⚠️ Ingresá una API key primero.'); return }
    // Guardamos temporalmente para que callAI la use
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

  const hasKey = !!key.trim()
  const masked = key.trim().length > 8
    ? key.trim().slice(0, 7) + '•'.repeat(Math.min(20, key.trim().length - 7))
    : key

  return (
    <div className="page-body" style={{ maxWidth: 640 }}>

      <div className="page-header">
        <div>
          <h2 className="page-title">⚙️ Configuración</h2>
          <p className="page-subtitle">Ajustes del sistema y conexión con IA</p>
        </div>
      </div>

      {/* Banner de advertencia si no hay key */}
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
              Las funciones de IA (detección de columnas, identificación de productos, equivalencias automáticas)
              no funcionarán hasta que configures tu API key de OpenAI.
            </span>
          </div>
        </div>
      )}

      {/* Card: API Key */}
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
            <button
              className="btn btn-secondary"
              onClick={() => setShow(v => !v)}
              style={{ minWidth: '70px' }}
            >
              {show ? '🙈 Ocultar' : '👁 Ver'}
            </button>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
            Obtenés tu key en{' '}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer"
               style={{ color: 'var(--accent)' }}>
              platform.openai.com/api-keys
            </a>
            . Se guarda solo en este dispositivo, nunca se envía a ningún servidor externo.
          </p>
        </div>

        {/* Mensaje de test */}
        {testMsg && (
          <div style={{
            padding: '10px 14px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px',
            background: testMsg.startsWith('✅') ? '#d4edda'
                       : testMsg.startsWith('❌') ? '#f8d7da' : '#fff3cd',
            color: testMsg.startsWith('✅') ? '#155724'
                   : testMsg.startsWith('❌') ? '#721c24' : '#856404',
            border: `1px solid ${testMsg.startsWith('✅') ? '#c3e6cb'
                                 : testMsg.startsWith('❌') ? '#f5c6cb' : '#ffc107'}`,
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

      {/* Card: Información */}
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

      {/* Card: Limpiar datos */}
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
