import { useState, useEffect } from 'react'
import api from '../api'

const IS_ELECTRON = typeof window !== 'undefined' && !!window.api?.sync

function SyncResult({ result }) {
  if (!result) return null
  return (
    <div style={{
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '1.25rem',
      marginTop: '1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <span className="material-symbols-outlined" style={{ color: 'var(--success)', fontSize: '1.2rem' }}>check_circle</span>
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.875rem' }}>
          Sincronización completada
          {result.source && (
            <span style={{
              marginLeft: '0.5rem',
              background: 'var(--primary-light)',
              color: 'var(--primary)',
              borderRadius: '999px',
              padding: '0.1rem 0.6rem',
              fontSize: '0.7rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>{result.source}</span>
          )}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginBottom: result.errores?.length ? '1rem' : 0 }}>
        {[
          { label: 'Prod. nuevos', value: result.productosInsertados, color: 'var(--success)' },
          { label: 'Prod. actualizados', value: result.productosActualizados, color: 'var(--primary)' },
          { label: 'Prov. nuevos', value: result.proveedoresInsertados, color: 'var(--success)' },
          { label: 'Prov. actualizados', value: result.proveedoresActualizados, color: 'var(--primary)' },
          { label: 'Precios sync', value: result.preciosUpserted, color: 'var(--text)' },
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--surface-3)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.75rem',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color, fontFamily: 'Manrope, sans-serif' }}>
              {s.value ?? 0}
            </div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '0.25rem' }}>
              {s.label}
            </div>
          </div>
        ))}
        {result.errores?.length > 0 && (
          <div style={{
            background: 'var(--danger-light)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.75rem',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--danger)', fontFamily: 'Manrope, sans-serif' }}>
              {result.errores.length}
            </div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '0.25rem' }}>
              Errores
            </div>
          </div>
        )}
      </div>
      {result.errores?.length > 0 && (
        <div style={{
          background: 'var(--danger-light)',
          border: '1px solid rgba(255,180,171,0.2)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.75rem',
          maxHeight: '8rem',
          overflowY: 'auto',
        }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
            Detalle de errores
          </div>
          {result.errores.map((e, i) => (
            <div key={i} style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>{e}</div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Vincular() {
  const [opsUrl, setOpsUrl] = useState(() => localStorage.getItem('vincular_ops_url') || 'http://localhost:3001')
  const [loading, setLoading] = useState(null) // 'push' | 'pull' | 'export' | 'import'
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const saveUrl = (url) => {
    setOpsUrl(url)
    localStorage.setItem('vincular_ops_url', url)
  }

  const clearResult = () => { setResult(null); setError('') }

  const run = async (action, fn) => {
    setLoading(action)
    setResult(null)
    setError('')
    try {
      const res = await fn()
      if (res?.canceled) { /* user cancelled dialog */ }
      else if (!res?.ok) setError(res?.error || 'Error desconocido')
      else setResult(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(null)
    }
  }

  const handleExport = () => run('export', () => window.api.sync.exportJSON())
  const handleImport = () => run('import', () => window.api.sync.importJSON())
  const handlePush   = () => run('push',   () => window.api.sync.pushToOPS(opsUrl))
  const handlePull   = () => run('pull',   () => window.api.sync.pullFromOPS(opsUrl))

  const btnStyle = (variant = 'primary') => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.6rem 1.1rem',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    cursor: loading ? 'not-allowed' : 'pointer',
    fontWeight: 700,
    fontSize: '0.8rem',
    opacity: loading ? 0.6 : 1,
    transition: 'opacity 0.15s',
    ...(variant === 'primary' ? {
      background: 'var(--primary)',
      color: '#111316',
    } : variant === 'outline' ? {
      background: 'transparent',
      color: 'var(--text)',
      border: '1px solid var(--border)',
    } : {
      background: 'var(--surface-3)',
      color: 'var(--text)',
    }),
  })

  const card = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '1.25rem',
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '780px' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '0.25rem' }}>
          Integración
        </div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', fontFamily: 'Manrope, sans-serif', margin: 0 }}>
          Vincular con OPS Terminal
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.3rem' }}>
          Sincronizá el catálogo de productos y proveedores con <strong style={{ color: 'var(--text)' }}>OPS Terminal</strong>.
        </p>
      </div>

      {/* Info banner */}
      <div style={{
        background: 'var(--primary-light)',
        border: '1px solid var(--primary-ring)',
        borderRadius: 'var(--radius)',
        padding: '1rem 1.25rem',
        marginBottom: '1.5rem',
        display: 'flex',
        gap: '0.75rem',
      }}>
        <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '1.2rem', flexShrink: 0, marginTop: '2px' }}>info</span>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text)' }}>¿Cómo funciona?</strong><br />
          Podés sincronizar de dos formas: <strong style={{ color: 'var(--text)' }}>directamente por red</strong> (si ambas apps están corriendo en la misma red)
          o por <strong style={{ color: 'var(--text)' }}>archivo JSON</strong> (exportás desde una app e importás en la otra).
        </div>
      </div>

      {/* Sync por red */}
      {IS_ELECTRON && (
        <div style={{ ...card, marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '1.1rem' }}>wifi</span>
            <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Sincronización por red
            </span>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              URL de OPS Terminal
            </label>
            <input
              type="text"
              value={opsUrl}
              onChange={e => saveUrl(e.target.value)}
              placeholder="http://192.168.1.100:3001"
              style={{
                width: '100%',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text)',
                padding: '0.55rem 0.9rem',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            />
            <p style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: '0.3rem' }}>
              Dejá el puerto predeterminado 3001 si OPS Terminal corre localmente.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button style={btnStyle('primary')} onClick={handlePush} disabled={!!loading}>
              <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>upload</span>
              {loading === 'push' ? 'Enviando...' : 'Enviar a OPS Terminal'}
            </button>
            <button style={btnStyle('secondary')} onClick={handlePull} disabled={!!loading}>
              <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>download</span>
              {loading === 'pull' ? 'Descargando...' : 'Recibir de OPS Terminal'}
            </button>
          </div>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: '0.5rem' }}>
            <strong>Enviar →</strong> manda productos, proveedores y precios de esta app hacia OPS Terminal.<br />
            <strong>Recibir ←</strong> descarga el catálogo de OPS Terminal y lo importa acá.
          </p>
        </div>
      )}

      {/* Sync por archivo */}
      <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '1.1rem' }}>download</span>
            <span style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Exportar</span>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
            Guardá un <code style={{ color: 'var(--primary)' }}>.json</code> con el catálogo de esta app para importar en OPS Terminal.
          </p>
          {IS_ELECTRON ? (
            <button style={btnStyle('outline')} onClick={handleExport} disabled={!!loading}>
              <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>save</span>
              {loading === 'export' ? 'Exportando...' : 'Guardar sync.json'}
            </button>
          ) : (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>Disponible solo en la app de escritorio.</p>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '1.1rem' }}>upload_file</span>
            <span style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Importar</span>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
            Cargá un <code style={{ color: 'var(--primary)' }}>.json</code> exportado desde OPS Terminal para sincronizar acá.
          </p>
          {IS_ELECTRON ? (
            <button style={btnStyle('outline')} onClick={handleImport} disabled={!!loading}>
              <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>folder_open</span>
              {loading === 'import' ? 'Importando...' : 'Seleccionar archivo...'}
            </button>
          ) : (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>Disponible solo en la app de escritorio.</p>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          background: 'var(--danger-light)',
          border: '1px solid rgba(255,180,171,0.25)',
          borderRadius: 'var(--radius)',
          padding: '0.75rem 1rem',
          marginTop: '0.75rem',
        }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--danger)', fontSize: '1.1rem', flexShrink: 0 }}>error</span>
          <span style={{ fontSize: '0.85rem', color: 'var(--danger)', fontWeight: 600 }}>{error}</span>
        </div>
      )}

      {/* Result */}
      <SyncResult result={result} />

      {result && (
        <button
          style={{ ...btnStyle('secondary'), marginTop: '0.75rem', fontSize: '0.75rem' }}
          onClick={clearResult}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>refresh</span>
          Nueva sincronización
        </button>
      )}

      {/* Format info */}
      <div style={{ ...card, marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '1.1rem' }}>bolt</span>
          <span style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Formato de sincronización
          </span>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          El archivo <code style={{ color: 'var(--primary)' }}>.json</code> contiene tres secciones:
        </p>
        {[
          { key: 'productos', desc: 'Maestro de insumos: código, nombre, rubro, unidad' },
          { key: 'proveedores', desc: 'Directorio: código, nombre, contacto, email' },
          { key: 'precios', desc: 'Mapeos producto-proveedor con último precio informado' },
        ].map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
            <span style={{
              background: 'var(--primary-light)',
              color: 'var(--primary)',
              borderRadius: '6px',
              padding: '0.1rem 0.6rem',
              fontSize: '0.7rem',
              fontWeight: 700,
              fontFamily: 'monospace',
              minWidth: '90px',
              textAlign: 'center',
            }}>{s.key}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
