import type { UserResponse } from '@amcore/shared'
import { createStore } from 'zustand'

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthState {
  user: UserResponse | null
  status: AuthStatus
}

export interface AuthActions {
  setUser: (user: UserResponse | null) => void
  setStatus: (status: AuthStatus) => void
  login: (user: UserResponse) => void
  logout: () => void
}

export type AuthStore = AuthState & AuthActions

export const defaultAuthState: AuthState = {
  user: null,
  status: 'idle',
}

export const createAuthStore = (initState: AuthState = defaultAuthState) => {
  return createStore<AuthStore>()((set) => ({
    ...initState,
    setUser: (user) => set({ user }),
    setStatus: (status) => set({ status }),
    login: (user) => set({ user, status: 'authenticated' }),
    logout: () => set({ user: null, status: 'unauthenticated' }),
  }))
}
