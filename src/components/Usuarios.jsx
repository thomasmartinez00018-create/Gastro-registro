import { useState, useEffect } from 'react'
import api from '../api'
import { useAuth } from '../AuthContext'

export default function Usuarios() {
  const { isAdmin } = useAuth()
  const [users, setUsers] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ username: '', display_name: '', password: '', role: 'user' })
  const [error, setError] = useState('')

  const load = async () => {
    const data = await api.users.getAll()
    setUsers(data || [])
  }
  useEffect(() => { load() }, [])

  if (!isAdmin) return (
    <div className="page-body">
      <div className="alert alert-danger">No tenés permisos para acceder a esta sección.</div>
    </div>
  )

  const openNew = () => {
    setEditing(null)
    setForm({ username: '', display_name: '', password: '', role: 'user' })
    setError('')
    setShowModal(true)
  }

  const openEdit = (u) => {
    setEditing(u)
    setForm({ username: u.username, display_name: u.display_name || '', password: '', role: u.role })
    setError('')
    setShowModal(true)
  }

  const handleSave = async () => {
    setError('')
    if (!form.username.trim()) { setError('El usuario es obligatorio'); return }
    if (!editing && !form.password) { setError('La contraseña es obligatoria'); return }

    try {
      if (editing) {
        await api.users.update({ id: editing.id, ...form, password: form.password || undefined })
      } else {
        await api.users.create(form)
      }
      setShowModal(false)
      load()
    } catch (err) {
      setError(err.message || 'Error al guardar')
    }
  }

  const handleDeactivate = async (id) => {
    if (!confirm('¿Desactivar este usuario? No podrá ingresar más.')) return
    try {
      await api.users.delete(id)
      load()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Usuarios</h2>
          <p>Gestionar perfiles de acceso a la aplicación</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>person_add</span>
          Nuevo usuario
        </button>
      </div>

      <div className="page-body">
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="stat-card">
            <div className="stat-number">{users.filter(u => u.active).length}</div>
            <div className="stat-label">Usuarios activos</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{users.filter(u => u.role === 'admin').length}</div>
            <div className="stat-label">Administradores</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{users.length}</div>
            <div className="stat-label">Total registrados</div>
          </div>
        </div>

        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Usuario</th>
                  <th>Nombre</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Creado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                    <td className="font-mono">{u.id}</td>
                    <td style={{ fontWeight: 600 }}>{u.username}</td>
                    <td>{u.display_name || '—'}</td>
                    <td>
                      <span className={`badge ${u.role === 'admin' ? 'badge-amber' : 'badge-blue'}`}>
                        {u.role === 'admin' ? 'Admin' : 'Usuario'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${u.active ? 'badge-green' : 'badge-red'}`}>
                        {u.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="text-muted">{u.created_at?.slice(0, 10) || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="btn btn-ghost btn-xs" onClick={() => openEdit(u)} title="Editar">
                          <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>edit</span>
                        </button>
                        {u.id !== 1 && u.active ? (
                          <button className="btn btn-ghost btn-xs" onClick={() => handleDeactivate(u.id)} title="Desactivar" style={{ color: 'var(--danger)' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>block</span>
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal crear/editar */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing ? 'Editar usuario' : 'Nuevo usuario'}</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="form-group">
                <label className="form-label">Usuario *</label>
                <input className="form-input" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Nombre para mostrar</label>
                <input className="form-input" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">{editing ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña *'}</label>
                <input className="form-input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Rol</label>
                <select className="form-select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="user">Usuario</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave}>
                {editing ? 'Guardar cambios' : 'Crear usuario'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
