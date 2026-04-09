import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import api from '../api'

export default function AccesoRed() {
  const [info, setInfo]               = useState(null)
  const [loading, setLoading]         = useState(true)
  const [selectedIP, setSelectedIP]   = useState(null)
  const [fwStatus, setFwStatus]       = useState(null)   // null | object
  const [fwLoading, setFwLoading]     = useState(false)
  const [troubleOpen, setTroubleOpen] = useState(false)
  const [pingStatus, setPingStatus]   = useState(null)   // null | 'testing' | 'ok' | 'fail' | 'partial'
  const [pingDetail, setPingDetail]   = useState(null)
  const [recentReqs, setRecentReqs]   = useState([])
  const isWindows                     = navigator.userAgent.includes('Windows')

  useEffect(() => {
    if (!api.network?.getInfo) { setLoading(false); return }
    api.network.getInfo().then(data => {
      setInfo(data)
      setSelectedIP(data?.addresses?.[0] ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))

    // Cargar estado del firewall si ya se corrió al arrancar
    if (api.network?.firewallStatus) {
      api.network.firewallStatus().then(status => {
        if (status) setFwStatus(status)
      }).catch(() => {})
    }
  }, [])

  const activeUrl = info && selectedIP ? `http://${selectedIP}:${info.port}` : info?.url
  const fwOk = fwStatus?.ok === true

  async function tryFetch(url, timeoutMs = 4000) {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(url, { signal: controller.signal, mode: 'cors', cache: 'no-store' })
      clearTimeout(t)
      if (res.ok) return { ok: true, status: res.status }
      return { ok: false, error: `HTTP ${res.status}` }
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, error: 'Timeout (4s)' }
      return { ok: false, error: err.message }
    }
  }

  async function handlePingTest() {
    if (!info?.port) {
      setPingStatus('fail')
      setPingDetail('No hay puerto asignado — el servidor Express no arrancó. Reiniciá la app.')
      return
    }
    setPingStatus('testing')
    setPingDetail(null)

    const port = info.port
    // Paso 1: verificación desde MAIN PROCESS (TCP+HTTP interno, inmune a CORS/CSP/IPv6)
    let mainVerify = null
    if (api.network?.verifyServer) {
      try { mainVerify = await api.network.verifyServer() } catch (e) { mainVerify = { ok: false, error: e.message } }
    }

    // Paso 2: desde el renderer, usando 127.0.0.1 explícito (evita el bug IPv6 de Windows/Node 18+)
    const t1 = await tryFetch(`http://127.0.0.1:${port}/ping`)
    // Paso 3: desde el renderer, usando la IP LAN (prueba el camino completo)
    const t2 = selectedIP ? await tryFetch(`http://${selectedIP}:${port}/ping`) : { ok: false, error: 'Sin IP seleccionada' }

    // Análisis de resultados
    if (mainVerify && !mainVerify.ok) {
      setPingStatus('fail')
      setPingDetail(`SERVIDOR NO ACTIVO. Verificación interna falló: ${mainVerify.error}. El server Express no está escuchando. Reiniciá la app. Si persiste, otro programa está usando el puerto ${port} o falló el arranque del server.`)
    } else if (t1.ok && t2.ok) {
      setPingStatus('ok')
      setPingDetail(`Todo OK. Server responde en 127.0.0.1 y en ${selectedIP}. Si el celular no conecta: verificá que esté en la MISMA WiFi (misma subred). Tu IP: ${selectedIP} — la del celular debe empezar igual.`)
    } else if (t1.ok && !t2.ok) {
      setPingStatus('partial')
      setPingDetail(`Server responde localmente (127.0.0.1) pero NO por la IP LAN ${selectedIP}. Error: ${t2.error}. Causa: Firewall bloqueando conexiones entrantes. Abrí el puerto en Firewall arriba, o ejecutá la app como Administrador (click derecho > Ejecutar como administrador).`)
    } else if (!t1.ok && mainVerify?.ok) {
      // Main process verifica OK pero renderer fetch falla → CORS/CSP/extensión
      setPingStatus('partial')
      setPingDetail(`Inconsistencia: el main process verifica OK pero el fetch del renderer falla (${t1.error}). Causa probable: antivirus interceptando loopback o extensión de navegador. Probá desactivar temporalmente el antivirus.`)
    } else {
      setPingStatus('fail')
      setPingDetail(`Ambos tests fallaron. Verificación interna: ${mainVerify?.error || 'N/A'}. Fetch 127.0.0.1: ${t1.error}. Fetch IP LAN: ${t2.error}. Reiniciá la app. Si persiste, algún antivirus está bloqueando.`)
    }

    // Actualizar log de peticiones recientes
    if (api.network?.recentRequests) {
      try {
        const reqs = await api.network.recentRequests()
        setRecentReqs(reqs || [])
      } catch {}
    }
  }

  async function handleOpenFirewall() {
    if (!api.network?.openFirewall) return
    setFwLoading(true)
    try {
      const res = await api.network.openFirewall()
      setFwStatus(res)
    } catch {
      setFwStatus({ ok: false, error: 'Error inesperado' })
    }
    setFwLoading(false)
  }

  if (!window.api) return (
    <div className="page-body">
      <div className="alert alert-info">Esta funcion solo esta disponible en la app de escritorio.</div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="alert alert-warning">
              <strong>No se pudo determinar la IP LAN automaticamente.</strong><br/>
              Estado del servidor: <strong>{info?.serverRunning ? 'activo' : 'NO activo'}</strong> · Puerto: <strong>{info?.port || 'N/A'}</strong>
            </div>

            {/* Mostrar TODAS las interfaces raw como fallback */}
            {info?.allInterfaces?.length > 0 && (
              <div className="card">
                <div className="card-header"><h3>Interfaces de red detectadas</h3></div>
                <div className="card-body">
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                    Elegi manualmente la IP que corresponde a tu WiFi/Ethernet:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {info.allInterfaces.map((iface, i) => {
                      const scored = info.scoredCandidates?.find(c => c.address === iface.address && c.iface === iface.iface)
                      return (
                        <button
                          key={i}
                          className="btn btn-ghost"
                          onClick={() => {
                            setSelectedIP(iface.address)
                            // Forzar que info tenga url usando esta IP
                            setInfo({ ...info, url: `http://${iface.address}:${info.port}`, addresses: [iface.address, ...(info.addresses || [])] })
                          }}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '10px 14px', textAlign: 'left',
                          }}
                        >
                          <div>
                            <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '14px' }}>{iface.address}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{iface.iface}</div>
                          </div>
                          {scored && (
                            <span style={{
                              fontSize: '10px', padding: '2px 8px', borderRadius: '10px',
                              background: scored.score >= 10 ? 'var(--success)' : scored.score >= 0 ? 'var(--warning, #f59e0b)' : 'var(--danger)',
                              color: '#000', fontWeight: 700,
                            }}>
                              score {scored.score}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-light)', marginTop: '12px' }}>
                    La IP correcta suele empezar con <strong>192.168.</strong> · <strong>10.</strong> · o <strong>172.16-31.</strong>
                  </div>
                </div>
              </div>
            )}

            {(!info?.allInterfaces || info.allInterfaces.length === 0) && (
              <div className="alert alert-danger">
                No se detectaron interfaces de red en absoluto. Verifica que estes conectado a WiFi o cable Ethernet.
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '820px' }}>

            {/* Estado del firewall en Windows */}
            {isWindows && (
              <div className="card" style={{ borderLeft: `3px solid ${fwOk ? 'var(--success)' : 'var(--warning, #f59e0b)'}` }}>
                <div className="card-body">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <span className="material-symbols-outlined" style={{
                      color: fwOk ? 'var(--success)' : 'var(--warning, #f59e0b)',
                      fontSize: '22px', flexShrink: 0
                    }}>
                      {fwOk ? 'verified_user' : 'security'}
                    </span>
                    <div style={{ flex: 1 }}>
                      {fwOk ? (
                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--success)' }}>
                          Firewall configurado correctamente - Puerto {info.port} abierto
                        </div>
                      ) : (
                        <>
                          <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '6px' }}>
                            Windows Firewall - Puerto {info.port}
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                            Para que los celulares puedan conectarse, el puerto {info.port} debe estar abierto en el firewall.
                            Hace click en el boton para configurarlo automaticamente (Windows te va a pedir permiso de administrador).
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={handleOpenFirewall}
                              disabled={fwLoading}
                              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                            >
                              <span className="material-symbols-outlined" style={{
                                fontSize: '16px',
                                animation: fwLoading ? 'spin 1s linear infinite' : 'none'
                              }}>
                                {fwLoading ? 'autorenew' : 'shield'}
                              </span>
                              {fwLoading ? 'Configurando...' : 'Abrir puerto en Firewall'}
                            </button>

                            {fwStatus && !fwStatus.ok && (
                              <span style={{ color: 'var(--danger)', fontSize: '12px' }}>
                                No se pudo abrir. Proba ejecutando la app como Administrador (click derecho &gt; Ejecutar como administrador).
                              </span>
                            )}
                            {fwStatus?.already && (
                              <span style={{ color: 'var(--success)', fontSize: '13px', fontWeight: 600 }}>
                                La regla ya existe
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Test de conectividad */}
            <div className="card" style={{
              borderLeft: `3px solid ${
                pingStatus === 'ok' ? 'var(--success)' :
                pingStatus === 'partial' ? 'var(--warning, #f59e0b)' :
                pingStatus === 'fail' ? 'var(--danger)' : 'var(--border)'
              }`
            }}>
              <div className="card-body">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                  <span className="material-symbols-outlined" style={{
                    fontSize: '22px', flexShrink: 0,
                    color: pingStatus === 'ok' ? 'var(--success)' :
                           pingStatus === 'partial' ? 'var(--warning, #f59e0b)' :
                           pingStatus === 'fail' ? 'var(--danger)' : 'var(--text-muted)'
                  }}>
                    {pingStatus === 'ok' ? 'check_circle' :
                     pingStatus === 'partial' ? 'warning' :
                     pingStatus === 'fail' ? 'error' : 'network_check'}
                  </span>
                  <div style={{ flex: 1, minWidth: '250px' }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: pingDetail ? '4px' : 0 }}>
                      {pingStatus === 'testing' ? 'Probando conexion...' :
                       pingStatus === 'ok' ? 'Todo funciona correctamente' :
                       pingStatus === 'partial' ? 'Funciona local pero no en LAN' :
                       pingStatus === 'fail' ? 'El servidor no responde' :
                       'Diagnostico de conexion'}
                    </div>
                    {pingDetail && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        {pingDetail}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={handlePingTest}
                    disabled={pingStatus === 'testing'}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}
                  >
                    <span className="material-symbols-outlined" style={{
                      fontSize: '16px',
                      animation: pingStatus === 'testing' ? 'spin 1s linear infinite' : 'none'
                    }}>
                      {pingStatus === 'testing' ? 'autorenew' : 'play_arrow'}
                    </span>
                    {pingStatus ? 'Probar de nuevo' : 'Probar ahora'}
                  </button>
                </div>

                {/* Log de peticiones recibidas — clave para diagnosticar celular */}
                {pingStatus && (
                  <div style={{
                    marginTop: '14px',
                    background: 'var(--surface-2)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 12px',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    maxHeight: '160px',
                    overflowY: 'auto',
                  }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', fontFamily: 'inherit' }}>
                      ULTIMAS PETICIONES AL SERVIDOR ({recentReqs.length})
                    </div>
                    {recentReqs.length === 0 ? (
                      <div style={{ color: 'var(--text-light)' }}>— Ninguna petición registrada —</div>
                    ) : (
                      recentReqs.map((r, i) => (
                        <div key={i} style={{ marginBottom: '3px' }}>
                          <span style={{ color: 'var(--text-light)' }}>{new Date(r.time).toLocaleTimeString()}</span>
                          {' · '}
                          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{r.ip}</span>
                          {' '}
                          <span>{r.path}</span>
                        </div>
                      ))
                    )}
                    <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-light)', fontFamily: 'inherit' }}>
                      Si el celular no aparece acá, la peticion nunca llega al servidor (firewall o red diferente).
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Selector de IP si hay multiples */}
            {info.addresses.length > 1 && (
              <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--accent)', fontSize: '20px' }}>device_hub</span>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>
                    Se detectaron {info.addresses.length} conexiones de red. Elegi la que comparte WiFi con el celular:
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
                    Escanea con la camara del celular
                  </p>
                  <p style={{
                    fontSize: '11px', color: 'var(--accent)', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '.08em',
                  }}>Sin instalar nada</p>
                </div>
              </div>

              {/* Info + URL */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Status — refleja estado REAL del server */}
                <div className="card">
                  <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '10px', height: '10px', borderRadius: '50%',
                      background: info.serverRunning ? 'var(--success)' : 'var(--danger)',
                      boxShadow: `0 0 8px ${info.serverRunning ? 'var(--success)' : 'var(--danger)'}`,
                      animation: 'pulse-dot 2s ease-in-out infinite',
                    }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px' }}>
                        {info.serverRunning ? 'Servidor activo en la red' : 'Servidor NO activo'}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {info.port ? `Puerto ${info.port}` : 'Sin puerto asignado'}
                      </div>
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
                  <div className="card-header"><h3>Como conectarse</h3></div>
                  <div className="card-body">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {[
                        { num: 1, icon: 'wifi', text: 'Conecta el celular a la misma red WiFi que esta PC' },
                        { num: 2, icon: 'qr_code_scanner', text: 'Escanea el QR o abri el link en el navegador' },
                        { num: 3, icon: 'login', text: 'Ingresa con tu usuario y contrasena' },
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

            {/* Troubleshooting */}
            <div className="card">
              <div
                className="card-header"
                onClick={() => setTroubleOpen(v => !v)}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>help</span>
                  No funciona? Soluciones
                </h3>
                <span className="material-symbols-outlined" style={{ fontSize: '18px', transition: 'transform .2s', transform: troubleOpen ? 'rotate(180deg)' : 'none' }}>
                  expand_more
                </span>
              </div>
              {troubleOpen && (
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Problema 1 */}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px', color: 'var(--text)' }}>
                      1. "El servidor no responde" o "No se puede acceder"
                    </div>
                    <ul style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, paddingLeft: '18px' }}>
                      <li>Verifica que el celular y la PC esten en la <strong>misma red WiFi</strong></li>
                      <li>Si usas Windows: hace click en "Abrir puerto en Firewall" arriba</li>
                      <li>Si el boton falla: abre la app haciendo <strong>click derecho &gt; Ejecutar como administrador</strong></li>
                      <li>Como ultimo recurso, abri el Firewall de Windows manualmente:<br/>
                        <code style={{ fontSize: '11px', background: 'var(--surface-2)', padding: '2px 6px', borderRadius: '3px' }}>
                          Panel de control &gt; Firewall &gt; Permitir una app &gt; Gastronomic OS
                        </code>
                      </li>
                    </ul>
                  </div>

                  {/* Problema 2 */}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px', color: 'var(--text)' }}>
                      2. Escaneo el QR pero no abre nada
                    </div>
                    <ul style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, paddingLeft: '18px' }}>
                      <li>Escanea con la <strong>app de Camara</strong> nativa (no una app de QR)</li>
                      <li>Si no aparece el link, copia la URL y pegala en el navegador del celular</li>
                    </ul>
                  </div>

                  {/* Problema 3 */}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px', color: 'var(--text)' }}>
                      3. La IP parece incorrecta
                    </div>
                    <ul style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, paddingLeft: '18px' }}>
                      <li>Si tenes varias conexiones de red, proba con cada una de las IPs de arriba</li>
                      <li>La IP correcta suele empezar con <strong>192.168.</strong> y es la del WiFi de esta PC</li>
                      <li>Podes verificar la IP de esta PC con: <code style={{ fontSize: '11px', background: 'var(--surface-2)', padding: '2px 6px', borderRadius: '3px' }}>ipconfig</code> en CMD</li>
                    </ul>
                  </div>

                  {/* Problema 4 */}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px', color: 'var(--text)' }}>
                      4. Carga pero aparece pantalla en blanco
                    </div>
                    <ul style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, paddingLeft: '18px' }}>
                      <li>Espera unos segundos - la primera carga puede demorar</li>
                      <li>Verifica que la URL incluya el puerto: <strong>{activeUrl}</strong></li>
                      <li>Proba abrirlo en <strong>Chrome</strong> en vez de Safari</li>
                    </ul>
                  </div>

                  {/* Problema 5 - Antivirus */}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px', color: 'var(--text)' }}>
                      5. Tengo antivirus (Avast, Norton, Kaspersky, etc.)
                    </div>
                    <ul style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, paddingLeft: '18px' }}>
                      <li>Algunos antivirus tienen su <strong>propio firewall</strong> que bloquea puertos</li>
                      <li>Agrega una excepcion para el puerto <strong>{info.port}</strong> en la config del antivirus</li>
                      <li>O desactiva temporalmente el firewall del antivirus para probar</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
