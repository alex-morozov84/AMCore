'use client';

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { authApi, setAccessToken } from '@/shared/api';

import { type AuthState, type AuthStore, createAuthStore, defaultAuthState } from '../stores/auth';

type AuthStoreApi = ReturnType<typeof createAuthStore>;

const AuthStoreContext = createContext<AuthStoreApi | undefined>(undefined);

export interface AuthStoreProviderProps {
  children: ReactNode;
  initialState?: Partial<AuthState>;
}

export function AuthStoreProvider({ children, initialState }: AuthStoreProviderProps) {
  const [store] = useState(() =>
    createAuthStore({
      ...defaultAuthState,
      ...initialState,
    })
  );

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      store.getState().setStatus('loading');
      try {
        const { user } = await authApi.getMe();
        store.getState().login(user);
      } catch {
        store.getState().logout();
        setAccessToken(null);
      }
    };

    checkAuth();
  }, [store]);

  return <AuthStoreContext.Provider value={store}>{children}</AuthStoreContext.Provider>;
}

export function useAuthStore<T>(selector: (state: AuthStore) => T): T {
  const store = useContext(AuthStoreContext);

  if (!store) {
    throw new Error('useAuthStore must be used within AuthStoreProvider');
  }

  return useStore(store, selector);
}
