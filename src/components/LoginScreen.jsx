import { useState } from 'react'
import { useAuth } from '../AuthContext'

export default function LoginScreen() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      const res = await login(username.trim(), password)
      if (!res.ok) setError(res.error || 'Error al iniciar sesión')
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
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* Glow decorativo */}
      <div style={{
        position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
        width: '400px', height: '400px', borderRadius: '50%',
        background: 'radial-gradient(circle, var(--accent-light) 0%, transparent 70%)',
        opacity: 0.4, pointerEvents: 'none',
      }} />

      <form onSubmit={handleSubmit} style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-xl)',
        padding: '40px 36px',
        width: '380px',
        maxWidth: '92vw',
        position: 'relative',
        zIndex: 1,
        animation: 'slideModal var(--t-slow) var(--ease-spring)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            fontFamily: "'Manrope', sans-serif",
            fontSize: '18px',
            fontWeight: 800,
            color: 'var(--sidebar-active)',
            letterSpacing: '.04em',
            textTransform: 'uppercase',
          }}>Gastronomic OS</div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Iniciar sesión</p>
        </div>

        {/* Error */}
        {error && (
          <div className="alert alert-danger" style={{ marginBottom: '16px', fontSize: '12px' }}>
            {error}
          </div>
        )}

        {/* Username */}
        <div className="form-group">
          <label className="form-label">Usuario</label>
          <input
            className="form-input"
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="admin"
            autoFocus
            autoComplete="username"
          />
        </div>

        {/* Password */}
        <div className="form-group">
          <label className="form-label">Contraseña</label>
          <input
            className="form-input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••"
            autoComplete="current-password"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || !username.trim() || !password}
          style={{ width: '100%', marginTop: '8px', padding: '10px' }}
        >
          {loading ? (
            <>
              <span className="material-symbols-outlined" style={{ animation: 'spin 1s linear infinite', fontSize: '16px' }}>autorenew</span>
              Ingresando…
            </>
          ) : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}
