// utils/whatsapp.js — Helpers para pedidos por WhatsApp

/**
 * Normaliza un número de WhatsApp argentino y construye el link wa.me
 * Acepta: "1145678901", "011 4567-8901", "+54 11 4567 8901", etc.
 */
export function buildWALink(whatsapp, message) {
  if (!whatsapp) return null
  let num = String(whatsapp).replace(/\D/g, '')      // solo dígitos

  // Quitar prefijo 0 inicial (ej: "0115678901" → "115678901")
  if (num.startsWith('0')) num = num.slice(1)

  // Normalizar a formato wa.me argentino: 549XXXXXXXXXX
  // WhatsApp AR móvil requiere 549 (54 = país, 9 = móvil)
  if (num.startsWith('549')) {
    // ya tiene el formato correcto
  } else if (num.startsWith('54')) {
    // tiene código país pero falta el 9 de móvil
    num = '549' + num.slice(2)
  } else {
    // número local sin código país
    num = '549' + num
  }

  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`
}

/**
 * Construye el texto del pedido para WhatsApp
 */
export function buildOrderMessage({ restaurante, proveedor, fecha, items, total }) {
  const d = fecha
    ? new Date(fecha + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })

  let msg = `🛒 *Pedido${restaurante ? ` - ${restaurante}` : ''}*\n`
  msg += `📅 ${d}\n`
  if (proveedor) msg += `🚚 ${proveedor}\n`
  msg += '\n'

  items.forEach(it => {
    const cant = it.cantidad != null ? Number(it.cantidad) : 1
    const unidad = it.unidadLabel || it.unidad_base || it.unidad || ''
    msg += `• ${it.producto} × ${cant}${unidad ? ' ' + unidad : ''}\n`
  })

  if (total > 0) {
    const totalFmt = new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
    }).format(total)
    msg += `\n💰 *Total estimado: ${totalFmt}*\n`
  }

  msg += `\n¡Muchas gracias! 🙏`
  return msg
}
