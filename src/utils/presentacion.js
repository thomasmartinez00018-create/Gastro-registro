/**
 * parsePresentacion(str) → { totalQty, baseUnit: 'kg' | 'litro' } | null
 *
 * Calcula la cantidad TOTAL en unidad base a partir del texto de presentación
 * del proveedor, manejando presentaciones compuestas (N × M UNIT).
 *
 * Ejemplos:
 *   "10 BOLSAS X 1 KG"       → { totalQty: 10,  baseUnit: 'kg' }
 *   "BOLSA 10 x 1 kg"        → { totalQty: 10,  baseUnit: 'kg' }
 *   "6 x 250 ML"             → { totalQty: 1.5, baseUnit: 'litro' }
 *   "Caja x 6 uds (250 ML)"  → { totalQty: 1.5, baseUnit: 'litro' }
 *   "5KG"                    → { totalQty: 5,   baseUnit: 'kg' }
 *   "500 G"                  → { totalQty: 0.5, baseUnit: 'kg' }
 *   "2.5 LT"                 → { totalQty: 2.5, baseUnit: 'litro' }
 *   "10 BOLSAS X 1 KG"       → { totalQty: 10,  baseUnit: 'kg' }
 */
export function parsePresentacion(str) {
  if (!str || typeof str !== 'string') return null

  // Normalizar: mayúsculas, punto decimal, quitar paréntesis
  const s = str.toUpperCase().replace(/,/g, '.').replace(/[()]/g, ' ')

  // Patrón de unidades reconocidas
  const UNITS = 'KGS?|KILOS?|GRS?|G|LTS?|L|LITROS?|ML|CC'
  const N = '(\\d+\\.?\\d*)'

  // Convierte cantidad + unidad raw a { totalQty, baseUnit }
  function toBase(qty, rawUnit) {
    const u = rawUnit.trim()
    if (/^(KGS?|KILOS?)$/.test(u)) return { totalQty: qty,        baseUnit: 'kg'    }
    if (/^(GRS?|G)$/.test(u))      return { totalQty: qty / 1000, baseUnit: 'kg'    }
    if (/^(LTS?|L|LITROS?)$/.test(u)) return { totalQty: qty,     baseUnit: 'litro' }
    if (/^(ML|CC)$/.test(u))       return { totalQty: qty / 1000, baseUnit: 'litro' }
    return null
  }

  // ── Patrón 1: N [palabras opcionales] × N UNIDAD ─────────────────────────
  // "10 BOLSAS X 1 KG", "6 X 250 ML", "BOLSA 10 X 1 KG", "10X1KG"
  // [A-Z\s]*? es lazy: consume el mínimo necesario para llegar al separador ×
  const m1 = s.match(new RegExp(
    `${N}\\s*[A-Z\\s]*?[X×]\\s*${N}\\s*(${UNITS})\\b`
  ))
  if (m1) {
    const n1 = parseFloat(m1[1]), n2 = parseFloat(m1[2])
    if (!isNaN(n1) && !isNaN(n2) && n1 > 0 && n2 > 0) {
      const r = toBase(n1 * n2, m1[3])
      if (r) return r
    }
  }

  // ── Patrón 2: × N [palabras] N UNIDAD (sin número inicial) ───────────────
  // "Caja x 6 uds (250 ML)" → el número de cuenta va DESPUÉS del ×
  const m2 = s.match(new RegExp(
    `[X×]\\s*${N}\\s*(?:[A-Z\\.]+\\s*)?${N}\\s*(${UNITS})\\b`
  ))
  if (m2) {
    const n1 = parseFloat(m2[1]), n2 = parseFloat(m2[2])
    if (!isNaN(n1) && !isNaN(n2) && n1 > 0 && n2 > 0) {
      const r = toBase(n1 * n2, m2[3])
      if (r) return r
    }
  }

  // ── Patrón 3: simple N UNIDAD ─────────────────────────────────────────────
  // "5KG", "500 G", "2.5 LT"
  const m3 = s.match(new RegExp(`${N}\\s*(${UNITS})\\b`))
  if (m3) {
    const qty = parseFloat(m3[1])
    if (!isNaN(qty) && qty > 0) {
      const r = toBase(qty, m3[2])
      if (r) return r
    }
  }

  return null
}
