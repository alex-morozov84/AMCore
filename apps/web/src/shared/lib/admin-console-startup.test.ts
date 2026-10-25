// @vitest-environment node
import type * as Shared from '@amcore/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@amcore/shared', async (original) => {
  const actual = await original<typeof Shared>()
  return { ...actual, PRODUCT_ADMIN_CONFIG: { ...actual.PRODUCT_ADMIN_CONFIG, mode: 'host' } }
})

import { ADMIN_CONSOLE_CONFIG } from './admin-console.generated'
import { validateAdminConsoleStartupOrExit } from './admin-console-startup'

const config = ADMIN_CONSOLE_CONFIG as unknown as { mode: 'path' | 'host' | 'disabled' }
const originalMode = config.mode

beforeEach(() => {
  config.mode = 'host'
  vi.stubEnv('FRONTEND_URL', 'https://shop.example.test:8443')
  vi.stubEnv('PRODUCT_ADMIN_ORIGIN', 'https://staff.example.test:8443')
  vi.stubEnv('ADMIN_CONSOLE_HOSTNAME', 'console.example.test')
  vi.stubEnv('ADMIN_CONSOLE_ORIGIN', 'https://console.example.test:8443')
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('startup refused')
  })
})
afterEach(() => {
  config.mode = originalMode
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('separate Console hostname startup invariant', () => {
  it.each(['shop', 'staff'])('rejects reuse of %s hostname even on another port', (hostname) => {
    vi.stubEnv('ADMIN_CONSOLE_HOSTNAME', `${hostname}.example.test`)
    vi.stubEnv('ADMIN_CONSOLE_ORIGIN', `https://${hostname}.example.test:9443`)
    expect(() => validateAdminConsoleStartupOrExit()).toThrow('startup refused')
    expect(process.exit).toHaveBeenCalledWith(1)
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('different hostname'))
  })

  it('retains log-search validation with three distinct hostnames', () => {
    vi.stubEnv('ADMIN_CONSOLE_LOGS_GRAFANA_URL', 'https://user:password@example.test')
    expect(() => validateAdminConsoleStartupOrExit()).toThrow('startup refused')
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('ADMIN_CONSOLE_LOGS_GRAFANA_URL')
    )
  })

  it('rejects an incompatible contextual metrics target without leaking its value', () => {
    vi.stubEnv(
      'ADMIN_CONSOLE_METRICS_GRAFANA_URL',
      'https://metrics.example.test/explore?private=example'
    )
    expect(() => validateAdminConsoleStartupOrExit()).toThrow('startup refused')
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('ADMIN_CONSOLE_METRICS_GRAFANA_URL')
    )
    expect(process.stderr.write).not.toHaveBeenCalledWith(
      expect.stringContaining('private=example')
    )
  })

  it('accepts three distinct hostnames with one shared TLS port', () => {
    expect(() => validateAdminConsoleStartupOrExit()).not.toThrow()
    expect(process.exit).not.toHaveBeenCalled()
  })
})
