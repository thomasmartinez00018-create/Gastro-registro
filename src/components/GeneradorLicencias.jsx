import { useState } from 'react'

// ─── Solo visible en modo desarrollo ─────────────────────────────────────────
// Herramienta del desarrollador para generar claves de licencia por cliente
export default function GeneradorLicencias() {
  const [clienteId, setClienteId] = useState('')
  const [clave,     setClave]     = useState('')
  const [copiado,   setCopiado]   = useState(false)
  const [historial, setHistorial] = useState([])

  const handleGenerar = async () => {
    if (!clienteId.trim()) return
    const result = await window.api.license.generate(clienteId.trim())
    if (!result) { alert('El generador solo funciona en modo desarrollo.'); return }
    setClave(result)
    setHistorial(prev => {
      const nuevo = { cliente: clienteId.trim(), clave: result, fecha: new Date().toLocaleString('es-AR') }
      return [nuevo, ...prev.filter(h => h.cliente !== clienteId.trim())].slice(0, 20)
    })
  }

  const copiar = async (text) => {
    await navigator.clipboard.writeText(text)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1800)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">🔑 Generador de Licencias</div>
          <div className="page-subtitle" style={{ color: 'var(--danger)' }}>
            ⚠ Solo visible en modo desarrollo — no aparece en la app del cliente
          </div>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 600 }}>

        <div className="alert alert-warning" style={{ marginBottom: '20px' }}>
          <div>
            <strong>¿Cómo funciona?</strong><br />
            Ingresás el nombre exacto del cliente (ej: <code>Alameda</code>), generás la clave, y se la enviás.
            El cliente ingresa su nombre y la clave en la pantalla de activación.
            <br /><br />
            <strong>⚠ La clave depende del nombre exacto.</strong> Si el cliente escribe distinto, no funciona.
            Usá nombres cortos y simples (sin acentos es más seguro).
          </div>
        </div>

        <div className="card" style={{ marginBottom: '20px' }}>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Nombre del cliente</label>
              <input
                className="form-input"
                placeholder="Ej: Alameda"
                value={clienteId}
                onChange={e => { setClienteId(e.target.value); setClave('') }}
                onKeyDown={e => e.key === 'Enter' && handleGenerar()}
                autoFocus
              />
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Usá el mismo nombre que el cliente va a escribir (no distingue mayúsculas ni espacios extra)
              </div>
            </div>

            <button className="btn btn-accent" onClick={handleGenerar} disabled={!clienteId.trim()}>
              ⚡ Generar clave
            </button>

            {clave && (
              <div style={{
                marginTop: '20px',
                background: 'var(--surface-2)',
                border: '1.5px solid var(--border)',
                borderRadius: '12px',
                padding: '18px 20px',
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  Clave generada para "{clienteId}"
                </div>
                <div style={{
                  fontSize: '26px', fontWeight: 800, fontFamily: 'monospace',
                  letterSpacing: '.12em', color: 'var(--accent)',
                  marginBottom: '12px', wordBreak: 'break-all',
                }}>
                  {clave}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => copiar(clave)}>
                    {copiado ? '✅ Copiado' : '📋 Copiar clave'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => copiar(
                    `Hola! Tu clave de licencia para la app de Gestión de Proveedores es:\n\nCliente: ${clienteId}\nClave: ${clave}\n\nIngresá exactamente esos datos en la pantalla de activación.`
                  )}>
                    💬 Copiar mensaje
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Historial de claves generadas en esta sesión */}
        {historial.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h3>📋 Historial de esta sesión</h3>
              <span className="text-muted">{historial.length} claves</span>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Clave</th>
                    <th>Generada</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map((h, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{h.cliente}</td>
                      <td className="font-mono" style={{ letterSpacing: '.08em', color: 'var(--accent)', fontWeight: 700 }}>{h.clave}</td>
                      <td className="text-muted">{h.fecha}</td>
                      <td>
                        <button className="btn btn-ghost btn-xs" onClick={() => copiar(h.clave)} title="Copiar">📋</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="card" style={{ marginTop: '20px' }}>
          <div className="card-body">
            <div style={{ fontWeight: 700, marginBottom: '10px' }}>🔄 Reset de licencia (cliente)</div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Si el cliente cambia de computadora o necesita reactivar, usá esto para borrar la activación local <strong>desde la computadora del cliente</strong> en modo dev.
            </p>
            <button className="btn btn-danger btn-sm" onClick={async () => {
              if (!window.confirm('¿Confirmar reset de licencia? La app pedirá activación al reiniciar.')) return
              await window.api.license.deactivate()
              alert('Licencia reseteada. Al reiniciar la app se pedirá activación.')
            }}>
              🗑 Reset licencia local
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
