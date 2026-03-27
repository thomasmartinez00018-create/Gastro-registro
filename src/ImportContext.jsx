// ImportContext.jsx — Estado global del proceso de importación
// Persiste entre navegaciones para que el PDF no se corte al cambiar de sección
import { createContext, useContext, useState, useRef } from 'react'

const ImportContext = createContext(null)

const today = () => new Date().toISOString().split('T')[0]

export const IMPORT_INITIAL = {
  active:       false,   // true cuando hay sesión de importación activa
  step:         1,
  idProveedor:  '',
  fecha:        today(),
  archivoInfo:  null,    // { name, tipo, sheets? } — sin el File object
  sheetSel:     '',
  headerRow:    1,
  headers:      [],
  mapping:      {},
  rows:         [],
  aiProcessing: false,
  pdfProgress:  '',
  aiMessage:    '',
  versionDialog: null,
}

export function ImportProvider({ children }) {
  const [job, setJob] = useState(IMPORT_INITIAL)
  // File object fuera del estado (no serializable, pero sobrevive si no se recarga la página)
  const fileRef = useRef(null)

  // Actualización parcial (como setState de clase)
  const update = (changes) => setJob(prev => ({ ...prev, ...changes }))

  // Reset completo
  const reset = () => {
    setJob({ ...IMPORT_INITIAL, fecha: today() })
    fileRef.current = null
  }

  return (
    <ImportContext.Provider value={{ job, update, reset, fileRef }}>
      {children}
    </ImportContext.Provider>
  )
}

export const useImport = () => useContext(ImportContext)
