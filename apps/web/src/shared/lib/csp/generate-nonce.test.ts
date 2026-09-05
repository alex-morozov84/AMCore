// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { generateNonce } from './generate-nonce'

vi.mock('server-only', () => ({}))

describe('generateNonce', () => {
  it('returns a base64 string', () => {
    const nonce = generateNonce()
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('is unique per call', () => {
    const first = generateNonce()
    const second = generateNonce()
    expect(first).not.toBe(second)
  })

  it('decodes back to a valid UUID', () => {
    const nonce = generateNonce()
    const decoded = Buffer.from(nonce, 'base64').toString('utf-8')
    expect(decoded).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })
})
