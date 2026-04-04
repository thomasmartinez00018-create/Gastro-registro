import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from '../pdf-worker-with-polyfill.js?worker&url'
import api from '../api'
import { AI_MODEL, getAIKey } from '../config'
import { callAI } from '../ai'
import { useImport } from '../ImportContext'
import { parsePresentacion } from '../utils/presentacion'

// Polyfill Promise.try en el hilo principal (para Electron < 32 / Chromium < 127)
if (typeof Promise.try === 'undefined') {
  Promise.try = function (fn) {
    return new Promise(function (resolve, reject) {
      try { resolve(fn()) } catch (e) { reject(e) }
    })
  }
}

// Worker con polyfill inyectado — Vite lo compila como módulo separado
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

  // Timeout de 15s — si el worker no carga, falla con mensaje claro
  const loadingTask = pdfjsLib.getDocument({ data: ab })
  const pdf = await Promise.race([
    loadingTask.promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        loadingTask.destroy?.()
        reject(new Error(
          `PDF.js worker no cargó (timeout 15s).\n` +
          `workerSrc: ${pdfjsLib.GlobalWorkerOptions.workerSrc}\n` +
          `Verificá la consola (Ctrl+Shift+I) para más detalles.`
        ))
      }, 15000)
    ),
  ])
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
        content: `Sos un experto en listas de precios de proveedores gastronómicos argentinos.
Tu tarea: extraer productos con nombre, presentación y precio de este fragmento de lista.

REGLAS DE PRECIOS:
- Formato argentino: 17.007,31 → 17007.31 (punto=miles, coma=decimal)
- Si ves "$17.007,31" o "$ 17.007" tratalo igual
- Si el precio parece por encima de $5.000.000 o por debajo de $1, marcalo como sospechoso

REGLAS DE PRESENTACIÓN Y UNIDADES (MUY IMPORTANTES):
- "x 250 GRS" o "250 gr" o "250 grs" → presentacion:"x 250 GRS", la IA NO convierte a kg, lo hace el sistema
- "1/2 kg" o "1/2KG" → presentacion:"x 500 GRS"  (1/2 kg = 500 g)
- "1/4 kg" → presentacion:"x 250 GRS"
- "x 5 LT" o "5 lts" o "5 litros" → presentacion:"x 5 LT"
- "x 12 UN" o "x12 uds" o "caja x 12" → tipo_compra:"CAJA", presentacion:"Caja x 12 UN"
- "KG." al final → vendido por kg (cantidad libre), presentacion:"KG"
- "UD." o "UN." al final → unidad, presentacion:"UN"
- Si la cantidad/unidad es ambigua o no clara → ambiguo:true

EJEMPLOS DE PRODUCTOS REALES:
- "BARRA DANBO LA PAULINA SIN TACC KG. 9.000,00" → {producto:"Barra Danbo La Paulina Sin TACC", presentacion:"KG", precio:9000}
- "BURRATA MOZZARI X 250 GRS 8.053,39" → {producto:"Burrata Mozzari", presentacion:"x 250 GRS", precio:8053.39}
- "CREMA DE LECHE LA PAULINA BALDE X 5LT 43.287,24" → {producto:"Crema de Leche La Paulina", presentacion:"Balde x 5 LT", precio:43287.24}
- "ACEITE GIRASOL COCINERO 1/2 LT 2.150,00" → {producto:"Aceite Girasol Cocinero", presentacion:"x 500 ML", precio:2150}
- "LOMO BOVINO $ 12.500 kg" → {producto:"Lomo Bovino", presentacion:"KG", precio:12500}
- "LATA TOMATE TRITURADO X 12 UN 18.400,00" → {producto:"Tomate Triturado en Lata", presentacion:"Caja x 12 UN", precio:18400}

QUÉ OMITIR:
- Encabezados de categoría: "QUESOS Y FIAMBRES", "CARNES", "LÁCTEOS", etc.
- Líneas de totales, IVA, subtotales
- Líneas sin precio reconocible
- Promociones o notas aclaratorias

TEXTO A PROCESAR:
${chunk}

Respondé SOLO con JSON array válido, sin markdown ni texto extra:
[{"producto":"NOMBRE CON MARCA","presentacion":"PRESENTACIÓN EXACTA","precio":NUMERO,"ambiguo":false},...]`
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
  // ── Estado persistente entre navegaciones (Context en App) ─────────────────
  const { job, update, reset: resetContext, fileRef } = useImport()
  const {
    step, idProveedor, fecha, archivoInfo: archivo,
    sheetSel, headerRow, headers, mapping, rows,
    aiProcessing, aiMessage, pdfProgress,
  } = job

  // Aliases de escritura → actualizan el context (sobreviven a navegación)
  const setStep         = (v) => update({ step: v })
  const setIdProveedor  = (v) => update({ idProveedor: v })
  const setFecha        = (v) => update({ fecha: v })
  const setArchivo      = (v) => update({ archivoInfo: v })
  const setSheetSel     = (v) => update({ sheetSel: v })
  const setHeaderRow    = (v) => update({ headerRow: v })
  const setHeaders      = (v) => update({ headers: v })
  const setMapping      = (fn) => update({ mapping: typeof fn === 'function' ? fn(job.mapping) : fn })
  const setRows         = (fn) => update({ rows: typeof fn === 'function' ? fn(job.rows) : fn })
  const setAiProcessing = (v) => update({ aiProcessing: v, active: v })
  const setAiMessage    = (v) => update({ aiMessage: v })
  const setPdfProgress  = (v) => update({ pdfProgress: v })

  // ── Estado local (no necesita persistir) ───────────────────────────────────
  const [proveedores, setProveedores] = useState([])
  const [productos,   setProductos]   = useState([])
  const [loading,     setLoading]     = useState(false)
  const [saving,      setSaving]      = useState(false)

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
    e.target.value = ''
    setLoading(true)
    setAiMessage('')
    try {
      const isPdf = file.name.toLowerCase().endsWith('.pdf')
      if (isPdf) {
        fileRef.current = file  // guardamos el File real en el ref del context
        setArchivo({ name: file.name, tipo: 'pdf' })
      } else {
        const sheets = await readExcelFile(file)
        const firstSheet = Object.keys(sheets)[0]
        fileRef.current = file
        setArchivo({ name: file.name, tipo: 'excel', sheets })
        setSheetSel(firstSheet)
      }
    } catch (err) {
      setAiMessage('Error al leer el archivo: ' + err.message)
    } finally { setLoading(false) }
  }

  // ── Excel: load sheet → Step 2 ──────────────────────────────────────────────
  const handleLoadSheet = () => {
    const rawRows = archivo?.sheets?.[sheetSel]
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
      const lines = await extractPdfLines(fileRef.current, (p, total) => {
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
          const nombreArchivo = archivo?.name.replace(/\.[^.]+$/, '').replace(/[\d_\-\.]/g, ' ').trim()
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
          const nombres = [(prod.producto || '').toLowerCase(), ...aliases]
          if (nombres.some(n => desc.includes(n) || n.includes(desc))) { codMatch = prod.codigo; estadoMatch = 'OK'; break }
        }
        // Inferir cantidad total desde la presentación usando el parser robusto
        // Maneja "10 BOLSAS X 1 KG" → 10 kg, "6 x 250 ML" → 1.5 litro, etc.
        const parsedPres = parsePresentacion(r.presentacion)
        let cantNum = null, unidadMed = null, cantBase = null
        if (parsedPres) {
          cantBase  = parsedPres.totalQty
          unidadMed = parsedPres.baseUnit
          cantNum   = parsedPres.totalQty
        }
        const pxm = precio && cantBase > 0 ? precio / cantBase : null
        return {
          fecha, id_proveedor: proveedorFinal, proveedor: provObj?.proveedor || proveedorFinal,
          archivo_origen: archivo?.name,
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
    const rawRows = archivo?.sheets?.[sheetSel]
    const sample = rawRows.slice(0, Math.min(headerRow + 5, rawRows.length))
    const sampleText = sample.map(r => r.join(' | ')).join('\n')
    setAiProcessing(true); setAiMessage('Detectando columnas con IA...')
    try {
      const text = await callAI([{
        role: 'user',
        content: `Sos un experto en listas de precios de proveedores gastronómicos argentinos.
Analizá el encabezado y las primeras filas de este Excel para identificar qué columna corresponde a cada campo.

CAMPOS A MAPEAR:
- producto_original: nombre del producto/descripción (ej: columnas "Descripción", "Producto", "Detalle", "Artículo", "Item")
- presentacion_original: formato/presentación del producto (ej: "Presentación", "Formato", "Envase", "Descripción 2")
- precio_informado: precio de venta o lista (ej: "Precio", "P. Lista", "Importe", "Valor", "P. Venta", "P/u")
- cantidad_por_unidad: cantidad numérica por unidad (ej: "Cantidad", "Cant.", "Peso", "Kgs", "Contenido", "Vol.")
- unidad_medida: unidad de medida (ej: "Unidad", "UM", "U.M.", "Medida")
- tipo_compra: si dice CAJA/UNIDAD (ej: "Tipo", "Modalidad de venta")
- unidades_por_caja: cuántas unidades tiene una caja (ej: "Und/Caja", "Uds x Caja", "Bulto")
- observaciones: notas adicionales (ej: "Obs", "Nota", "Comentario")

COLUMNAS DISPONIBLES (índice: nombre de encabezado):
${headers.map((h, i) => `${i}: "${h}"`).join('\n')}

MUESTRA DE LAS PRIMERAS FILAS:
${sampleText}

INSTRUCCIONES:
- Usá el índice de columna (número entero), no el nombre
- Si una columna no existe claramente → null
- Si precio aparece SIN columna separada de presentación, puede estar mezclado en la descripción → precio_informado:null
- Priorizá la columna de precio NETO o de lista (no precio con IVA si hay varias)

Respondé SOLO con JSON válido, sin texto extra ni markdown:
{"producto_original":0,"presentacion_original":null,"precio_informado":2,"cantidad_por_unidad":null,"unidad_medida":null,"tipo_compra":null,"unidades_por_caja":null,"observaciones":null}`
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
    const rawRows = archivo?.sheets?.[sheetSel]
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
        const rawUnidad = get('unidad_medida') ? String(get('unidad_medida')).toLowerCase().trim() : null
        // Intentar calcular cantidad total desde la columna presentacion_original
        // Maneja "10 BOLSAS X 1 KG" → 10 kg correctamente
        const rawPres = get('presentacion_original') ? String(get('presentacion_original')).trim() : null
        const parsedPres = parsePresentacion(rawPres)
        let cantBase, unidadFinal
        if (parsedPres) {
          cantBase   = parsedPres.totalQty
          unidadFinal = parsedPres.baseUnit
        } else {
          // Fallback: usar columna cantidad_por_unidad + unidad_medida
          cantBase   = cantNum
          unidadFinal = rawUnidad
          if (cantNum && rawUnidad) {
            if (/^(g|gr|grs)$/.test(rawUnidad)) cantBase = cantNum / 1000
            if (/^(ml|cc)$/.test(rawUnidad))    cantBase = cantNum / 1000
          }
        }
        const pxm = pxu && cantBase > 0 ? pxu / cantBase : null
        const desc = get('producto_original') ? String(get('producto_original')).toLowerCase().trim() : ''
        let codMatch = null, estadoMatch = 'PENDIENTE'
        for (const prod of productos) {
          const aliases = (prod.alias || '').toLowerCase().split(',').map(a => a.trim()).filter(Boolean)
          const nombres = [(prod.producto || '').toLowerCase(), ...aliases]
          if (nombres.some(n => desc.includes(n) || n.includes(desc))) { codMatch = prod.codigo; estadoMatch = 'OK'; break }
        }
        return {
          fecha, id_proveedor: idProveedor, proveedor: provObj?.proveedor || idProveedor,
          archivo_origen: archivo?.name,
          producto_original: get('producto_original') ? String(get('producto_original')).trim() : null,
          presentacion_original: get('presentacion_original') ? String(get('presentacion_original')).trim() : null,
          tipo_compra: tipo, unidades_por_caja: cajas, cantidad_por_unidad: cantBase,
          unidad_medida: unidadFinal || (get('unidad_medida') ? String(get('unidad_medida')).trim() : null),
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
      const productosBase = productos.map(p =>
        `${p.codigo}: ${p.producto}${p.alias ? ` [alias: ${p.alias}]` : ''}${p.categoria ? ` (${p.categoria})` : ''}`
      ).join('\n')
      const lista = pendientes.map((r, i) =>
        `${i}: "${r.producto_original}"${r.presentacion_original ? ` — ${r.presentacion_original}` : ''}`
      ).join('\n')
      const text = await callAI([{
        role: 'user',
        content: `Sos un experto en insumos gastronómicos argentinos.
Tu tarea: para cada item del proveedor, encontrar el código del producto interno que corresponde.

PRODUCTOS INTERNOS (código: nombre [alias] (categoría)):
${productosBase}

ITEMS DEL PROVEEDOR (índice: "nombre del proveedor" — presentación):
${lista}

REGLAS:
- Ignorá marca, tamaño y proveedor al comparar: "Aceite Girasol Cocinero x 900ml" → busca "Aceite Girasol" en los internos
- Si el producto coincide aunque sea con nombre distinto (sinónimos, abreviaciones) → asignarlo
- Ejemplos: "LOMO BOVINO" → busca "Lomo"; "HARINA 000 CAÑUELAS 25KG" → busca "Harina 000"
- Si hay duda razonable: asignalo igual con confianza baja
- Si definitivamente no existe: null

Respondé SOLO con JSON, sin texto extra:
{"0":"COD001","1":null,"2":"COD003",...}`
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

  // Feature 3: versionado — detect if rows already exist for this proveedor
  const [versionDialog, setVersionDialog] = useState(null) // null | 'pending'

  const handleSave = async () => {
    if (!rows.length) return
    // Check if there are already listas rows from this proveedor
    const todas = await api.listas.getAll()
    const existentes = todas.filter(l => l.id_proveedor === idProveedor)
    if (existentes.length > 0) {
      setVersionDialog('pending')
      return
    }
    setSaving(true)
    try { await api.listas.insertMany(rows); setStep(4) }
    finally { setSaving(false) }
  }

  const handleVersionChoice = async (choice) => {
    setVersionDialog(null)
    setSaving(true)
    try {
      if (choice === 'actualizar') {
        // Archive existing rows for this proveedor (mark activo=0), then insert new
        await api.listas.archiveByProveedor(idProveedor)
      }
      // Both choices insert the new rows (actualizar replaces old ones; historial keeps both)
      await api.listas.insertMany(rows)
      setStep(4)
    } finally { setSaving(false) }
  }

  const resetAll = () => resetContext()

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

        {/* Banner: sin API key */}
        {!getAIKey() && (
          <div style={{
            background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '10px',
            padding: '12px 16px', marginBottom: '14px', fontSize: '13px',
            display: 'flex', gap: '10px', alignItems: 'center'
          }}>
            <span style={{ fontSize: '18px' }}>⚠️</span>
            <div>
              <strong>Sin API key configurada — </strong>
              las funciones de IA no funcionarán.{' '}
              <span
                style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
                onClick={() => window._navigateTo?.('configuracion')}
              >
                Ir a Configuración →
              </span>
            </div>
          </div>
        )}

        {/* AI badge */}
        {getAIKey() && (
          <div className="alert alert-info mb-3" style={{ fontSize: '12px', padding: '8px 14px' }}>
            🤖 <strong>IA activada</strong> — Detecta columnas en Excel y extrae productos de PDFs automáticamente ({AI_MODEL})
          </div>
        )}

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
                    <span style={{ fontWeight: 500 }}>{archivo?.name}</span>
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
                      {Object.keys(archivo?.sheets).map(s => <option key={s} value={s}>{s}</option>)}
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
                  <>
                    <button className="btn btn-primary" onClick={handleLoadSheet} disabled={!archivo || !idProveedor}>
                      Continuar →
                    </button>
                    {archivo?.tipo === 'excel' && !idProveedor && (
                      <p style={{ fontSize: '13px', color: 'var(--warning)', marginTop: '8px' }}>
                        ⚠️ Seleccioná un proveedor para continuar
                      </p>
                    )}
                  </>
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
              {aiMessage && (
                <div className={`alert ${aiMessage.startsWith('✅') ? 'alert-info' : 'alert-info'} mb-3`}>
                  {aiMessage}
                </div>
              )}

              {/* ── Vista previa de las primeras filas ──────────────────────── */}
              {(() => {
                const rawRows = archivo?.sheets?.[sheetSel]
                const dataRows = rawRows ? rawRows.slice(headerRow, headerRow + 3) : []
                if (!headers.length || !dataRows.length) return null
                return (
                  <div style={{ marginBottom: '18px' }}>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 500 }}>
                      📋 Primeras filas del Excel — identificá qué columna corresponde a cada campo:
                    </p>
                    <div style={{ overflowX: 'auto', borderRadius: '6px', border: '1px solid var(--border)' }}>
                      <table style={{ fontSize: '12px', borderCollapse: 'collapse', width: '100%' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-secondary)' }}>
                            {headers.map((h, i) => (
                              <th key={i} style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                <span style={{ display: 'block', color: 'var(--text-secondary)', fontWeight: 400, fontSize: '10px' }}>Col {i}</span>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dataRows.map((row, ri) => (
                            <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                              {headers.map((_, ci) => (
                                <td key={ci} style={{ padding: '4px 10px', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {row[ci] != null ? String(row[ci]) : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}

              {/* ── Selectores de columna ──────────────────────────────────── */}
              <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {CAMPOS.map(c => {
                  const rawRows = archivo?.sheets?.[sheetSel]
                  const dataRows = rawRows ? rawRows.slice(headerRow, headerRow + 4) : []
                  const colIdx = parseInt(mapping[c.key])
                  const sampleVals = isNaN(colIdx)
                    ? []
                    : dataRows.map(r => r?.[colIdx]).filter(v => v != null && String(v).trim() !== '')
                  return (
                    <div className="form-group" key={c.key} style={{ margin: 0 }}>
                      <label className="form-label">{c.label}{c.required && ' *'}</label>
                      <select
                        className="form-select"
                        value={mapping[c.key] || ''}
                        onChange={e => setMapping(m => ({ ...m, [c.key]: e.target.value }))}
                        style={c.required && !mapping[c.key] ? { borderColor: 'var(--warning)' } : {}}
                      >
                        <option value="">— No incluido —</option>
                        {headers.map((h, i) => <option key={i} value={String(i)}>{i}: {h}</option>)}
                      </select>
                      {sampleVals.length > 0 && (
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          ej: {sampleVals.slice(0, 2).map(v => `"${String(v).slice(0, 28)}"`).join(', ')}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div style={{ marginTop: '16px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-secondary" onClick={() => setStep(1)}>← Atrás</button>
                <button className="btn btn-primary" onClick={handleBuildRows} disabled={!mapping.producto_original || !mapping.precio_informado}>
                  Previsualizar →
                </button>
                {(!mapping.producto_original || !mapping.precio_informado) && (
                  <span style={{ fontSize: '13px', color: 'var(--warning)' }}>
                    ⚠️ Falta mapear:{' '}
                    {[
                      !mapping.producto_original && 'Descripción del producto',
                      !mapping.precio_informado  && 'Precio',
                    ].filter(Boolean).join(' y ')}
                  </span>
                )}
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
                  <p style={{ marginBottom: '8px', fontWeight: 600 }}>Listo para procesar <strong>{archivo?.name}</strong></p>
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

      {/* ── Feature 3: Version dialog ─────────────────────────────────────── */}
      {versionDialog === 'pending' && createPortal(
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h3>⚠️ Ya existen precios de este proveedor</h3>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '16px', color: 'var(--text-muted)', fontSize: '14px' }}>
                Ya hay listas cargadas para este proveedor. ¿Qué querés hacer con los datos nuevos?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <button
                  className="btn btn-primary"
                  style={{ textAlign: 'left', padding: '14px 16px' }}
                  onClick={() => handleVersionChoice('actualizar')}
                  disabled={saving}
                >
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>🔄 Actualizar precios</div>
                  <div style={{ fontSize: '12px', opacity: 0.85, fontWeight: 400 }}>
                    Marca los precios anteriores como inactivos y guarda los nuevos como vigentes.
                    El comparador mostrará solo los precios actuales.
                  </div>
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ textAlign: 'left', padding: '14px 16px' }}
                  onClick={() => handleVersionChoice('historial')}
                  disabled={saving}
                >
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>📅 Agregar como historial</div>
                  <div style={{ fontSize: '12px', opacity: 0.85, fontWeight: 400 }}>
                    Guarda los nuevos precios junto a los anteriores. Útil para ver la evolución histórica en el Comparador.
                  </div>
                </button>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-ghost"
                onClick={() => setVersionDialog(null)}
                disabled={saving}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
