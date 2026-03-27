import { useState, useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import api from '../api'
import { AI_MODEL } from '../config'
import { callAI } from '../ai'

// PDF.js worker — usa archivo local, no CDN (funciona sin internet)
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const CAMPOS = [
  { key: 'producto_original', label: 'Descripción del producto', required: true },
  { key: 'presentacion_original', label: 'Presentación' },
  { key: 'precio_informado', label: 'Precio', required: true },
  { key: 'tipo_compra', label: 'Tipo (UNIDAD/CAJA)' },
  { key: 'unidades_por_caja', label: 'Unidades por caja' },
  { key: 'cantidad_por_unidad', label: 'Cantidad por unidad' },
  { key: 'unidad_medida', label: 'Unidad de medida' },
  { key: 'observaciones', label: 'Observaciones' },
]

// ── Excel parsing (browser/renderer, no IPC needed) ───────────────────────────
async function readExcelFile(file) {
  const XLSX = await import('xlsx')
  const ab = await file.arrayBuffer()
  const wb = XLSX.read(ab, { type: 'array' })
  const sheets = {}
  for (const name of wb.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null })
  }
  return sheets
}

// ── PDF text extraction with column separation ────────────────────────────────
async function extractPdfLines(file, onProgress) {
  const ab = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise
  const allLines = []

  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress && onProgress(p, pdf.numPages)
    const page = await pdf.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items = content.items.filter(i => i.str && i.str.trim())
    if (!items.length) continue

    const midX = viewport.width / 2
    const leftItems = items.filter(i => i.transform[4] < midX)
    const rightItems = items.filter(i => i.transform[4] >= midX)

    const toLines = (col) => {
      const groups = []
      const sorted = [...col].sort((a, b) => b.transform[5] - a.transform[5])
      for (const item of sorted) {
        const y = item.transform[5]
        const group = groups.find(g => Math.abs(g.y - y) < 4)
        if (group) group.items.push(item)
        else groups.push({ y, items: [item] })
      }
      return groups
        .sort((a, b) => b.y - a.y)
        .map(g => g.items.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ').trim())
        .filter(Boolean)
    }

    allLines.push(...toLines(leftItems), ...toLines(rightItems))
  }
  return allLines
}

// ── AI parsing of PDF lines in chunks ────────────────────────────────────────
async function parsePdfChunks(lines, onChunk) {
  const CHUNK = 80
  const allRows = []
  const total = Math.ceil(lines.length / CHUNK)
  let lastError = null
  let failedChunks = 0

  for (let i = 0; i < lines.length; i += CHUNK) {
    const chunk = lines.slice(i, i + CHUNK).join('\n')
    onChunk && onChunk(Math.floor(i / CHUNK) + 1, total)
    try {
      const text = await callAI([{
        role: 'user',
        content: `Sos un asistente de gestión gastronómica argentina. Extraé productos de esta lista de precios.
Cada producto tiene formato: NOMBRE PRESENTACIÓN/UNIDAD PRECIO
Ejemplos de formato:
- "BARRA DANBO LA PAULINA KG SIN TACC KG. 9.000,00"
- "BURRATA MOZZARI X 250 GRS UD. 8.053,39"
- "CREMA DE LECHE LA PAULINA BALDE X 5LT 44% Balde x 5 lts 43.287,24"
Los precios usan formato argentino: 17.007,31 = 17007.31 (punto=miles, coma=decimal)
Las unidades pueden ser: KG., UD., LT., Bolsa x N kg, Caja x N uds, Balde x N lts, Pack x N u, etc.

TEXTO A PROCESAR:
${chunk}

Respondé SOLO con un JSON array. Sin texto extra, sin markdown:
[{"producto":"NOMBRE COMPLETO DEL PRODUCTO","presentacion":"PRESENTACIÓN O UNIDAD","precio":NUMERO},...]
- precio como número decimal (17007.31 no "17.007,31")
- Omitir encabezados de categoría (ej: "QUESOS", "LACTEOS", "CARNES")
- Omitir líneas sin precio reconocible
- Incluir siempre la marca en el nombre del producto`
      }], 4000)

      const match = text.match(/\[[\s\S]*\]/)
      if (match) {
        const parsed = JSON.parse(match[0])
        allRows.push(...parsed.filter(r => r.producto && typeof r.precio === 'number' && r.precio > 0))
      }
    } catch (e) {
      lastError = e
      failedChunks++
      console.warn('Error en chunk PDF', i, e.message)
    }
  }

  // Si todos los chunks fallaron, lanzar el error real al usuario
  if (failedChunks === total && total > 0) {
    throw new Error(lastError?.message || 'No se pudo procesar el PDF con la IA')
  }

  return allRows
}

// ── Auto-detect provider name from PDF first lines ────────────────────────────
async function detectProviderFromPdf(lines) {
  const sample = lines.slice(0, 30).join('\n')
  try {
    const text = await callAI([{
      role: 'user',
      content: `Este es el encabezado de una lista de precios de un proveedor gastronómico argentino.
Identificá el nombre comercial del proveedor (empresa distribuidora, no los productos).
Respondé SOLO con JSON: {"proveedor": "NOMBRE"} o {"proveedor": null} si no podés identificarlo.

TEXTO:
${sample}`
    }], 100)
    const match = text.match(/\{[\s\S]*?\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      return parsed.proveedor || null
    }
  } catch { /* silencioso */ }
  return null
}

// ── Parse Argentine price string ──────────────────────────────────────────────
function parseArgPrice(str) {
  if (!str && str !== 0) return null
  const s = String(str).replace(/[^0-9.,]/g, '')
  // Format: 17.007,31 → 17007.31
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'))
  return parseFloat(s)
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ImportarLista() {
  const [step, setStep] = useState(1)
  const [proveedores, setProveedores] = useState([])
  const [productos, setProductos] = useState([])

  const [idProveedor, setIdProveedor] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])
  const [archivo, setArchivo] = useState(null)   // { name, tipo:'excel'|'pdf', sheets?, file? }
  const [sheetSel, setSheetSel] = useState('')
  const [headerRow, setHeaderRow] = useState(1)
  const [loading, setLoading] = useState(false)

  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [rows, setRows] = useState([])
  const [saving, setSaving] = useState(false)

  const [aiProcessing, setAiProcessing] = useState(false)
  const [aiMessage, setAiMessage] = useState('')
  const [pdfProgress, setPdfProgress] = useState('')

  const fileInputRef = useRef(null)

  useEffect(() => {
    Promise.all([api.proveedores.getAll(), api.productos.getAll()]).then(([p, pr]) => {
      setProveedores(p.filter(x => x.activo))
      setProductos(pr.filter(x => x.activo))
    })
  }, [])

  // ── File input handler ──────────────────────────────────────────────────────
  const handleFileInput = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // reset so same file can be re-selected
    setLoading(true)
    setAiMessage('')
    try {
      const isPdf = file.name.toLowerCase().endsWith('.pdf')
      if (isPdf) {
        setArchivo({ name: file.name, tipo: 'pdf', file })
      } else {
        const sheets = await readExcelFile(file)
        const firstSheet = Object.keys(sheets)[0]
        setArchivo({ name: file.name, tipo: 'excel', sheets })
        setSheetSel(firstSheet)
      }
    } catch (err) {
      setAiMessage('Error al leer el archivo: ' + err.message)
    } finally { setLoading(false) }
  }

  // ── Excel: load sheet → Step 2 ──────────────────────────────────────────────
  const handleLoadSheet = () => {
    const rawRows = archivo.sheets[sheetSel]
    if (!rawRows || rawRows.length < headerRow) return
    const hdr = (rawRows[headerRow - 1] || []).map((h, i) => h ? String(h).trim() : `Col ${i + 1}`)
    setHeaders(hdr)
    const autoMap = {}
    const patterns = {
      producto_original: /prod|desc|item|nombre|insumo|articulo/i,
      presentacion_original: /present|forma|format|envase/i,
      precio_informado: /precio|price|valor|cost/i,
      cantidad_por_unidad: /cant|contenido|peso|volumen|gramo|kilo|litro/i,
      unidad_medida: /unidad|medida|um|ud/i,
      tipo_compra: /tipo|modalidad/i,
      unidades_por_caja: /x caja|por caja|bulto/i,
    }
    hdr.forEach((h, i) => {
      for (const [field, re] of Object.entries(patterns)) {
        if (!autoMap[field] && re.test(h)) { autoMap[field] = String(i); break }
      }
    })
    setMapping(autoMap)
    setStep(2)
  }

  // ── PDF: process with AI → Step 3 ──────────────────────────────────────────
  const handlePdfProcess = async () => {
    setAiProcessing(true)
    setAiMessage('')
    setPdfProgress('Leyendo PDF...')
    try {
      const lines = await extractPdfLines(archivo.file, (p, total) => {
        setPdfProgress(`Leyendo PDF... página ${p} de ${total}`)
      })

      // ── Auto-detect / auto-create provider ───────────────────────────────
      let proveedorFinal = idProveedor
      let provObj = proveedores.find(p => p.id_proveedor === proveedorFinal)

      if (!proveedorFinal) {
        setPdfProgress('Detectando proveedor con IA...')
        const nombreDetectado = await detectProviderFromPdf(lines)

        if (nombreDetectado) {
          // Try to match existing provider (case-insensitive)
          const normalizar = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
          provObj = proveedores.find(p =>
            normalizar(p.proveedor).includes(normalizar(nombreDetectado)) ||
            normalizar(nombreDetectado).includes(normalizar(p.proveedor))
          )

          if (provObj) {
            // Found existing — use it
            proveedorFinal = provObj.id_proveedor
            setIdProveedor(proveedorFinal)
            setPdfProgress(`Proveedor detectado: ${provObj.proveedor}`)
          } else {
            // Create new provider automatically
            const todos = await api.proveedores.getAll()
            const num = String(todos.length + 1).padStart(3, '0')
            const nuevoId = 'PROV' + num
            const nuevo = {
              id_proveedor: nuevoId,
              proveedor: nombreDetectado.toUpperCase(),
              contacto: '', whatsapp: '', email: '', observaciones: 'Creado automáticamente desde PDF'
            }
            await api.proveedores.create(nuevo)
            const actualizados = await api.proveedores.getAll()
            setProveedores(actualizados.filter(x => x.activo))
            provObj = actualizados.find(p => p.id_proveedor === nuevoId)
            proveedorFinal = nuevoId
            setIdProveedor(nuevoId)
            setPdfProgress(`Proveedor creado: ${nombreDetectado.toUpperCase()}`)
          }
        } else {
          // Can't detect — try from filename
          const nombreArchivo = archivo.name.replace(/\.[^.]+$/, '').replace(/[\d_\-\.]/g, ' ').trim()
          const nuevoId = 'PROV' + String((await api.proveedores.getAll()).length + 1).padStart(3, '0')
          const nuevo = {
            id_proveedor: nuevoId,
            proveedor: nombreArchivo.toUpperCase() || 'PROVEEDOR SIN NOMBRE',
            contacto: '', whatsapp: '', email: '', observaciones: 'Creado automáticamente desde PDF'
          }
          await api.proveedores.create(nuevo)
          const actualizados = await api.proveedores.getAll()
          setProveedores(actualizados.filter(x => x.activo))
          provObj = actualizados.find(p => p.id_proveedor === nuevoId)
          proveedorFinal = nuevoId
          setIdProveedor(nuevoId)
          setPdfProgress(`Proveedor creado: ${nuevo.proveedor}`)
        }
      }

      setPdfProgress('Analizando productos con IA...')
      const pdfRows = await parsePdfChunks(lines, (chunk, total) => {
        setPdfProgress(`Procesando con IA... bloque ${chunk} de ${total}`)
      })

      const built = pdfRows.map(r => {
        const precio = typeof r.precio === 'number' ? r.precio : parseArgPrice(r.precio)
        const desc = (r.producto || '').toLowerCase().trim()
        let codMatch = null, estadoMatch = 'PENDIENTE'
        for (const prod of productos) {
          const aliases = (prod.alias || '').toLowerCase().split(',').map(a => a.trim()).filter(Boolean)
          const nombres = [prod.producto.toLowerCase(), ...aliases]
          if (nombres.some(n => desc.includes(n) || n.includes(desc))) { codMatch = prod.codigo; estadoMatch = 'OK'; break }
        }
        // Infer unit/quantity from presentacion
        let cantNum = null, unidadMed = null
        const pres = (r.presentacion || '').toLowerCase()
        const cantMatch = pres.match(/(\d+[\d.,]*)\s*(kg|kgs|kilo|gr|grs|lt|lts|cc|ml|g)\b/)
        if (cantMatch) {
          cantNum = parseFloat(cantMatch[1].replace(',', '.'))
          const u = cantMatch[2]
          unidadMed = /kg|kilo/.test(u) ? 'kg' : /gr|g/.test(u) ? 'g' : /lt|lts/.test(u) ? 'l' : /ml|cc/.test(u) ? 'ml' : u
        }
        const pxm = precio && cantNum > 0 ? precio / cantNum : null
        return {
          fecha, id_proveedor: proveedorFinal, proveedor: provObj?.proveedor || proveedorFinal,
          archivo_origen: archivo.name,
          producto_original: r.producto?.trim() || null,
          presentacion_original: r.presentacion?.trim() || null,
          tipo_compra: 'UNIDAD', unidades_por_caja: 1,
          cantidad_por_unidad: cantNum,
          unidad_medida: unidadMed,
          precio_informado: precio, moneda: 'ARS',
          observaciones: null,
          codigo_producto: codMatch, estado_match: estadoMatch,
          precio_por_unidad: precio, precio_por_medida_base: pxm,
        }
      }).filter(r => r.producto_original && r.precio_informado)

      setRows(built)
      setPdfProgress('')
      setStep(3)
    } catch (err) {
      setAiMessage('Error al procesar PDF: ' + err.message)
    } finally { setAiProcessing(false) }
  }

  // ── Excel AI mapping ────────────────────────────────────────────────────────
  const handleAiMapping = async () => {
    const rawRows = archivo.sheets[sheetSel]
    const sample = rawRows.slice(0, Math.min(headerRow + 5, rawRows.length))
    const sampleText = sample.map(r => r.join(' | ')).join('\n')
    setAiProcessing(true); setAiMessage('Detectando columnas con IA...')
    try {
      const text = await callAI([{
        role: 'user',
        content: `Sos un asistente de gestión gastronómica. Analizá este encabezado y primeras filas de un Excel de lista de precios de proveedor.
Columnas disponibles (índice: nombre): ${headers.map((h, i) => `${i}:"${h}"`).join(', ')}
Muestra:\n${sampleText}
Respondé SOLO con JSON válido, sin texto extra:
{"producto_original":<índice o null>,"presentacion_original":<índice o null>,"precio_informado":<índice o null>,"cantidad_por_unidad":<índice o null>,"unidad_medida":<índice o null>,"tipo_compra":<índice o null>,"unidades_por_caja":<índice o null>,"observaciones":<índice o null>}`
      }])
      const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}')
      const newMap = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (v !== null && v !== undefined) newMap[k] = String(v)
      }
      setMapping(newMap)
      setAiMessage('✅ Columnas detectadas. Revisá y corregí si es necesario.')
    } catch {
      setAiMessage('No se pudo analizar con IA. Mapeá las columnas manualmente.')
    } finally { setAiProcessing(false) }
  }

  // ── Excel: build rows from mapping ─────────────────────────────────────────
  const handleBuildRows = () => {
    const rawRows = archivo.sheets[sheetSel]
    const dataRows = rawRows.slice(headerRow)
    const provObj = proveedores.find(p => p.id_proveedor === idProveedor)
    const built = dataRows
      .filter(row => row && row.some(c => c !== null && c !== ''))
      .map(row => {
        const get = (key) => { const idx = parseInt(mapping[key]); return isNaN(idx) ? null : row[idx] }
        const precio = parseArgPrice(get('precio_informado'))
        const cant = get('cantidad_por_unidad')
        const cantNum = cant ? parseFloat(String(cant).replace(',', '.')) : null
        const cajas = parseFloat(String(get('unidades_por_caja') || '1').replace(',', '.')) || 1
        const tipoRaw = get('tipo_compra')
        const tipo = tipoRaw && String(tipoRaw).toUpperCase().includes('CAJA') ? 'CAJA' : 'UNIDAD'
        let pxu = precio
        if (precio && tipo === 'CAJA') pxu = precio / cajas
        const pxm = pxu && cantNum > 0 ? pxu / cantNum : null
        const desc = get('producto_original') ? String(get('producto_original')).toLowerCase().trim() : ''
        let codMatch = null, estadoMatch = 'PENDIENTE'
        for (const prod of productos) {
          const aliases = (prod.alias || '').toLowerCase().split(',').map(a => a.trim()).filter(Boolean)
          const nombres = [prod.producto.toLowerCase(), ...aliases]
          if (nombres.some(n => desc.includes(n) || n.includes(desc))) { codMatch = prod.codigo; estadoMatch = 'OK'; break }
        }
        return {
          fecha, id_proveedor: idProveedor, proveedor: provObj?.proveedor || idProveedor,
          archivo_origen: archivo.name,
          producto_original: get('producto_original') ? String(get('producto_original')).trim() : null,
          presentacion_original: get('presentacion_original') ? String(get('presentacion_original')).trim() : null,
          tipo_compra: tipo, unidades_por_caja: cajas, cantidad_por_unidad: cantNum,
          unidad_medida: get('unidad_medida') ? String(get('unidad_medida')).trim() : null,
          precio_informado: precio, moneda: 'ARS',
          observaciones: get('observaciones') ? String(get('observaciones')).trim() : null,
          codigo_producto: codMatch, estado_match: estadoMatch,
          precio_por_unidad: pxu, precio_por_medida_base: pxm,
        }
      })
      .filter(r => r.producto_original && r.precio_informado)
    setRows(built)
    setStep(3)
  }

  // ── AI enrich pending rows ──────────────────────────────────────────────────
  const handleAiEnrich = async () => {
    const pendientes = rows.filter(r => r.estado_match === 'PENDIENTE').slice(0, 40)
    if (!pendientes.length) { setAiMessage('Todos los productos ya están identificados.'); return }
    setAiProcessing(true); setAiMessage('Identificando productos con IA...')
    try {
      const productosBase = productos.map(p => `${p.codigo}: ${p.producto} (alias: ${p.alias || '—'})`).join('\n')
      const lista = pendientes.map((r, i) => `${i}: "${r.producto_original}" ${r.presentacion_original || ''}`).join('\n')
      const text = await callAI([{
        role: 'user',
        content: `Sos un asistente de gestión gastronómica. Tu tarea es identificar a qué producto base corresponde cada item.
PRODUCTOS BASE (código: nombre):
${productosBase}
ITEMS DEL PROVEEDOR:
${lista}
Respondé SOLO con JSON: {"0":"COD001","1":null,...} usando el índice de cada item.`
      }])
      const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}')
      setRows(prev => {
        let pendIdx = 0
        return prev.map(r => {
          if (r.estado_match !== 'PENDIENTE') return r
          const codigo = parsed[String(pendIdx++)]
          if (codigo && productos.find(p => p.codigo === codigo)) return { ...r, codigo_producto: codigo, estado_match: 'OK' }
          return r
        })
      })
      const matched = Object.values(parsed).filter(Boolean).length
      setAiMessage(`✅ IA identificó ${matched} de ${pendientes.length} productos.`)
    } catch {
      setAiMessage('Error al procesar con IA. Podés resolver manualmente en Equivalencias.')
    } finally { setAiProcessing(false) }
  }

  const handleSave = async () => {
    if (!rows.length) return
    setSaving(true)
    try { await api.listas.insertMany(rows); setStep(4) }
    finally { setSaving(false) }
  }

  const resetAll = () => {
    setStep(1); setArchivo(null); setSheetSel(''); setHeaders([])
    setMapping({}); setRows([]); setAiMessage(''); setPdfProgress(''); setIdProveedor('')
  }

  const okCount = rows.filter(r => r.estado_match === 'OK').length
  const pendCount = rows.filter(r => r.estado_match === 'PENDIENTE').length
  const isPdf = archivo?.tipo === 'pdf'

  return (
    <>
      {/* Hidden file input — always works: browser, macOS, Windows */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.pdf"
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />

      <div className="page-header">
        <div>
          <h2>Importar Lista de Precios</h2>
          <p>Cargá la lista de un proveedor — Excel o PDF</p>
        </div>
        {step > 1 && step < 4 && <button className="btn btn-secondary" onClick={resetAll}>↺ Empezar de nuevo</button>}
      </div>

      <div className="page-body">
        {/* Steps indicator */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', alignItems: 'center' }}>
          {['Configurar', isPdf ? 'Procesar PDF' : 'Mapear columnas', 'Revisar y guardar', 'Listo'].map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: step > i + 1 ? 'var(--primary)' : step === i + 1 ? 'var(--primary)' : 'var(--border)', color: step >= i + 1 ? '#fff' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0 }}>
                {step > i + 1 ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: '13px', fontWeight: step === i + 1 ? 600 : 400, color: step === i + 1 ? 'var(--text)' : 'var(--text-muted)' }}>{s}</span>
              {i < 3 && <span style={{ color: 'var(--border)', margin: '0 4px' }}>›</span>}
            </div>
          ))}
        </div>

        {/* AI badge */}
        <div className="alert alert-info mb-3" style={{ fontSize: '12px', padding: '8px 14px' }}>
          🤖 <strong>IA activada</strong> — Detecta columnas en Excel y extrae productos de PDFs automáticamente ({AI_MODEL})
        </div>

        {/* ── STEP 1 ─────────────────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="card">
            <div className="card-header"><h3>Paso 1 — Configurar importación</h3></div>
            <div className="card-body">
              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="form-label">Proveedor *</label>
                  <select className="form-select" value={idProveedor} onChange={e => setIdProveedor(e.target.value)}>
                    <option value="">Seleccioná un proveedor</option>
                    {proveedores.map(p => <option key={p.id} value={p.id_proveedor}>{p.proveedor} ({p.id_proveedor})</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha de la lista</label>
                  <input className="form-input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Archivo</label>
                {!archivo ? (
                  <div
                    className="upload-zone"
                    onClick={() => fileInputRef.current?.click()}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="icon">📂</div>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                      {loading ? 'Leyendo archivo...' : 'Hacer clic para seleccionar archivo'}
                    </div>
                    <div className="text-muted">Formatos: .xlsx, .xls, .pdf</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: isPdf ? '#fef3f2' : '#f0fdf4', borderRadius: '6px', border: `1px solid ${isPdf ? '#fca5a5' : '#a7f3d0'}` }}>
                    <span>{isPdf ? '📄' : '📊'}</span>
                    <span style={{ fontWeight: 500 }}>{archivo.name}</span>
                    <span className="badge" style={{ background: isPdf ? '#fee2e2' : '#dcfce7', color: isPdf ? '#b91c1c' : '#166534', fontWeight: 600 }}>
                      {isPdf ? 'PDF' : 'Excel'}
                    </span>
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setArchivo(null); setSheetSel('') }}>✕ Cambiar</button>
                  </div>
                )}
              </div>

              {/* Excel: sheet selector */}
              {archivo?.tipo === 'excel' && (
                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label className="form-label">Hoja</label>
                    <select className="form-select" value={sheetSel} onChange={e => setSheetSel(e.target.value)}>
                      {Object.keys(archivo.sheets).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Fila de encabezados</label>
                    <input className="form-input" type="number" min="1" value={headerRow} onChange={e => setHeaderRow(parseInt(e.target.value) || 1)} />
                  </div>
                </div>
              )}

              {/* PDF info */}
              {isPdf && (
                <div className="alert alert-info" style={{ fontSize: '13px' }}>
                  🤖 El PDF se va a procesar automáticamente con IA — no necesitás mapear columnas
                </div>
              )}

              {aiMessage && <div className="alert alert-danger mb-2">{aiMessage}</div>}

              <div style={{ marginTop: '12px' }}>
                {isPdf ? (
                  <button className="btn btn-primary" onClick={() => setStep(2)}>
                    Continuar → Procesar con IA
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={handleLoadSheet} disabled={!archivo || !idProveedor}>
                    Continuar →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2 — Excel: column mapper ─────────────────────────────────── */}
        {step === 2 && !isPdf && (
          <div className="card">
            <div className="card-header">
              <h3>Paso 2 — Mapear columnas</h3>
              <button className="btn btn-secondary btn-sm" onClick={handleAiMapping} disabled={aiProcessing}>
                {aiProcessing ? '⏳ Analizando...' : '🤖 Detectar automáticamente con IA'}
              </button>
            </div>
            <div className="card-body">
              {aiMessage && <div className="alert alert-info mb-3">{aiMessage}</div>}
              <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {CAMPOS.map(c => (
                  <div className="form-group" key={c.key} style={{ margin: 0 }}>
                    <label className="form-label">{c.label}{c.required && ' *'}</label>
                    <select className="form-select" value={mapping[c.key] || ''} onChange={e => setMapping(m => ({ ...m, [c.key]: e.target.value }))}>
                      <option value="">— No incluido —</option>
                      {headers.map((h, i) => <option key={i} value={String(i)}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary" onClick={() => setStep(1)}>← Atrás</button>
                <button className="btn btn-primary" onClick={handleBuildRows} disabled={!mapping.producto_original || !mapping.precio_informado}>Previsualizar →</button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2 — PDF: AI processing ───────────────────────────────────── */}
        {step === 2 && isPdf && (
          <div className="card">
            <div className="card-header"><h3>Paso 2 — Procesar PDF con IA</h3></div>
            <div className="card-body" style={{ textAlign: 'center', padding: '40px 24px' }}>
              {!aiProcessing && !aiMessage && (
                <>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>🤖</div>
                  <p style={{ marginBottom: '8px', fontWeight: 600 }}>Listo para procesar <strong>{archivo.name}</strong></p>
                  {idProveedor && (
                    <p style={{ marginBottom: '8px', fontSize: '13px' }}>
                      Proveedor: <strong>{proveedores.find(p => p.id_proveedor === idProveedor)?.proveedor || idProveedor}</strong>
                    </p>
                  )}
                  {!idProveedor && (
                    <p style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--warning)' }}>
                      ⚡ Sin proveedor seleccionado — la IA lo va a detectar automáticamente del PDF
                    </p>
                  )}
                  <p className="text-muted" style={{ marginBottom: '24px', fontSize: '14px' }}>
                    La IA va a leer el PDF, detectar el formato doble columna y extraer todos los productos con sus precios automáticamente.
                  </p>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                    <button className="btn btn-secondary" onClick={() => setStep(1)}>← Atrás</button>
                    <button className="btn btn-primary" onClick={handlePdfProcess}>
                      🚀 Procesar PDF
                    </button>
                  </div>
                </>
              )}
              {aiProcessing && (
                <>
                  <div style={{ fontSize: '40px', marginBottom: '16px', animation: 'spin 1s linear infinite' }}>⏳</div>
                  <p style={{ fontWeight: 600, marginBottom: '8px' }}>{pdfProgress || 'Procesando...'}</p>
                  <p className="text-muted" style={{ fontSize: '13px' }}>Esto puede tardar 30-60 segundos según el tamaño del PDF</p>
                  <div style={{ width: '200px', height: '4px', background: 'var(--border)', borderRadius: '4px', margin: '16px auto 0' }}>
                    <div style={{ width: '60%', height: '100%', background: 'var(--primary)', borderRadius: '4px', animation: 'progress-indeterminate 1.5s ease-in-out infinite' }} />
                  </div>
                </>
              )}
              {aiMessage && !aiProcessing && (
                <>
                  <div className="alert alert-danger">{aiMessage}</div>
                  <button className="btn btn-secondary" onClick={() => setStep(1)}>← Volver</button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 3 — Review ───────────────────────────────────────────────── */}
        {step === 3 && (
          <div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="card" style={{ padding: '10px 16px', display: 'flex', gap: '20px' }}>
                <div><span style={{ fontWeight: 700, color: 'var(--primary)' }}>{rows.length}</span> <span className="text-muted">productos</span></div>
                <div><span style={{ fontWeight: 700, color: '#166534' }}>{okCount}</span> <span className="text-muted">identificados</span></div>
                <div><span style={{ fontWeight: 700, color: 'var(--warning)' }}>{pendCount}</span> <span className="text-muted">pendientes</span></div>
                {isPdf && <div><span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>PDF</span></div>}
              </div>
              {pendCount > 0 && (
                <button className="btn btn-secondary" onClick={handleAiEnrich} disabled={aiProcessing}>
                  {aiProcessing ? '⏳ Procesando...' : `🤖 Identificar ${pendCount} pendientes con IA`}
                </button>
              )}
            </div>
            {aiMessage && <div className="alert alert-success mb-3">{aiMessage}</div>}
            {pendCount > 0 && (
              <div className="alert alert-warning mb-3">
                ⚠️ {pendCount} productos sin identificar. Se resuelven en <strong>Equivalencias</strong>.
              </div>
            )}
            <div className="card mb-3">
              <div className="table-wrapper" style={{ maxHeight: '380px', overflow: 'auto' }}>
                <table>
                  <thead>
                    <tr><th>Estado</th><th>Producto</th><th>Presentación</th><th>Tipo</th><th>Cant.</th><th>Unidad</th><th>Precio</th><th>$/unidad</th><th>Código</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td><span className={`badge ${r.estado_match === 'OK' ? 'badge-green' : 'badge-yellow'}`}>{r.estado_match === 'OK' ? '✓' : '⏳'}</span></td>
                        <td style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.producto_original}>{r.producto_original}</td>
                        <td className="text-muted" style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.presentacion_original || '—'}</td>
                        <td><span className={`badge ${r.tipo_compra === 'CAJA' ? 'badge-blue' : 'badge-gray'}`}>{r.tipo_compra}</span></td>
                        <td>{r.cantidad_por_unidad || '—'}</td>
                        <td>{r.unidad_medida || '—'}</td>
                        <td style={{ fontWeight: 600 }}>{r.precio_informado ? `$${r.precio_informado.toLocaleString('es-AR')}` : '—'}</td>
                        <td>{r.precio_por_unidad ? `$${r.precio_por_unidad.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : '—'}</td>
                        <td><span className="font-mono text-muted">{r.codigo_producto || '—'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary" onClick={() => isPdf ? setStep(2) : setStep(2)}>← Atrás</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !rows.length}>
                {saving ? 'Guardando...' : `✓ Guardar ${rows.length} productos`}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4 ────────────────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="card">
            <div className="card-body" style={{ textAlign: 'center', padding: '48px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
              <h3 style={{ fontSize: '20px', marginBottom: '8px' }}>Lista importada correctamente</h3>
              <p className="text-muted" style={{ marginBottom: '24px' }}>
                {rows.length} productos guardados.{pendCount > 0 ? ` ${pendCount} pendientes para resolver en Equivalencias.` : ' Todos los productos identificados.'}
              </p>
              <button className="btn btn-primary" onClick={resetAll}>Importar otra lista</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
