import { useState } from 'react'
import { useAuth } from '../AuthContext'

export default function LoginScreen() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [showPass, setShowPass] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      const res = await login(username.trim(), password)
      if (!res.ok) setError(res.error || 'Usuario o contraseña incorrectos')
    } catch (err) {
      setError(err.message || 'Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-body)',
      padding: 'max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom))',
      overflowY: 'auto',
    }}>

      {/* Fondo con degradado radial ámbar — atmósfera */}
      <div style={{
        position: 'absolute',
        top: '30%', left: '50%',
        transform: 'translateX(-50%) translateY(-50%)',
        width: '500px', height: '500px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(232,151,30,0.06) 0%, transparent 65%)',
        pointerEvents: 'none',
      }} />

      {/* Card central */}
      <div className="login-card" style={{
        position: 'relative',
        zIndex: 1,
        width: '100%',
        maxWidth: '400px',
      }}>

        {/* Cabecera de marca */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          {/* Ícono */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '48px', height: '48px',
            background: 'var(--accent-light)',
            border: '1px solid rgba(232,151,30,0.2)',
            borderRadius: '10px',
            marginBottom: '16px',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '24px', color: 'var(--accent)' }}>
              storefront
            </span>
          </div>

          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '22px',
            fontWeight: 800,
            color: 'var(--text)',
            letterSpacing: '-.03em',
            lineHeight: 1.1,
          }}>
            Gastronomic OS
          </div>
          <div style={{
            fontSize: '11px',
            color: 'var(--text-light)',
            marginTop: '5px',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}>
            Sistema de gestión
          </div>
        </div>

        {/* Card del formulario */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          overflow: 'hidden',
        }}>
          {/* Línea acento superior */}
          <div style={{
            height: '2px',
            background: 'linear-gradient(90deg, var(--accent) 0%, rgba(232,151,30,0.2) 60%, transparent 100%)',
          }} />

          <form onSubmit={handleSubmit} style={{ padding: '28px 28px 24px' }}>

            {/* Error */}
            {error && (
              <div style={{
                background: 'var(--danger-light)',
                border: '1px solid rgba(245,113,90,0.2)',
                borderLeft: '2px solid var(--danger)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                marginBottom: '18px',
                fontSize: '12.5px',
                color: 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>error</span>
                {error}
              </div>
            )}

            {/* Usuario */}
            <div className="form-group">
              <label className="form-label">Usuario</label>
              <div style={{ position: 'relative' }}>
                <span className="material-symbols-outlined" style={{
                  position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)',
                  fontSize: '17px', color: 'var(--text-light)', pointerEvents: 'none',
                }}>person</span>
                <input
                  className="form-input"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="nombre de usuario"
                  autoFocus
                  autoComplete="username"
                  style={{ paddingLeft: '36px', fontSize: '14px' }}
                />
              </div>
            </div>

            {/* Contraseña */}
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">Contraseña</label>
              <div style={{ position: 'relative' }}>
                <span className="material-symbols-outlined" style={{
                  position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)',
                  fontSize: '17px', color: 'var(--text-light)', pointerEvents: 'none',
                }}>lock</span>
                <input
                  className="form-input"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••"
                  autoComplete="current-password"
                  style={{ paddingLeft: '36px', paddingRight: '40px', fontSize: '14px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  style={{
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-light)', padding: '2px', display: 'flex',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>
                    {showPass ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !username.trim() || !password}
              style={{ width: '100%', padding: '12px', fontSize: '14px', fontWeight: 700, justifyContent: 'center' }}
            >
              {loading ? (
                <>
                  <span className="material-symbols-outlined" style={{ animation: 'spin 1s linear infinite', fontSize: '16px' }}>
                    autorenew
                  </span>
                  Ingresando…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>login</span>
                  Ingresar
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div style={{
          textAlign: 'center',
          marginTop: '20px',
          fontSize: '10.5px',
          color: 'var(--text-light)',
          letterSpacing: '.04em',
          textTransform: 'uppercase',
        }}>
          Gestión de proveedores gastronómicos
        </div>
      </div>
    </div>
  )
}
