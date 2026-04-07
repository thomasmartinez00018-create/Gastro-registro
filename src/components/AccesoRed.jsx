import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import api from '../api'

export default function AccesoRed() {
  const [info, setInfo]               = useState(null)
  const [loading, setLoading]         = useState(true)
  const [selectedIP, setSelectedIP]   = useState(null)
  const [fwStatus, setFwStatus]       = useState(null) // null | 'loading' | 'ok' | 'error' | 'skipped'
  const isWindows                     = navigator.userAgent.includes('Windows')

  useEffect(() => {
    if (!api.network?.getInfo) { setLoading(false); return }
    api.network.getInfo().then(data => {
      setInfo(data)
      setSelectedIP(data?.addresses?.[0] ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const activeUrl = info && selectedIP ? `http://${selectedIP}:${info.port}` : info?.url

  async function handleOpenFirewall() {
    if (!api.network?.openFirewall) return
    setFwStatus('loading')
    try {
      const res = await api.network.openFirewall()
      if (res?.ok) setFwStatus(res.already ? 'already' : res.skipped ? 'skipped' : 'ok')
      else setFwStatus('error')
    } catch {
      setFwStatus('error')
    }
  }

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
            No se detectó una conexión de red local. Asegurate de estar conectado a WiFi o Ethernet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '820px' }}>

            {/* Selector de IP si hay múltiples */}
            {info.addresses.length > 1 && (
              <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--accent)', fontSize: '20px' }}>device_hub</span>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>
                    Se detectaron {info.addresses.length} interfaces de red. Elegí la que comparte WiFi con el celular:
                  </span>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {info.addresses.map(addr => (
                      <button
                        key={addr}
                        className={`btn btn-sm ${selectedIP === addr ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setSelectedIP(addr)}
                        style={{ fontFamily: 'monospace', fontSize: '13px' }}
                      >
                        {addr}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Advertencia firewall Windows */}
            {isWindows && (
              <div className="card" style={{ borderLeft: '3px solid var(--warning, #f59e0b)' }}>
                <div className="card-body">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--warning, #f59e0b)', fontSize: '22px', flexShrink: 0 }}>security</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '6px' }}>
                        Windows Firewall puede bloquear la conexión
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                        Si el celular no puede conectarse aunque estén en la misma WiFi, el firewall está bloqueando el puerto {info.port}.
                        Hacé click en el botón para agregar la excepción automáticamente (requiere permisos de administrador).
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={handleOpenFirewall}
                          disabled={fwStatus === 'loading'}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                            {fwStatus === 'loading' ? 'autorenew' : 'shield'}
                          </span>
                          {fwStatus === 'loading' ? 'Aplicando...' : 'Abrir puerto en Firewall'}
                        </button>
                        {fwStatus === 'ok' && (
                          <span style={{ color: 'var(--success)', fontSize: '13px', fontWeight: 600 }}>
                            ✓ Regla agregada correctamente
                          </span>
                        )}
                        {fwStatus === 'already' && (
                          <span style={{ color: 'var(--success)', fontSize: '13px', fontWeight: 600 }}>
                            ✓ La regla ya existía
                          </span>
                        )}
                        {fwStatus === 'skipped' && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                            No aplica en este sistema
                          </span>
                        )}
                        {fwStatus === 'error' && (
                          <span style={{ color: 'var(--danger)', fontSize: '13px' }}>
                            No se pudo agregar la regla. Ejecutá la app como Administrador e intentá de nuevo.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* QR + Info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              {/* QR Code */}
              <div className="card" style={{ textAlign: 'center' }}>
                <div className="card-body" style={{ padding: '32px' }}>
                  <div style={{
                    background: '#fff', padding: '20px', borderRadius: 'var(--radius)',
                    display: 'inline-block', marginBottom: '16px',
                  }}>
                    <QRCodeSVG value={activeUrl} size={200} />
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
                        {activeUrl}
                      </code>
                      <button className="btn btn-ghost btn-sm" onClick={() => {
                        navigator.clipboard?.writeText(activeUrl)
                        alert('URL copiada al portapapeles')
                      }} title="Copiar">
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>content_copy</span>
                      </button>
                    </div>
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
          </div>
        )}
      </div>
    </>
  )
}
