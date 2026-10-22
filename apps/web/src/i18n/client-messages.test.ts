import type { AbstractIntlMessages } from 'next-intl'
import { SUPPORTED_LOCALES } from '@amcore/shared'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ messages: {} as AbstractIntlMessages }))
vi.mock('server-only', () => ({}))
vi.mock('next-intl/server', () => ({ getMessages: async () => state.messages }))

import { getClientMessages, ROUTE_SCOPED_NAMESPACES } from './client-messages'

describe('getClientMessages', () => {
  it.each(SUPPORTED_LOCALES)(
    'keeps every %s namespace except the route-scoped ones, unchanged',
    async (locale) => {
      state.messages = (await import(`../../messages/${locale}.json`)).default
      const result = await getClientMessages()

      for (const namespace of ROUTE_SCOPED_NAMESPACES) expect(result).not.toHaveProperty(namespace)
      const kept = Object.keys(state.messages).filter((n) => !ROUTE_SCOPED_NAMESPACES.includes(n))
      expect(Object.keys(result).sort()).toEqual(kept.sort())
      for (const namespace of kept) expect(result[namespace]).toBe(state.messages[namespace])
    }
  )

  it('returns the catalogue as is when it has no route-scoped namespace', async () => {
    state.messages = { common: { close: 'Close' }, errors: { generic: 'Error' } }
    expect(await getClientMessages()).toEqual(state.messages)
  })
})
