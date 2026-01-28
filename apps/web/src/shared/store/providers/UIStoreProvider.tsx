'use client';

import { createContext, type ReactNode, useContext, useRef } from 'react';
import { useStore } from 'zustand';

import { createUIStore, defaultUIState, type UIState, type UIStore } from '../stores/ui';

type UIStoreApi = ReturnType<typeof createUIStore>;

const UIStoreContext = createContext<UIStoreApi | undefined>(undefined);

export interface UIStoreProviderProps {
  children: ReactNode;
  initialState?: Partial<UIState>;
}

export function UIStoreProvider({ children, initialState }: UIStoreProviderProps) {
  const storeRef = useRef<UIStoreApi | null>(null);

  if (storeRef.current === null) {
    storeRef.current = createUIStore({
      ...defaultUIState,
      ...initialState,
    });
  }

  return <UIStoreContext.Provider value={storeRef.current}>{children}</UIStoreContext.Provider>;
}

export function useUIStore<T>(selector: (state: UIStore) => T): T {
  const store = useContext(UIStoreContext);

  if (!store) {
    throw new Error('useUIStore must be used within UIStoreProvider');
  }

  return useStore(store, selector);
}
