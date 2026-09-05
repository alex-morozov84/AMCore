import { describe, expect, it } from 'vitest'

import { buildCspDirectives } from './build-csp'

describe('buildCspDirectives', () => {
  it('includes the nonce in both script-src and style-src-elem', () => {
    const csp = buildCspDirectives({ nonce: 'test-nonce-123', isDev: false })
    expect(csp).toContain(`script-src 'self' 'nonce-test-nonce-123' 'strict-dynamic'`)
    expect(csp).toContain(`style-src-elem 'self' 'nonce-test-nonce-123'`)
  })

  it('never includes script-src unsafe-inline', () => {
    const csp = buildCspDirectives({ nonce: 'n', isDev: false })
    expect(csp).not.toContain(`script-src 'self' 'unsafe-inline'`)
  })

  it('adds unsafe-eval to script-src only in dev', () => {
    const dev = buildCspDirectives({ nonce: 'n', isDev: true })
    const prod = buildCspDirectives({ nonce: 'n', isDev: false })
    expect(dev).toContain(`'nonce-n' 'strict-dynamic' 'unsafe-eval'`)
    expect(prod).not.toContain('unsafe-eval')
  })

  it('adds upgrade-insecure-requests only in production', () => {
    const dev = buildCspDirectives({ nonce: 'n', isDev: true })
    const prod = buildCspDirectives({ nonce: 'n', isDev: false })
    expect(dev).not.toContain('upgrade-insecure-requests')
    expect(prod).toContain('upgrade-insecure-requests')
  })

  it('keeps style-src-attr as unsafe-inline pending browser-proven tightening', () => {
    const csp = buildCspDirectives({ nonce: 'n', isDev: false })
    expect(csp).toContain(`style-src-attr 'unsafe-inline'`)
  })

  it('denies framing and object embedding', () => {
    const csp = buildCspDirectives({ nonce: 'n', isDev: false })
    expect(csp).toContain(`frame-ancestors 'none'`)
    expect(csp).toContain(`object-src 'none'`)
  })

  it('covers the service worker and manifest origins', () => {
    const csp = buildCspDirectives({ nonce: 'n', isDev: false })
    expect(csp).toContain(`worker-src 'self'`)
    expect(csp).toContain(`manifest-src 'self'`)
  })

  it('is a single semicolon-terminated directive string with no stray newlines', () => {
    const csp = buildCspDirectives({ nonce: 'n', isDev: false })
    expect(csp).not.toMatch(/\n/)
    expect(csp.endsWith(';')).toBe(true)
  })
})
