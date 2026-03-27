import { useState, useEffect } from 'react'
import api from '../api'

const EMPTY = { id_proveedor: '', proveedor: '', contacto: '', whatsapp: '', email: '', observaciones: '', activo: 1 }

export default function Proveedores() {
  const [items, setItems] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const load = async () => setItems(await api.proveedores.getAll())
  useEffect(() => { load() }, [])

  const openNew = () => { setForm(EMPTY); setModal('new') }
  const openEdit = (item) => { setForm({ ...item }); setModal('edit') }
  const closeModal = () => { setModal(null); setForm(EMPTY) }

  const handleSave = async () => {
    if (!form.id_proveedor.trim() || !form.proveedor.trim()) return
    setSaving(true)
    try {
      const payload = { ...form, activo: form.activo ? 1 : 0 }
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

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Proveedores</h2>
          <p>Registro de proveedores activos</p>
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
                    <th>ID</th><th>Nombre</th><th>Contacto</th><th>WhatsApp</th><th>Email</th><th>Observaciones</th><th>Estado</th><th></th>
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
                      <td><span className="truncate text-muted" title={item.observaciones}>{item.observaciones || '—'}</span></td>
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

      {modal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className="modal">
            <div className="modal-header">
              <h3>{modal === 'edit' ? 'Editar proveedor' : 'Nuevo proveedor'}</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="form-label">ID Proveedor *</label>
                  <input className="form-input font-mono" placeholder="Ej: PROV001" value={form.id_proveedor}
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
              <div className="form-group">
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
        </div>
      )}
    </>
  )
}
