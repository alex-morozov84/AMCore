import { createHash } from 'node:crypto'

import { frontendPlacementPayload, WEB_FRONTEND_HEADERS } from '@amcore/shared'

import type { EnvService } from '../../env/env.service'

import { browserFrontendContext, FrontendContextService } from './frontend-context.service'
import { canonicalFrontendOrigin, resolveFrontendPlacement } from './frontend-placement'

const key = '<fake-test-context-key-at-least-32-characters>'
const site = 'https://site.example'
const hash = createHash('sha256').update(frontendPlacementPayload(site, site)).digest('hex')
const environment = (values: Record<string, string | undefined>) =>
  ({
    get: (name: string) => values[name],
  }) as Pick<EnvService, 'get'>
const env = environment({ FRONTEND_URL: site, WEB_FRONTEND_CONTEXT_KEY: key })
const valid = {
  [WEB_FRONTEND_HEADERS.frontend]: 'admin',
  [WEB_FRONTEND_HEADERS.placement]: hash,
  [WEB_FRONTEND_HEADERS.key]: key,
}

describe('trusted browser frontend selection', () => {
  it('keeps absent context native/site and records only proved requests', () => {
    const service = new FrontendContextService(env as EnvService)
    const request = {}
    service.verify(request, {})
    expect(browserFrontendContext(request)).toBeUndefined()
    service.verify(request, valid)
    expect(browserFrontendContext(request)).toEqual({
      frontend: 'admin',
      placementFingerprint: hash,
    })
  })

  it.each([
    { ...valid, [WEB_FRONTEND_HEADERS.key]: 'incorrect' },
    { ...valid, [WEB_FRONTEND_HEADERS.frontend]: ['admin', 'site'] },
    { ...valid, [WEB_FRONTEND_HEADERS.placement]: undefined },
    { ...valid, [WEB_FRONTEND_HEADERS.frontend]: 'admin,site' },
  ])('rejects invalid/partial/duplicate proof before selection: %p', (headers) => {
    const request = {}
    expect(() => new FrontendContextService(env as EnvService).verify(request, headers)).toThrow()
    expect(browserFrontendContext(request)).toBeUndefined()
  })

  it('reports placement disagreement separately from invalid proof', () => {
    const service = new FrontendContextService(env as EnvService)
    expect(() =>
      service.verify({}, { ...valid, [WEB_FRONTEND_HEADERS.placement]: 'a'.repeat(64) })
    ).toThrow('Frontend configuration unavailable')
  })

  it('rejects missing key for context requests, retaining API-only use', () => {
    const service = new FrontendContextService(environment({ FRONTEND_URL: site }) as EnvService)
    expect(() => service.verify({}, valid)).toThrow('Invalid frontend context')
    expect(() => service.verify({}, {})).not.toThrow()
  })
})

describe('origin/hostname placement contract', () => {
  const host = { version: 1, mode: 'host', alias: 'manage' } as const
  it('refuses same hostname on different ports', () => {
    expect(() =>
      resolveFrontendPlacement(
        environment({ FRONTEND_URL: site, PRODUCT_ADMIN_ORIGIN: `${site}:8443` }),
        host
      )
    ).toThrow('distinct hostname')
  })

  it('permits distinct names with nondefault HTTPS ports', () => {
    expect(
      resolveFrontendPlacement(
        environment({
          FRONTEND_URL: `${site}:8443`,
          PRODUCT_ADMIN_ORIGIN: 'https://office.example:9443',
        }),
        host
      ).admin
    ).toBe('https://office.example:9443')
  })

  it.each([
    'https://site.example/',
    'https://site.example./',
    'https://user@site.example',
    'https://site.example/path',
    'https://site.example:443',
    'http://site.example',
  ])('rejects noncanonical or insecure origin: %s', (value) => {
    expect(() => canonicalFrontendOrigin(value, true)).toThrow()
  })
})
