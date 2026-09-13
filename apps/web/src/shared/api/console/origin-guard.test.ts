import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { isTrustedConsoleOrigin } from './origin-guard'

const mutableConfig = ADMIN_CONSOLE_CONFIG as { mode: 'disabled' | 'path' | 'host' }
const originalMode = ADMIN_CONSOLE_CONFIG.mode

afterEach(() => {
  mutableConfig.mode = originalMode
  delete process.env.ADMIN_CONSOLE_HOSTNAME
})

describe('isTrustedConsoleOrigin', () => {
  it('accepts only the configured HTTPS console origin', () => {
    mutableConfig.mode = 'host'
    process.env.ADMIN_CONSOLE_HOSTNAME = 'console.example.test'

    expect(
      isTrustedConsoleOrigin(
        new Request('https://console.example.test/api/auth/login', {
          headers: { origin: 'https://console.example.test' },
        })
      )
    ).toBe(true)
  })

  it.each(['https://app.example.test', 'https://console.example.test:8443'])(
    'rejects a different origin: %s',
    (origin) => {
      mutableConfig.mode = 'host'
      process.env.ADMIN_CONSOLE_HOSTNAME = 'console.example.test'

      expect(
        isTrustedConsoleOrigin(new Request('https://console.example.test', { headers: { origin } }))
      ).toBe(false)
    }
  )

  it('rejects a state-changing request with no browser origin', () => {
    mutableConfig.mode = 'host'
    process.env.ADMIN_CONSOLE_HOSTNAME = 'console.example.test'

    expect(isTrustedConsoleOrigin(new Request('https://console.example.test'))).toBe(false)
  })
})
