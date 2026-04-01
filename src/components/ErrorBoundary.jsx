import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { error, info } = this.state
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)',
        padding: '40px', fontFamily: 'Inter, sans-serif',
      }}>
        <div style={{
          maxWidth: '560px', width: '100%',
          background: 'var(--surface)', borderRadius: '16px',
          border: '1px solid rgba(255,180,171,0.2)',
          padding: '32px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--danger)', fontSize: '28px' }}>error</span>
            <div>
              <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}>
                Ocurrió un error inesperado
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                La pantalla no pudo cargarse correctamente
              </p>
            </div>
          </div>

          <div style={{
            background: 'var(--surface-2)', borderRadius: '8px', padding: '12px 14px',
            marginBottom: '20px', fontSize: '12px', fontFamily: 'monospace',
            color: 'var(--danger)', maxHeight: '120px', overflowY: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {error?.message || String(error)}
          </div>

          {info?.componentStack && (
            <details style={{ marginBottom: '20px' }}>
              <summary style={{ fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: '6px' }}>
                Ver stack técnico
              </summary>
              <div style={{
                background: 'var(--surface-2)', borderRadius: '8px', padding: '10px',
                fontSize: '10px', fontFamily: 'monospace', color: 'var(--text-muted)',
                maxHeight: '120px', overflowY: 'auto', whiteSpace: 'pre-wrap',
              }}>
                {info.componentStack}
              </div>
            </details>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn btn-accent"
              onClick={() => this.setState({ hasError: false, error: null, info: null })}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>refresh</span>
              Intentar de nuevo
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => window.location.reload()}
            >
              Recargar la app
            </button>
          </div>
        </div>
      </div>
    )
  }
}
