'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react'

import {
  applyTheme,
  DEFAULT_THEME_SETTING,
  getSystemPrefersDark,
  readStoredThemeSetting,
  type ResolvedTheme,
  resolveTheme,
  storeThemeSetting,
  subscribeToThemeSetting,
  type ThemeSetting,
} from '@/shared/lib'

function subscribeToSystemPreference(callback: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

// Defined outside the component (matches React's own useSyncExternalStore
// docs example) — getSnapshot only needs to return a stable *value*, not a
// stable function reference, but keeping it a named top-level function
// avoids any doubt and matches the documented style exactly.
function getThemeSettingSnapshot(): ThemeSetting {
  return readStoredThemeSetting() ?? DEFAULT_THEME_SETTING
}

function getThemeSettingServerSnapshot(): ThemeSetting {
  return DEFAULT_THEME_SETTING
}

function getSystemPrefersDarkServerSnapshot(): boolean {
  return false
}

interface ThemeContextValue {
  setting: ThemeSetting
  resolvedTheme: ResolvedTheme
  setTheme: (setting: ThemeSetting) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export interface ThemeProviderProps {
  children: ReactNode
}

/**
 * Owns theme state via `useSyncExternalStore` — the React-blessed primitive
 * for "read a mutable external source (localStorage/matchMedia), assume an
 * SSR-safe default on the server, and resync on the client without a
 * setState-in-effect step (react-hooks/set-state-in-effect)." The actual
 * page styling doesn't wait on this component at all: the pre-hydration
 * `<Script>` in app/layout.tsx already applied the real `.dark` class before
 * first paint. This provider exists for React-rendered UI that needs to know
 * the resolved theme (e.g. a toggle's icon) — see
 * docs/frontend/brand-theme-and-tokens.md for the one-render "assume light,
 * correct after mount" caveat that applies to that kind of consumer.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const setting = useSyncExternalStore(
    subscribeToThemeSetting,
    getThemeSettingSnapshot,
    getThemeSettingServerSnapshot
  )
  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemPreference,
    getSystemPrefersDark,
    getSystemPrefersDarkServerSnapshot
  )

  const resolvedTheme = resolveTheme(setting, systemPrefersDark)

  const setTheme = useCallback((next: ThemeSetting) => {
    storeThemeSetting(next)
  }, [])

  // Pure DOM side effect reacting to the already-derived value — no
  // setState here, so this doesn't trigger set-state-in-effect.
  useEffect(() => {
    applyTheme(resolvedTheme)
  }, [resolvedTheme])

  return (
    <ThemeContext.Provider value={{ setting, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }

  return context
}
