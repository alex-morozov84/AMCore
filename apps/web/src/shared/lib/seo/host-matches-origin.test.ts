import { describe, expect, it } from 'vitest'

import { hostMatchesOrigin } from './host-matches-origin'

describe('hostMatchesOrigin', () => {
  it.each([
    ['example.com', 'https://example.com', true],
    ['example.com:8443', 'https://example.com:8443', true],
    ['localhost:3002', 'http://localhost:3002', true],
    // The port is part of the authority: a missing or different port is a different site.
    ['example.com', 'https://example.com:8443', false],
    ['example.com:8443', 'https://example.com', false],
    ['example.com:444', 'https://example.com:443', false],
    // Another host, a sub-domain and a look-alike never match.
    ['www.example.com', 'https://example.com', false],
    ['example.com.evil.test', 'https://example.com', false],
    ['evil.test', 'https://example.com', false],
    // Case-exact, like the Console guard this function was extracted from.
    ['Example.com', 'https://example.com', false],
  ])('host %p against origin %p is %p', (host, origin, expected) => {
    expect(hostMatchesOrigin(host, origin)).toBe(expected)
  })

  it.each([null, undefined, ''])('refuses a missing host %p', (host) => {
    expect(hostMatchesOrigin(host, 'https://example.com')).toBe(false)
  })
})
