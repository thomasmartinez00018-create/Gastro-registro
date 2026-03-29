import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import api from '../api'

const EMPTY = {
  id_proveedor: '', proveedor: '', contacto: '', whatsapp: '', email: '',
  observaciones: '', activo: 1,
  descuento_pct: 0, aplica_iva: 0, aplica_percepcion: 0, impuesto_interno: 0,
}

/** Devuelve badges de impuestos/descuento para mostrar en la tabla */
function TaxBadges({ item }) {
  const badges = []
  if (item.descuento_pct > 0)
    badges.push(<span key="desc" className="badge badge-green" title="Descuento">-{item.descuento_pct}%</span>)
  if (item.aplica_iva)
    badges.push(<span key="iva" className="badge badge-blue" title="IVA 21%">IVA 21%</span>)
  if (item.aplica_percepcion)
    badges.push(<span key="perc" className="badge badge-blue" title="Percepción IVA 3%">Perc. 3%</span>)
  if (item.impuesto_interno > 0)
    badges.push(<span key="int" className="badge badge-yellow" title={`Impuesto interno: ${item.impuesto_interno}%`}>Int. {item.impuesto_interno}%</span>)
  return badges.length ? <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>{badges}</div> : <span className="text-muted">—</span>
}

export default function Proveedores() {
  const [items, setItems]   = useState([])
  const [modal, setModal]   = useState(null)
  const [form, setForm]     = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const load = async () => setItems(await api.proveedores.getAll())
  useEffect(() => { load() }, [])

  const openNew  = () => { setForm(EMPTY); setModal('new') }
  const openEdit = (item) => {
    setForm({
      ...EMPTY, // asegura que todos los campos nuevos tengan valor por defecto
      ...item,
      descuento_pct:     item.descuento_pct     ?? 0,
      aplica_iva:        item.aplica_iva        ?? 0,
      aplica_percepcion: item.aplica_percepcion ?? 0,
      impuesto_interno:  item.impuesto_interno  ?? 0,
    })
    setModal('edit')
  }
  const closeModal = () => { setModal(null); setForm(EMPTY) }

  const handleSave = async () => {
    if (!form.id_proveedor.trim() || !form.proveedor.trim()) return
    setSaving(true)
    try {
      const payload = {
        ...form,
        activo:            form.activo ? 1 : 0,
        aplica_iva:        form.aplica_iva ? 1 : 0,
        aplica_percepcion: form.aplica_percepcion ? 1 : 0,
        descuento_pct:     parseFloat(form.descuento_pct) || 0,
        impuesto_interno:  parseFloat(form.impuesto_interno) || 0,
      }
      if (modal === 'edit') await api.proveedores.update(payload)
      else await api.proveedores.create(payload)
      await load(); closeModal()
    } finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este proveedor?')) return
    await api.proveedores.delete(id); await load()
  }

  const filtered = items.filter(i => {
    const q = search.toLowerCase()
    return !q || i.proveedor?.toLowerCase().includes(q) || i.id_proveedor?.toLowerCase().includes(q) || i.contacto?.toLowerCase().includes(q)
  })

  // Costo total efectivo = precio * (1-desc) * (1+iva) * (1+perc) * (1+interno)
  // Solo para mostrar en la tabla como referencia de multiplicador
  const multiplicador = (item) => {
    const desc = 1 - (item.descuento_pct || 0) / 100
    const iva  = 1 + (item.aplica_iva ? 0.21 : 0)
    const perc = 1 + (item.aplica_percepcion ? 0.03 : 0)
    const int_ = 1 + (item.impuesto_interno || 0) / 100
    return desc * iva * perc * int_
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Proveedores</h2>
          <p>Registro de proveedores y condiciones comerciales</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Nuevo proveedor</button>
      </div>
      <div className="page-body">
        <div className="card mb-3">
          <div className="card-body" style={{ padding: '12px 16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div className="search-bar" style={{ flex: 1 }}>
              <input className="form-input" placeholder="Buscar proveedor..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <span className="text-muted">{filtered.length} proveedores</span>
          </div>
        </div>

        <div className="card">
          <div className="table-wrapper">
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="icon">🏢</div>
                <p>{items.length === 0 ? 'No hay proveedores. Hacé clic en "Nuevo proveedor" para empezar.' : 'No se encontraron resultados.'}</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>ID</th><th>Nombre</th><th>Contacto</th><th>WhatsApp</th><th>Email</th>
                    <th>Impuestos / Descuento</th><th>Multiplicador</th><th>Estado</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => (
                    <tr key={item.id}>
                      <td><span className="font-mono badge badge-blue">{item.id_proveedor}</span></td>
                      <td style={{ fontWeight: 600 }}>{item.proveedor}</td>
                      <td>{item.contacto || '—'}</td>
                      <td>{item.whatsapp || '—'}</td>
                      <td>{item.email || '—'}</td>
                      <td><TaxBadges item={item} /></td>
                      <td>
                        {multiplicador(item) !== 1
                          ? <span style={{ fontWeight: 700, color: multiplicador(item) > 1 ? '#dc2626' : '#16a34a' }}>
                              x{multiplicador(item).toFixed(3)}
                            </span>
                          : <span className="text-muted">x1.000</span>
                        }
                      </td>
                      <td><span className={`badge ${item.activo ? 'badge-green' : 'badge-gray'}`}>{item.activo ? 'Activo' : 'Inactivo'}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(item)}>✏️</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(item.id)}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {modal && createPortal(
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}
          onKeyDown={e => e.key === 'Escape' && closeModal()}>
          <div className="modal modal-lg" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>{modal === 'edit' ? 'Editar proveedor' : 'Nuevo proveedor'}</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
            </div>
            <div className="modal-body">

              {/* ── Datos básicos ── */}
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="form-label">ID Proveedor *</label>
                  <input className="form-input font-mono" placeholder="Ej: PROV001" value={form.id_proveedor}
                    autoFocus
                    onChange={e => setForm(f => ({ ...f, id_proveedor: e.target.value.toUpperCase() }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nombre *</label>
                  <input className="form-input" placeholder="Nombre del proveedor" value={form.proveedor}
                    onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))} />
                </div>
              </div>
              <div className="form-row form-row-3">
                <div className="form-group">
                  <label className="form-label">Contacto</label>
                  <input className="form-input" placeholder="Nombre" value={form.contacto || ''}
                    onChange={e => setForm(f => ({ ...f, contacto: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">WhatsApp</label>
                  <input className="form-input" placeholder="Número" value={form.whatsapp || ''}
                    onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" placeholder="email@..." value={form.email || ''}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Observaciones</label>
                <textarea className="form-textarea" placeholder="Notas sobre este proveedor" value={form.observaciones || ''}
                  onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))} />
              </div>

              {/* ── Condiciones comerciales ── */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '4px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '12px' }}>
                  💰 Condiciones comerciales
                </div>

                {/* Descuento */}
                <div className="form-group">
                  <label className="form-label">Descuento del proveedor</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      className="form-input"
                      type="number" min="0" max="100" step="0.5"
                      style={{ width: '100px' }}
                      placeholder="0"
                      value={form.descuento_pct || ''}
                      onChange={e => setForm(f => ({ ...f, descuento_pct: e.target.value }))}
                    />
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>% — Se descuenta del precio de lista antes de aplicar impuestos</span>
                  </div>
                </div>

                {/* Impuestos */}
                <div className="form-label" style={{ marginBottom: '8px' }}>Impuestos que aplican sobre este proveedor</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--surface-2)', borderRadius: '8px', padding: '12px 14px' }}>

                  {/* IVA */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!form.aplica_iva}
                      onChange={e => setForm(f => ({ ...f, aplica_iva: e.target.checked ? 1 : 0 }))}
                      style={{ width: '16px', height: '16px', accentColor: 'var(--primary)' }}
                    />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>IVA <span className="badge badge-blue">21%</span></div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Impuesto al Valor Agregado — aplica sobre el precio neto</div>
                    </div>
                  </label>

                  {/* Percepción IVA */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', borderTop: '1px solid var(--border-light)', paddingTop: '10px' }}>
                    <input
                      type="checkbox"
                      checked={!!form.aplica_percepcion}
                      onChange={e => setForm(f => ({ ...f, aplica_percepcion: e.target.checked ? 1 : 0 }))}
                      style={{ width: '16px', height: '16px', accentColor: 'var(--primary)' }}
                    />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>Percepción de IVA <span className="badge badge-blue">3%</span></div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Percepción adicional — aplica sobre el precio neto</div>
                    </div>
                  </label>

                  {/* Impuesto interno variable */}
                  <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '16px', height: '16px' }} /> {/* spacer */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                          Impuesto interno <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(variable)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            className="form-input"
                            type="number" min="0" max="100" step="0.5"
                            style={{ width: '90px' }}
                            placeholder="0"
                            value={form.impuesto_interno || ''}
                            onChange={e => setForm(f => ({ ...f, impuesto_interno: e.target.value }))}
                          />
                          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>% — Dejá en 0 si no aplica</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Preview del multiplicador */}
                {(() => {
                  const desc = 1 - (parseFloat(form.descuento_pct) || 0) / 100
                  const iva  = 1 + (form.aplica_iva ? 0.21 : 0)
                  const perc = 1 + (form.aplica_percepcion ? 0.03 : 0)
                  const int_ = 1 + (parseFloat(form.impuesto_interno) || 0) / 100
                  const mult = desc * iva * perc * int_
                  const diff = ((mult - 1) * 100).toFixed(1)
                  const color = mult > 1 ? '#dc2626' : mult < 1 ? '#16a34a' : 'var(--text-muted)'
                  return (
                    <div style={{ marginTop: '12px', padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Multiplicador de precio efectivo:</span>
                      <span style={{ fontWeight: 800, fontSize: '18px', color, fontFamily: 'monospace' }}>
                        x{mult.toFixed(4)}
                      </span>
                      <span style={{ fontSize: '12px', color }}>
                        {diff > 0 ? `+${diff}%` : diff < 0 ? `${diff}%` : 'sin variación'} respecto al precio de lista
                      </span>
                    </div>
                  )
                })()}
              </div>

              <div className="form-group" style={{ marginTop: '14px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!form.activo} onChange={e => setForm(f => ({ ...f, activo: e.target.checked ? 1 : 0 }))} />
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>Proveedor activo</span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeModal}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.id_proveedor || !form.proveedor}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
