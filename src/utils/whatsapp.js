// utils/whatsapp.js — Helpers para pedidos por WhatsApp

/**
 * Normaliza un número de WhatsApp argentino y construye el link wa.me
 * Acepta: "1145678901", "011 4567-8901", "+54 11 4567 8901", etc.
 */
export function buildWALink(whatsapp, message) {
  if (!whatsapp) return null
  let num = String(whatsapp).replace(/\D/g, '')      // solo dígitos
  if (num.startsWith('0')) num = num.slice(1)         // quitar 0 inicial
  if (!num.startsWith('54') && num.length >= 8) num = '54' + num  // agregar código AR
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
