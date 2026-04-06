import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import api from '../api'

export default function AccesoRed() {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!api.network?.getInfo) { setLoading(false); return }
    api.network.getInfo().then(data => {
      setInfo(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (!window.api) return (
    <div className="page-body">
      <div className="alert alert-info">Esta función solo está disponible en la app de escritorio.</div>
    </div>
  )

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Acceso desde Red Local</h2>
          <p>Conectate desde otros dispositivos en la misma red WiFi</p>
        </div>
      </div>

      <div className="page-body">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <span className="material-symbols-outlined" style={{ animation: 'spin 1s linear infinite', fontSize: '32px', color: 'var(--accent)' }}>autorenew</span>
          </div>
        ) : !info?.url ? (
          <div className="alert alert-warning">
            No se detectó una conexión de red local. Asegurate de estar conectado a WiFi.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', maxWidth: '800px' }}>
            {/* QR Code */}
            <div className="card" style={{ textAlign: 'center' }}>
              <div className="card-body" style={{ padding: '32px' }}>
                <div style={{
                  background: '#fff', padding: '20px', borderRadius: 'var(--radius)',
                  display: 'inline-block', marginBottom: '16px',
                }}>
                  <QRCodeSVG value={info.url} size={200} />
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Escaneá con la cámara del celular
                </p>
                <p style={{
                  fontSize: '11px', color: 'var(--accent)', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '.08em',
                }}>Sin instalar nada</p>
              </div>
            </div>

            {/* Info + URL */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Status */}
              <div className="card">
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '10px', height: '10px', borderRadius: '50%',
                    background: 'var(--success)',
                    boxShadow: '0 0 8px var(--success)',
                    animation: 'pulse-dot 2s ease-in-out infinite',
                  }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>Servidor activo en la red</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Puerto {info.port}</div>
                  </div>
                </div>
              </div>

              {/* URL copiable */}
              <div className="card">
                <div className="card-header"><h3>URL de acceso</h3></div>
                <div className="card-body">
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', padding: '10px 14px',
                  }}>
                    <code style={{ flex: 1, fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
                      {info.url}
                    </code>
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      navigator.clipboard?.writeText(info.url)
                      alert('URL copiada al portapapeles')
                    }} title="Copiar">
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>content_copy</span>
                    </button>
                  </div>
                  {info.addresses.length > 1 && (
                    <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-light)' }}>
                      IPs detectadas: {info.addresses.join(', ')}
                    </div>
                  )}
                </div>
              </div>

              {/* Instrucciones */}
              <div className="card">
                <div className="card-header"><h3>Cómo conectarse</h3></div>
                <div className="card-body">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {[
                      { num: 1, icon: 'wifi', text: 'Conectá el celular a la misma red WiFi que esta PC' },
                      { num: 2, icon: 'qr_code_scanner', text: 'Escaneá el QR o abrí el link en el navegador' },
                      { num: 3, icon: 'login', text: 'Ingresá con tu usuario y contraseña' },
                    ].map(step => (
                      <div key={step.num} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '24px', height: '24px', borderRadius: '50%',
                          background: 'var(--accent-light)', color: 'var(--accent)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '11px', fontWeight: 700, flexShrink: 0,
                        }}>{step.num}</div>
                        <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--text-muted)' }}>{step.icon}</span>
                        <span style={{ fontSize: '13px' }}>{step.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
