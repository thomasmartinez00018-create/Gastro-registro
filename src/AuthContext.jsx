import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [token,   setToken]   = useState(() => localStorage.getItem('auth_token'))
  const [loading, setLoading] = useState(true)

  // Validar token al montar
  useEffect(() => {
    if (!token) { setLoading(false); return }
    api.auth.validate(token).then(res => {
      if (res.ok) setUser(res.user)
      else { localStorage.removeItem('auth_token'); setToken(null) }
    }).catch(() => {
      localStorage.removeItem('auth_token'); setToken(null)
    }).finally(() => setLoading(false))
  }, []) // eslint-disable-line

  const login = useCallback(async (username, password) => {
    const res = await api.auth.login({ username, password })
    if (res.ok) {
      setToken(res.token)
      setUser(res.user)
      localStorage.setItem('auth_token', res.token)
    }
    return res
  }, [])

  const logout = useCallback(() => {
    api.auth.logout?.()
    setUser(null)
    setToken(null)
    localStorage.removeItem('auth_token')
  }, [])

  const isAdmin = user?.role === 'admin'

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAdmin, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
