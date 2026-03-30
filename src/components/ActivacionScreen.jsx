import { useState } from 'react'

// ─── Pantalla de activación de licencia ──────────────────────────────────────
export default function ActivacionScreen({ onActivated }) {
  const [clienteId, setClienteId] = useState('')
  const [key,       setKey]       = useState('')
  const [error,     setError]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [success,   setSuccess]   = useState(false)

  // Formatear clave mientras escribe: XXXX-XXXX-XXXX-XXXX
  const handleKeyChange = (e) => {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const formatted = raw.match(/.{1,4}/g)?.join('-') || raw
    setKey(formatted.slice(0, 19))
    setError('')
  }

  const handleActivate = async () => {
    if (!clienteId.trim()) { setError('Ingresá el nombre del cliente.'); return }
    if (key.replace(/-/g, '').length < 16) { setError('La clave debe tener 16 caracteres.'); return }
    setLoading(true)
    setError('')
    try {
      const result = await window.api.license.activate({ key, clienteId: clienteId.trim() })
      if (result.ok) {
        setSuccess(true)
        setTimeout(() => onActivated(), 1200)
      } else {
        setError(result.error || 'Clave inválida.')
      }
    } catch (e) {
      setError('Error al verificar la licencia: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Inter', system-ui, sans-serif",
      zIndex: 9999,
    }}>

      {/* Fondo decorativo */}
      <div style={{
        position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none',
      }}>
        <div style={{ position: 'absolute', top: '-120px', left: '-120px', width: '400px', height: '400px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(224,123,44,.12) 0%, transparent 70%)' }} />
        <div style={{ position: 'absolute', bottom: '-100px', right: '-100px', width: '500px', height: '500px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(22,163,74,.08) 0%, transparent 70%)' }} />
      </div>

      {/* Card */}
      <div style={{
        background: 'rgba(255,255,255,.03)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,.1)',
        borderRadius: '20px',
        padding: '48px 44px',
        width: '420px',
        maxWidth: '96vw',
        boxShadow: '0 32px 64px rgba(0,0,0,.5)',
        position: 'relative',
        textAlign: 'center',
      }}>

        {/* Ícono */}
        <div style={{
          width: '64px', height: '64px', borderRadius: '16px',
          background: 'linear-gradient(135deg, #e07b2c 0%, #f5a354 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '30px', margin: '0 auto 20px',
          boxShadow: '0 8px 24px rgba(224,123,44,.4)',
        }}>🍴</div>

        <h1 style={{ color: '#f1f5f9', fontSize: '22px', fontWeight: 800, margin: '0 0 6px', letterSpacing: '-.02em' }}>
          Gestión de Proveedores
        </h1>
        <p style={{ color: '#64748b', fontSize: '13px', margin: '0 0 36px' }}>
          Sistema gastronómico · Activación requerida
        </p>

        {success ? (
          <div style={{ padding: '24px 0', animation: 'fadeIn .3s ease' }}>
            <div style={{ fontSize: '52px', marginBottom: '12px' }}>✅</div>
            <div style={{ color: '#4ade80', fontWeight: 700, fontSize: '18px' }}>¡Activado correctamente!</div>
            <div style={{ color: '#64748b', fontSize: '13px', marginTop: '6px' }}>Cargando la aplicación…</div>
          </div>
        ) : (
          <>
            {/* Campo cliente */}
            <div style={{ marginBottom: '14px', textAlign: 'left' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94a3b8', marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                Nombre del cliente
              </label>
              <input
                type="text"
                value={clienteId}
                onChange={e => { setClienteId(e.target.value); setError('') }}
                placeholder="Ej: Alameda"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleActivate()}
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: '10px',
                  border: error ? '1.5px solid #ef4444' : '1.5px solid rgba(255,255,255,.12)',
                  background: 'rgba(255,255,255,.06)', color: '#f1f5f9',
                  fontSize: '14px', outline: 'none', boxSizing: 'border-box',
                  fontFamily: 'inherit',
                  transition: 'border-color .15s',
                }}
                onFocus={e => { if (!error) e.target.style.borderColor = '#e07b2c' }}
                onBlur={e => { if (!error) e.target.style.borderColor = 'rgba(255,255,255,.12)' }}
              />
            </div>

            {/* Campo clave */}
            <div style={{ marginBottom: '20px', textAlign: 'left' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94a3b8', marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                Clave de licencia
              </label>
              <input
                type="text"
                value={key}
                onChange={handleKeyChange}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                onKeyDown={e => e.key === 'Enter' && handleActivate()}
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: '10px',
                  border: error ? '1.5px solid #ef4444' : '1.5px solid rgba(255,255,255,.12)',
                  background: 'rgba(255,255,255,.06)', color: '#f1f5f9',
                  fontSize: '16px', fontFamily: "'Cascadia Code', 'Fira Code', 'SF Mono', monospace",
                  letterSpacing: '.08em', outline: 'none', boxSizing: 'border-box',
                  textTransform: 'uppercase', transition: 'border-color .15s',
                }}
                onFocus={e => { if (!error) e.target.style.borderColor = '#e07b2c' }}
                onBlur={e => { if (!error) e.target.style.borderColor = 'rgba(255,255,255,.12)' }}
              />
              {error && (
                <div style={{ color: '#f87171', fontSize: '12px', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span>⚠</span> {error}
                </div>
              )}
            </div>

            {/* Botón */}
            <button
              onClick={handleActivate}
              disabled={loading || !clienteId.trim() || key.replace(/-/g, '').length < 16}
              style={{
                width: '100%', padding: '13px',
                background: loading || !clienteId.trim() || key.replace(/-/g, '').length < 16
                  ? 'rgba(255,255,255,.08)'
                  : 'linear-gradient(135deg, #e07b2c 0%, #c96820 100%)',
                border: 'none', borderRadius: '10px', cursor: loading ? 'wait' : 'pointer',
                color: loading || !clienteId.trim() || key.replace(/-/g, '').length < 16 ? '#475569' : '#fff',
                fontSize: '14px', fontWeight: 700, fontFamily: 'inherit',
                transition: 'all .15s',
                boxShadow: loading ? 'none' : '0 4px 16px rgba(224,123,44,.35)',
              }}
            >
              {loading ? '⏳ Verificando…' : '🔓 Activar licencia'}
            </button>

            <p style={{ color: '#334155', fontSize: '11.5px', marginTop: '20px', lineHeight: 1.5 }}>
              Contactá al desarrollador para obtener tu clave de licencia.
            </p>
          </>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  )
}
