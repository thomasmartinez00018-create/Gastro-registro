// config.js — configuración de IA
// La API key viene de la variable de entorno (inyectada por Vite en build)
// En desarrollo usa .env.local, en producción viene del build de GitHub Actions

export const AI_PROVIDER = 'openai'
export const AI_MODEL    = 'gpt-5.4-nano'

// Vite inyecta import.meta.env.VITE_OPENAI_KEY en tiempo de build
const BUILT_IN_KEY = import.meta.env.VITE_OPENAI_KEY || ''

// Inicializar en localStorage si no hay key guardada
if (typeof window !== 'undefined' && !localStorage.getItem('openai_api_key') && BUILT_IN_KEY) {
  localStorage.setItem('openai_api_key', BUILT_IN_KEY)
}

export function getAIKey() {
  return localStorage.getItem('openai_api_key') || BUILT_IN_KEY
}
