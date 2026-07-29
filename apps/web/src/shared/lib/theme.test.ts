import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { contrastRatio, WCAG_AA_NORMAL_TEXT } from './contrast'
import {
  applyTheme,
  DEFAULT_THEME_SETTING,
  getThemeInitScript,
  isThemeSetting,
  readStoredThemeSetting,
  resolveTheme,
  storeThemeSetting,
  subscribeToThemeSetting,
  THEME_STORAGE_KEY,
} from './theme'

describe('resolveTheme', () => {
  it('returns the explicit setting regardless of system preference for light/dark', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows system preference when the setting is "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('applyTheme', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = ''
  })

  it('adds the dark class and sets color-scheme for "dark"', () => {
    applyTheme('dark')

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('removes the dark class and sets color-scheme for "light"', () => {
    document.documentElement.classList.add('dark')

    applyTheme('light')

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})

describe('isThemeSetting', () => {
  it('accepts "light", "dark", and "system"', () => {
    expect(isThemeSetting('light')).toBe(true)
    expect(isThemeSetting('dark')).toBe(true)
    expect(isThemeSetting('system')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isThemeSetting('blue')).toBe(false)
    expect(isThemeSetting(null)).toBe(false)
    expect(isThemeSetting(undefined)).toBe(false)
    expect(isThemeSetting(42)).toBe(false)
  })
})

describe('storeThemeSetting / subscribeToThemeSetting', () => {
  afterEach(() => {
    window.localStorage.removeItem(THEME_STORAGE_KEY)
  })

  it('notifies same-tab subscribers immediately (storage events do not fire in the writing tab)', () => {
    const callback = vi.fn()
    const unsubscribe = subscribeToThemeSetting(callback)

    storeThemeSetting('dark')

    expect(callback).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    unsubscribe()
  })

  it('stops notifying after unsubscribe', () => {
    const callback = vi.fn()
    const unsubscribe = subscribeToThemeSetting(callback)
    unsubscribe()

    storeThemeSetting('light')

    expect(callback).not.toHaveBeenCalled()
  })
})

describe('storage failure resilience', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.removeItem(THEME_STORAGE_KEY)
  })

  it('readStoredThemeSetting falls back to null when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })

    expect(() => readStoredThemeSetting()).not.toThrow()
    expect(readStoredThemeSetting()).toBeNull()
  })

  it('storeThemeSetting does not throw when localStorage.setItem throws, and does not notify subscribers', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    })
    const callback = vi.fn()
    const unsubscribe = subscribeToThemeSetting(callback)

    expect(() => storeThemeSetting('dark')).not.toThrow()
    expect(callback).not.toHaveBeenCalled()

    unsubscribe()
  })
})

describe('getThemeInitScript', () => {
  afterEach(() => {
    window.localStorage.removeItem(THEME_STORAGE_KEY)
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = ''
  })

  it('embeds the current storage key and default setting (drift guard vs. theme.ts)', () => {
    const script = getThemeInitScript()

    expect(script).toContain(JSON.stringify(THEME_STORAGE_KEY))
    expect(script).toContain(JSON.stringify(DEFAULT_THEME_SETTING))
  })

  it('runs and applies the stored setting when executed as a real script', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')

    expect(() => new Function(getThemeInitScript())()).not.toThrow()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('falls back to the default setting when nothing is stored', () => {
    new Function(getThemeInitScript())()

    const expectedDark =
      DEFAULT_THEME_SETTING === 'dark' ||
      (DEFAULT_THEME_SETTING === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    expect(document.documentElement.classList.contains('dark')).toBe(expectedDark)
  })
})

describe('token contrast (WCAG AA)', () => {
  // Parses the actual shipped globals.css rather than duplicating hex values
  // here — a hand-copied palette would silently drift from the real tokens.
  const globalsCssPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../app/globals.css'
  )
  const globalsCss = readFileSync(globalsCssPath, 'utf-8')

  function extractBlock(selector: string): string {
    const match = globalsCss.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))
    if (!match) {
      throw new Error(`Could not find a "${selector} { ... }" block in globals.css`)
    }
    return match[1]
  }

  function extractToken(block: string, name: string): string {
    const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
    if (!match) {
      throw new Error(`Could not find --${name} in the given globals.css block`)
    }
    return match[1]
  }

  const lightBlock = extractBlock(':root')
  const darkBlock = extractBlock('\\.dark')

  const pairs: Array<[string, string]> = [
    ['background', 'foreground'],
    ['card', 'card-foreground'],
    ['popover', 'popover-foreground'],
    ['primary', 'primary-foreground'],
    ['secondary', 'secondary-foreground'],
    ['muted', 'muted-foreground'],
    ['accent', 'accent-foreground'],
    ['success-soft', 'success'],
    ['warning-soft', 'warning'],
    ['info-soft', 'info'],
    ['danger-soft', 'danger'],
  ]

  describe.each(pairs)('%s / %s', (bgName, fgName) => {
    it(`passes WCAG AA (${WCAG_AA_NORMAL_TEXT}:1) in light mode`, () => {
      const bg = extractToken(lightBlock, bgName)
      const fg = extractToken(lightBlock, fgName)
      expect(contrastRatio(bg, fg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT)
    })

    it(`passes WCAG AA (${WCAG_AA_NORMAL_TEXT}:1) in dark mode`, () => {
      const bg = extractToken(darkBlock, bgName)
      const fg = extractToken(darkBlock, fgName)
      expect(contrastRatio(bg, fg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT)
    })
  })
})
