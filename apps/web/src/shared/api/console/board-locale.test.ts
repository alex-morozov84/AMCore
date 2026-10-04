// @vitest-environment node
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@amcore/shared'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { getConsoleBackgroundWorkHref } from '@/shared/lib/console-public-href'

import { consoleBackgroundWorkPath, readBoardLocale } from './board-locale'

const request = (cookie?: string) =>
  new Request('https://console.example.test/api/console/bull-board/', {
    headers: cookie ? { cookie } : {},
  })

describe('board locale', () => {
  it.each(SUPPORTED_LOCALES)(
    'reads %s from the NEXT_LOCALE cookie among other cookies',
    (locale) => {
      expect(readBoardLocale(request(`a=1; NEXT_LOCALE=${locale}; b=2`))).toBe(locale)
    }
  )

  it('falls back to the default locale for an absent or unknown cookie value', () => {
    for (const cookie of [undefined, 'NEXT_LOCALE=de', 'NEXT_LOCALE=', 'other=1']) {
      expect(readBoardLocale(request(cookie))).toBe(DEFAULT_LOCALE)
    }
  })

  it.each(SUPPORTED_LOCALES)(
    'points a document that cannot be shown at the Background work page (%s)',
    (locale) => {
      const href = getConsoleBackgroundWorkHref()
      // With one locale there is no prefix; with several, the visitor's own.
      const expected = SUPPORTED_LOCALES.length > 1 ? `/${locale}${href}` : href
      expect(consoleBackgroundWorkPath(request(`NEXT_LOCALE=${locale}`))).toBe(expected)
    }
  )
})
