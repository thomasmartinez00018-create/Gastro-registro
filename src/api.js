// api.js — single entry point for all data operations
// Three-way adapter: Electron IPC → HTTP fetch → browserDB (dev fallback)

import { browserDB } from './browserDB'

// Detectar entorno
const IS_ELECTRON = typeof window !== 'undefined' && !!window.api

// ── HTTP adapter para clientes LAN (browser sin Electron) ─────────────────
function buildHttpApi() {
  const BASE = '' // mismo origen

  function getToken() {
    return localStorage.getItem('auth_token')
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' }
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`

    const opts = { method, headers }
    if (body !== undefined) opts.body = JSON.stringify(body)

    const res = await fetch(`${BASE}/api${path}`, opts)

    // Token inválido → redirigir a login
    if (res.status === 401) {
      localStorage.removeItem('auth_token')
      window.location.reload()
      throw new Error('Sesión expirada')
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || res.statusText)
    }
    return res.json()
  }

  return {
    productos: {
      getAll: ()   => request('GET', '/productos'),
      create: (p)  => request('POST', '/productos', p),
      update: (p)  => request('PUT', `/productos/${p.id}`, p),
      delete: (id) => request('DELETE', `/productos/${id}`),
    },
    proveedores: {
      getAll: ()   => request('GET', '/proveedores'),
      create: (p)  => request('POST', '/proveedores', p),
      update: (p)  => request('PUT', `/proveedores/${p.id}`, p),
      delete: (id) => request('DELETE', `/proveedores/${id}`),
    },
    listas: {
      getAll: ()            => request('GET', '/listas'),
      insertMany: (rows)    => request('POST', '/listas/batch', rows),
      updateMatch: (data)   => request('PUT', `/listas/${data.id}/match`, data),
      delete: (id)          => request('DELETE', `/listas/${id}`),
      deleteByProveedor: (id) => request('DELETE', `/listas/proveedor/${id}`),
      archiveByProveedor:(id) => request('POST', `/listas/proveedor/${id}/archive`),
    },
    equivalencias: {
      getAll: ()   => request('GET', '/equivalencias'),
      create: (e)  => request('POST', '/equivalencias', e),
      delete: (id) => request('DELETE', `/equivalencias/${id}`),
    },
    comparador: {
      getComparativa: (filtros) => request('POST', '/comparador', filtros),
      exportarSeleccion: () => { alert('Solo disponible en la app de escritorio'); return null },
      exportarLista: () => { alert('Solo disponible en la app de escritorio'); return null },
    },
    pedidos: {
      getAll: ()                     => request('GET', '/pedidos'),
      create: (data)                 => request('POST', '/pedidos', data),
      updateEstado: ({ id, estado }) => request('PUT', `/pedidos/${id}/estado`, { estado }),
      delete: (id)                   => request('DELETE', `/pedidos/${id}`),
    },
    auth: {
      login:    (data)  => request('POST', '/auth/login', data),
      validate: (token) => request('POST', '/auth/validate', { token }),
      logout:   ()      => Promise.resolve({ ok: true }),
    },
    users: {
      getAll: ()     => request('GET', '/users'),
      create: (data) => request('POST', '/users', data),
      update: (data) => request('PUT', `/users/${data.id}`, data),
      delete: (id)   => request('DELETE', `/users/${id}`),
    },
    network: {
      getInfo: () => Promise.resolve({ addresses: [], port: null, url: null }),
    },
    // Desktop-only — disabled on LAN
    dialog: {
      openFile: () => { alert('Solo disponible en la app de escritorio'); return null },
      saveFile: () => { alert('Solo disponible en la app de escritorio'); return null },
    },
    file: {
      readExcel: () => { alert('Solo disponible en la app de escritorio'); return null },
    },
    license: {
      check: () => Promise.resolve({ activated: true }),
      activate: () => Promise.resolve({ ok: true }),
      deactivate: () => Promise.resolve({ ok: true }),
      generate: () => null,
    },
    maxirest: {
      parseInsumos: () => { alert('Solo disponible en la app de escritorio'); return null },
      importarInsumos: () => { alert('Solo disponible en la app de escritorio'); return null },
      exportarComparativa: () => { alert('Solo disponible en la app de escritorio'); return null },
    },
    sync: {
      exportJSON: () => { alert('Solo disponible en la app de escritorio'); return null },
      importJSON: () => { alert('Solo disponible en la app de escritorio'); return null },
      pushToOPS: () => { alert('Solo disponible en la app de escritorio'); return null },
      pullFromOPS: () => { alert('Solo disponible en la app de escritorio'); return null },
    },
    backup: {
      export: () => { alert('Solo disponible en la app de escritorio'); return null },
      restore: () => { alert('Solo disponible en la app de escritorio'); return null },
    },
    app: {
      setZoom: () => {},
    },
  }
}

// ── Selección del adapter ─────────────────────────────────────────────────
let api

// Detectar si estamos en Vite dev mode (HMR activo) vs LAN real (served por Express)
const IS_VITE_DEV = import.meta.env?.DEV

if (IS_ELECTRON) {
  api = window.api
} else if (typeof window !== 'undefined' && window.location.protocol.startsWith('http') && !IS_VITE_DEV) {
  // Running in browser via LAN server (production Express)
  api = buildHttpApi()
} else {
  // Dev fallback (Vite dev server) — usa browserDB con auth local
  api = browserDB
}

export default api
