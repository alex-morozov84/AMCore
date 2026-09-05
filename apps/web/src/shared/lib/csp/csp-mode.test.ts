// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCspMode } from './csp-mode'

vi.mock('server-only', () => ({}))

describe('getCspMode', () => {
  afterEach(() => {
    delete process.env.WEB_CSP_MODE
  })

  it('defaults to report-only when unset', () => {
    expect(getCspMode()).toBe('report-only')
  })

  it('honours an explicit "enforce" override', () => {
    process.env.WEB_CSP_MODE = 'enforce'
    expect(getCspMode()).toBe('enforce')
  })

  it('honours an explicit "report-only" override', () => {
    process.env.WEB_CSP_MODE = 'report-only'
    expect(getCspMode()).toBe('report-only')
  })

  it('throws on an unrecognized value — fails loudly on misconfiguration', () => {
    process.env.WEB_CSP_MODE = 'off'
    expect(() => getCspMode()).toThrow(/unsupported value/)
  })
})
