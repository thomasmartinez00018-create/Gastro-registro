// Polyfill Promise.try para Chromium < 127 (Electron < 32)
// Este archivo es el entry point del worker — corre ANTES que pdfjs-dist
if (typeof Promise.try === 'undefined') {
  Promise.try = function (fn) {
    return new Promise(function (resolve, reject) {
      try { resolve(fn()) } catch (e) { reject(e) }
    })
  }
}

// Cargar el worker real de PDF.js
import 'pdfjs-dist/build/pdf.worker.min.mjs'
