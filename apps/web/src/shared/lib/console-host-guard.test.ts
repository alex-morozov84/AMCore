import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { ADMIN_CONSOLE_CONFIG } from './admin-console.generated'
import { isConsoleHost, withConsoleHostGuard } from './console-host-guard'

const mutableConfig = ADMIN_CONSOLE_CONFIG as unknown as {
  enabled: boolean
  mode: 'disabled' | 'path' | 'host'
}
const originalEnabled = ADMIN_CONSOLE_CONFIG.enabled
const originalMode = ADMIN_CONSOLE_CONFIG.mode

afterEach(() => {
  mutableConfig.enabled = originalEnabled
  mutableConfig.mode = originalMode
  delete process.env.ADMIN_CONSOLE_ORIGIN
  delete process.env.ADMIN_CONSOLE_HOSTNAME
})

describe('console host guard', () => {
  it('allows every host in the generated path mode', () => {
    mutableConfig.mode = 'path'

    expect(isConsoleHost('app.example.test')).toBe(true)
    expect(isConsoleHost('console.example.test')).toBe(true)
  })

  it('rejects a product host before calling a console handler in host mode', async () => {
    mutableConfig.mode = 'host'
    process.env.ADMIN_CONSOLE_HOSTNAME = 'console.example.test'
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))

    const response = await withConsoleHostGuard(
      new Request('http://app.example.test/api/console/access', {
        headers: { host: 'app.example.test' },
      }),
      handler
    )

    expect(response.status).toBe(404)
    expect(handler).not.toHaveBeenCalled()
  })

  it('accepts only the configured console host in host mode', () => {
    mutableConfig.mode = 'host'
    process.env.ADMIN_CONSOLE_HOSTNAME = 'console.example.test'

    expect(isConsoleHost('console.example.test')).toBe(true)
    expect(isConsoleHost('app.example.test')).toBe(false)
  })

  it('accepts the configured HTTPS authority including its non-default port', async () => {
    mutableConfig.mode = 'host'
    process.env.ADMIN_CONSOLE_HOSTNAME = 'console.example.test'
    process.env.ADMIN_CONSOLE_ORIGIN = 'https://console.example.test:8443'
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    expect(isConsoleHost('console.example.test:8443')).toBe(true)
    for (const host of [
      'console.example.test',
      'console.example.test:9443',
      'app.example.test:8443',
      'console.example.test:8443@attacker.test',
    ]) {
      expect(isConsoleHost(host)).toBe(false)
    }
    const response = await withConsoleHostGuard(
      new Request('https://console.example.test:8443/api/console/access', {
        headers: { host: 'console.example.test:8443' },
      }),
      handler
    )
    expect(response.status).toBe(204)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('rejects every host when the generated console config is disabled', () => {
    mutableConfig.enabled = false

    expect(isConsoleHost('console.example.test')).toBe(false)
  })
})
