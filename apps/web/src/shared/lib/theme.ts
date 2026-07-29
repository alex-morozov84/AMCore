export const THEME_STORAGE_KEY = 'amcore-theme'

export type ThemeSetting = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const DEFAULT_THEME_SETTING: ThemeSetting = 'system'

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): ResolvedTheme {
  if (setting === 'system') {
    return prefersDark ? 'dark' : 'light'
  }
  return setting
}

export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function readStoredThemeSetting(): ThemeSetting | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeSetting(stored) ? stored : null
  } catch {
    // Storage access denied (e.g. browser privacy mode, disabled storage,
    // sandboxed iframe) — fall back to the caller's default instead of
    // crashing hydration/render. Matches the inline init script's own
    // try/catch guard.
    return null
  }
}

// Native `storage` events only fire in *other* tabs, never the tab that
// wrote the value — this emitter notifies same-tab subscribers (see
// ThemeProvider's useSyncExternalStore) so a local `setTheme()` call is
// reflected immediately without a manual setState-in-effect.
const THEME_SETTING_CHANGE_EVENT = 'amcore-theme-change'
const themeSettingEmitter = typeof window !== 'undefined' ? new EventTarget() : null

export function storeThemeSetting(setting: ThemeSetting): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, setting)
  } catch {
    // Storage denied/full — keep the current resolved theme and avoid
    // notifying subscribers of a "change" that did not actually persist.
    return
  }
  themeSettingEmitter?.dispatchEvent(new Event(THEME_SETTING_CHANGE_EVENT))
}

/** Subscribes to both cross-tab (`storage`) and same-tab theme-setting changes. */
export function subscribeToThemeSetting(callback: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      callback()
    }
  }
  window.addEventListener('storage', handleStorage)
  themeSettingEmitter?.addEventListener(THEME_SETTING_CHANGE_EVENT, callback)
  return () => {
    window.removeEventListener('storage', handleStorage)
    themeSettingEmitter?.removeEventListener(THEME_SETTING_CHANGE_EVENT, callback)
  }
}

export function getSystemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Vanilla-JS source for the pre-hydration `<Script>` (see app/layout.tsx).
 * Runs before React, so it can't import this module — it's generated from
 * the same constants instead, so the storage key/setting values can't drift
 * from the TypeScript helpers above.
 */
export function getThemeInitScript(): string {
  return `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var s=localStorage.getItem(k);var setting=(s==='light'||s==='dark'||s==='system')?s:${JSON.stringify(DEFAULT_THEME_SETTING)};var dark=setting==='dark'||(setting==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',dark);r.style.colorScheme=dark?'dark':'light'}catch(e){}})()`
}
