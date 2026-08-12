'use client'

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import type { UserResponse } from '@amcore/shared'
import { useStore } from 'zustand'

import { setAccessToken } from '@/shared/api'

import { type AuthState, type AuthStore, createAuthStore, defaultAuthState } from '../stores/auth'

/**
 * Same-origin, cookie-based (`amcore_session`) — goes through the BFF's
 * generic authenticated proxy (`app/api/[...path]/route.ts`), not the old
 * cross-origin axios `apiClient` (in-memory token, wiped on every full page
 * load/reload). This is a deliberately narrow fix: only the mount-time
 * auth-status check is rewired here, so a session minted server-side (e.g.
 * by the OAuth exchange handler, which never touches `apiClient`'s in-memory
 * token) is actually recognized. Every other `apiClient`-based call
 * (logout, profile update, sessions list) still goes through the old path
 * pending the full UI rewiring slice — see `ai/models-talk.md`.
 */
async function fetchCurrentUserViaBff(): Promise<UserResponse> {
  const response = await fetch('/api/auth/me')
  if (!response.ok) {
    throw new Error(`GET /api/auth/me failed with status ${response.status}`)
  }
  // `profileResponseSchema.user` is nullable (a valid access token whose
  // user no longer exists) — an unchecked cast here would let a `null`
  // through to `store.login(user)` and report `status: 'authenticated'`
  // with no user.
  const { user } = (await response.json()) as { user: UserResponse | null }
  if (!user) {
    throw new Error('GET /api/auth/me returned no user')
  }
  return user
}

type AuthStoreApi = ReturnType<typeof createAuthStore>

const AuthStoreContext = createContext<AuthStoreApi | undefined>(undefined)

export interface AuthStoreProviderProps {
  children: ReactNode
  initialState?: Partial<AuthState>
}

export function AuthStoreProvider({ children, initialState }: AuthStoreProviderProps) {
  const [store] = useState(() =>
    createAuthStore({
      ...defaultAuthState,
      ...initialState,
    })
  )

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      store.getState().setStatus('loading')
      try {
        const user = await fetchCurrentUserViaBff()
        store.getState().login(user)
      } catch {
        store.getState().logout()
        setAccessToken(null)
      }
    }

    checkAuth()
  }, [store])

  return <AuthStoreContext.Provider value={store}>{children}</AuthStoreContext.Provider>
}

export function useAuthStore<T>(selector: (state: AuthStore) => T): T {
  const store = useContext(AuthStoreContext)

  if (!store) {
    throw new Error('useAuthStore must be used within AuthStoreProvider')
  }

  return useStore(store, selector)
}
