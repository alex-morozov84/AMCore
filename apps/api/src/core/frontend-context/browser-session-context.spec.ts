import { BROWSER_AUTH_HEADERS as H } from '@amcore/shared'

import type { EnvService } from '../../env/env.service.js'
import { hashBrowserBinding } from '../auth/mfa/browser-binding.js'

import {
  browserSessionContext,
  BrowserSessionContextService,
} from './browser-session-context.service.js'

const key = '<fake-private-bff-key-at-least-32-characters>'
const binding = 'a'.repeat(43)
const headers = {
  [H.key]: key,
  [H.audience]: 'product',
  [H.binding]: binding,
  [H.contextId]: 'browser-context',
  [H.generation]: '4',
}
function service(value: string | null = key) {
  return new BrowserSessionContextService({
    get: () => value ?? undefined,
  } as unknown as EnvService)
}

describe('Authenticated BFF browser transport', () => {
  it('retains separate product/staff/console namespaces without granting an actor', () => {
    for (const audience of ['product', 'staff', 'console']) {
      const request = {}
      service().verify(request, { ...headers, [H.audience]: audience })
      expect(browserSessionContext(request)).toEqual({
        audience,
        binding: {
          audience,
          bindingHash: hashBrowserBinding(binding),
          contextId: 'browser-context',
          generation: 4,
        },
      })
      expect(JSON.stringify(browserSessionContext(request))).not.toContain(binding)
      expect(Object.isFrozen(browserSessionContext(request))).toBe(true)
    }
  })

  it('keeps bootstrap account-neutral and direct clients unclassified by Origin', () => {
    const bootstrap = {}
    service().verify(bootstrap, { [H.key]: key, [H.audience]: 'product' })
    expect(browserSessionContext(bootstrap)).toEqual({ audience: 'product', binding: null })
    const direct = {}
    service(null).verify(direct, { origin: 'https://example.test' })
    expect(browserSessionContext(direct)).toBeUndefined()
  })

  it.each([
    { ...headers, [H.key]: undefined },
    { ...headers, [H.key]: 'incorrect' },
    { ...headers, [H.key]: [key, key] },
    { ...headers, [H.audience]: 'site' },
    { ...headers, [H.audience]: ['product', 'console'] },
    { ...headers, [H.binding]: undefined },
    { ...headers, [H.binding]: 'short' },
    { ...headers, [H.contextId]: undefined },
    { ...headers, [H.generation]: '04' },
    { ...headers, [H.generation]: '4,5' },
    { ...headers, [H.generation]: ['4', '5'] },
    { ...headers, [H.generation]: '2147483648' },
  ])(
    'rejects partial, spoofed or duplicate context without a previous-context fallback',
    (incoming) => {
      const request = {}
      const verifier = service()
      verifier.verify(request, headers)
      expect(() => verifier.verify(request, incoming)).toThrow('Invalid browser context')
      expect(browserSessionContext(request)).toBeUndefined()
    }
  )

  it('rejects browser proofs when the private transport key is not configured', () => {
    expect(() => service(null).verify({}, headers)).toThrow('Invalid browser context')
  })
})
