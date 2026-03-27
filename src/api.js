// api.js — single entry point for all data operations
// Automatically uses Electron IPC or localStorage depending on environment

import { browserDB } from './browserDB'

const api = (typeof window !== 'undefined' && window.api) ? window.api : browserDB

export default api
