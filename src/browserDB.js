// browserDB.js — localStorage-based storage that mirrors window.api exactly
// Used when running in the browser (preview/dev without Electron)
import * as XLSX from 'xlsx'

const get = (key) => JSON.parse(localStorage.getItem(key) || '[]')
const set = (key, val) => localStorage.setItem(key, JSON.stringify(val))
const nextId = (items) => (items.reduce((max, i) => Math.max(max, i.id || 0), 0) + 1)

// ── File picker helpers ───────────────────────────────────────────────────────
let _selectedFile = null

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept || '.xlsx,.xls'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = () => {
      _selectedFile = input.files?.[0] || null
      document.body.removeChild(input)
      resolve(_selectedFile ? _selectedFile.name : null)
    }
    input.addEventListener('cancel', () => {
      document.body.removeChild(input)
      resolve(null)
    })
    input.click()
  })
}

function readFileBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

async function parseExcelSheets(file) {
  const buf = await readFileBuffer(file)
  const wb = XLSX.read(buf, { type: 'array' })
  const result = {}
  for (const sheetName of wb.SheetNames) {
    result[sheetName] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' })
  }
  return result
}

// ── Productos ────────────────────────────────────────────────────────────────
const productos = {
  getAll: async () => get('productos').sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || a.producto.localeCompare(b.producto)),
  create: async (p) => {
    const items = get('productos')
    const item = { ...p, id: nextId(items), created_at: new Date().toISOString() }
    set('productos', [...items, item])
    return item
  },
  update: async (p) => {
    set('productos', get('productos').map(i => i.id === p.id ? { ...i, ...p } : i))
    return p
  },
  delete: async (id) => {
    set('productos', get('productos').filter(i => i.id !== id))
    return true
  },
}

// ── Proveedores ──────────────────────────────────────────────────────────────
const proveedores = {
  getAll: async () => get('proveedores').sort((a, b) => a.proveedor.localeCompare(b.proveedor)),
  create: async (p) => {
    const items = get('proveedores')
    const item = { ...p, id: nextId(items), created_at: new Date().toISOString() }
    set('proveedores', [...items, item])
    return item
  },
  update: async (p) => {
    set('proveedores', get('proveedores').map(i => i.id === p.id ? { ...i, ...p } : i))
    return p
  },
  delete: async (id) => {
    set('proveedores', get('proveedores').filter(i => i.id !== id))
    return true
  },
}

// ── Listas ───────────────────────────────────────────────────────────────────
const listas = {
  getAll: async () => get('listas').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
  insertMany: async (rows) => {
    const items = get('listas')
    let id = nextId(items)
    const newRows = rows.map(r => ({ ...r, id: id++, created_at: new Date().toISOString() }))
    set('listas', [...items, ...newRows])
    return true
  },
  updateMatch: async ({ id, codigo_producto, estado_match }) => {
    const items = get('listas')
    const lista = items.find(i => i.id === id)
    if (!lista) return false
    let precio_por_unidad = lista.precio_informado
    if (lista.tipo_compra === 'CAJA') precio_por_unidad = lista.precio_informado / (lista.unidades_por_caja || 1)
    const precio_por_medida_base = lista.cantidad_por_unidad > 0 ? precio_por_unidad / lista.cantidad_por_unidad : null
    set('listas', items.map(i => i.id === id ? { ...i, codigo_producto, estado_match, precio_por_unidad, precio_por_medida_base } : i))
    return true
  },
  delete: async (id) => {
    set('listas', get('listas').filter(i => i.id !== id))
    return true
  },
  deleteByProveedor: async (id_proveedor) => {
    set('listas', get('listas').filter(i => i.id_proveedor !== id_proveedor))
    return true
  },
  // Feature 3: mark all existing rows for this proveedor as inactive (activo=0)
  archiveByProveedor: async (id_proveedor) => {
    set('listas', get('listas').map(i => i.id_proveedor === id_proveedor ? { ...i, activo: 0 } : i))
    return true
  },
}

// ── Equivalencias ─────────────────────────────────────────────────────────────
const equivalencias = {
  getAll: async () => get('equivalencias').sort((a, b) => (a.id_proveedor || '').localeCompare(b.id_proveedor || '')),
  create: async (e) => {
    const items = get('equivalencias')
    const item = { ...e, id: nextId(items), created_at: new Date().toISOString() }
    set('equivalencias', [...items, item])
    return item
  },
  delete: async (id) => {
    set('equivalencias', get('equivalencias').filter(i => i.id !== id))
    return true
  },
}

// ── Comparador ────────────────────────────────────────────────────────────────
const comparador = {
  getComparativa: async (filtros) => {
    const allListas = get('listas').filter(l => l.codigo_producto && l.estado_match === 'OK')
    const allProductos = get('productos')
    const prodMap = {}
    allProductos.forEach(p => { prodMap[p.codigo] = p })

    let rows = allListas.map(l => {
      const p = prodMap[l.codigo_producto]
      return {
        codigo_producto: l.codigo_producto,
        producto_estandar: p?.producto || l.codigo_producto,
        categoria: p?.categoria || '',
        unidad_medida: p?.unidad_medida || '',
        id_proveedor: l.id_proveedor,
        proveedor: l.proveedor,
        fecha: l.fecha,
        producto_original: l.producto_original,
        presentacion_original: l.presentacion_original,
        tipo_compra: l.tipo_compra,
        cantidad_por_unidad: l.cantidad_por_unidad,
        precio_informado: l.precio_informado,
        precio_por_unidad: l.precio_por_unidad,
        precio_por_medida_base: l.precio_por_medida_base,
      }
    })

    if (filtros?.categoria) rows = rows.filter(r => r.categoria === filtros.categoria)
    if (filtros?.codigo) rows = rows.filter(r => r.codigo_producto === filtros.codigo)
    return rows.sort((a, b) => (a.codigo_producto || '').localeCompare(b.codigo_producto || '') || (a.precio_por_medida_base || 0) - (b.precio_por_medida_base || 0))
  },
}

// ── Maxirest ──────────────────────────────────────────────────────────────────
const UNIT_MAP = {
  'kilo': 'kg', 'kilos': 'kg', 'kg': 'kg', 'kgr': 'kg', 'kgs': 'kg',
  'litro': 'litro', 'litros': 'litro', 'lt': 'litro', 'lts': 'litro', 'ltr': 'litro',
  'uni': 'unidad', 'unid': 'unidad', 'unida': 'unidad', 'unidad': 'unidad', 'und': 'unidad',
  'unidades': 'unidad', 'u': 'unidad',
  'balde': 'balde', 'bald': 'balde',
  'caja': 'caja', 'cajon': 'caja', 'caj': 'caja',
  'bolsa': 'bolsa', 'bols': 'bolsa',
  'lata': 'lata', 'lat': 'lata',
  'bidon': 'bidon', 'bid': 'bidon',
  'bulto': 'bulto', 'bult': 'bulto',
  'pack': 'pack', 'paq': 'pack', 'paquete': 'pack',
  'gramo': 'gramo', 'gr': 'gramo', 'grs': 'gramo', 'gm': 'gramo',
  'doc': 'docena', 'docena': 'docena',
  'rollo': 'rollo', 'roll': 'rollo',
  'ml': 'ml', 'cc': 'ml',
}
function normalizeUnit(u) {
  if (!u) return ''
  return UNIT_MAP[u.trim().toLowerCase()] || u.trim().toLowerCase()
}

const maxirest = {
  parseInsumos: async () => {
    if (!_selectedFile) return { unicos: [], duplicados: [], total: 0 }
    try {
      const buf = await readFileBuffer(_selectedFile)
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' })

      const rows = raw
        .filter(r => r.NOMBRE && String(r.NOMBRE).trim())
        .map(r => ({
          cod_rui: String(r.COD_RUI || '').trim(),
          codigo_maxirest: String(r.CODIGO || '').trim(),
          nombre: String(r.NOMBRE || '').trim(),
          nombre_norm: String(r.NOMBRE || '').trim().toUpperCase().replace(/\s+/g, ' '),
          unidad_raw: String(r.UNIDAD_MED || '').trim(),
          unidad_norm: normalizeUnit(String(r.UNIDAD_MED || '').trim()),
          precio: parseFloat(String(r.PRECIO || '0').replace(',', '.')) || 0,
          ult_compra: r.ULT_COMPRA ? String(r.ULT_COMPRA) : null,
        }))

      // Group by normalized name to detect duplicates
      const groups = {}
      rows.forEach(r => {
        if (!groups[r.nombre_norm]) groups[r.nombre_norm] = []
        groups[r.nombre_norm].push(r)
      })

      const unicos = []
      const duplicados = []
      for (const [nombre_norm, items] of Object.entries(groups)) {
        if (items.length === 1) unicos.push(items[0])
        else duplicados.push({ nombre_norm, rows: items })
      }

      return { unicos, duplicados, total: rows.length }
    } catch (e) {
      console.error('parseInsumos error:', e)
      return { unicos: [], duplicados: [], total: 0 }
    }
  },
  importarInsumos: async (insumos) => {
    const existing = get('productos')
    let id = nextId(existing)
    const toInsert = []
    const toUpdate = []
    for (const item of insumos) {
      const found = existing.find(p => p.codigo === item.codigo)
      if (found) toUpdate.push({ ...found, codigos_maxirest: item.codigos_maxirest, rubro_maxirest: item.rubro_maxirest })
      else toInsert.push({ ...item, id: id++, activo: 1, created_at: new Date().toISOString() })
    }
    const updated = existing.map(p => { const u = toUpdate.find(x => x.id === p.id); return u || p })
    set('productos', [...updated, ...toInsert])
    return { inserted: toInsert.length, updated: toUpdate.length }
  },
  exportarComparativa: async () => {
    alert('Exportación a archivo disponible solo en la app de escritorio')
    return null
  },
}

// ── Dialog / File ─────────────────────────────────────────────────────────────
const dialog = {
  openFile: async () => pickFile('.xlsx,.xls'),
  saveFile: async () => null,
}

const file = {
  readExcel: async () => {
    if (!_selectedFile) return {}
    return parseExcelSheets(_selectedFile)
  },
}

export const browserDB = { productos, proveedores, listas, equivalencias, comparador, maxirest, dialog, file }
