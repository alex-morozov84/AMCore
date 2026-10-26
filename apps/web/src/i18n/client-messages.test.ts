import type { AbstractIntlMessages } from 'next-intl'
import { SUPPORTED_LOCALES } from '@amcore/shared'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ messages: {} as AbstractIntlMessages }))
vi.mock('server-only', () => ({}))
vi.mock('next-intl/server', () => ({ getMessages: async () => state.messages }))

import { getClientMessages } from './client-messages'
import {
  mergeClientMessages,
  ROOT_CLIENT_NAMESPACES,
  selectMessageNamespaces,
} from './message-selection'

const core = { common: { close: 'Close' }, errors: {}, validation: {}, locale: {} }

describe('explicit client messages', () => {
  it.each(SUPPORTED_LOCALES)('selects only the root core for %s', async (locale) => {
    state.messages = (await import(`../../messages/${locale}.json`)).default
    const result = await getClientMessages(ROOT_CLIENT_NAMESPACES)
    expect(Object.keys(result)).toEqual([...ROOT_CLIENT_NAMESPACES])
    for (const name of ROOT_CLIENT_NAMESPACES) expect(result[name]).toBe(state.messages[name])
  })

  it('does not deliver a newly added namespace without selection', () => {
    const messages = { ...core, newProduct: { secretHeading: 'Only for a new section' } }
    expect(selectMessageNamespaces(messages, ROOT_CLIENT_NAMESPACES)).toEqual(core)
  })

  it('rejects duplicate input before object construction can collapse it', () => {
    expect(() => selectMessageNamespaces(core, ['common', 'common'])).toThrow(
      'repeats namespace: common'
    )
  })

  it('rejects empty or missing selections instead of loading everything', () => {
    expect(() => selectMessageNamespaces(core, [])).toThrow('requires a namespace selection')
    expect(() => selectMessageNamespaces(core, ['auth'])).toThrow('unknown namespace: auth')
  })

  it('rejects overlap even when the parent value is equal', () => {
    expect(() => mergeClientMessages(core, { common: core.common })).toThrow(
      'shadows parent namespace: common'
    )
  })

  it('merges locally without retaining messages from a departed sibling', () => {
    const first = mergeClientMessages(core, { auth: { login: 'Sign in' } })
    const second = mergeClientMessages(core, { ownApiKeys: { title: 'Keys' } })
    expect(first).toHaveProperty('auth')
    expect(second).not.toHaveProperty('auth')
    expect(core).not.toHaveProperty('ownApiKeys')
  })
})
