// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCspMode } from './csp-mode'

vi.mock('server-only', () => ({}))

describe('getCspMode', () => {
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    delete process.env.WEB_CSP_MODE
    vi.stubEnv('NODE_ENV', originalNodeEnv ?? 'test')
  })

  it('defaults to report-only in development, unset', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(getCspMode()).toBe('report-only')
  })

  it('defaults to enforce outside development, unset', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(getCspMode()).toBe('enforce')
  })

  it('honours an explicit "enforce" override in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    process.env.WEB_CSP_MODE = 'enforce'
    expect(getCspMode()).toBe('enforce')
  })

  it('honours an explicit "report-only" override in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.WEB_CSP_MODE = 'report-only'
    expect(getCspMode()).toBe('report-only')
  })

  it('throws on an unrecognized value — fails loudly on misconfiguration', () => {
    process.env.WEB_CSP_MODE = 'off'
    expect(() => getCspMode()).toThrow(/unsupported value/)
  })
})
