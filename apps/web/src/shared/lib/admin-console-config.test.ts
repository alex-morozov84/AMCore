import { afterEach, describe, expect, it } from 'vitest'

import { ADMIN_CONSOLE_CONFIG } from './admin-console.generated'
import {
  getConsoleHostname,
  getConsoleOrigin,
  validateAdminConsoleStartup,
} from './admin-console-config'

const mutableConfig = ADMIN_CONSOLE_CONFIG as unknown as {
  mode: 'disabled' | 'path' | 'host'
}
const originalMode = ADMIN_CONSOLE_CONFIG.mode

afterEach(() => {
  mutableConfig.mode = originalMode
  delete process.env.ADMIN_CONSOLE_ORIGIN
  delete process.env.ADMIN_CONSOLE_HOSTNAME
})

describe('admin console startup config', () => {
  it('does not require a hostname in the generated path mode', () => {
    mutableConfig.mode = 'path'

    expect(getConsoleHostname({})).toBeUndefined()
    expect(() => validateAdminConsoleStartup({})).not.toThrow()
  })

  it('rejects a missing or malformed hostname in host mode', () => {
    mutableConfig.mode = 'host'

    expect(() => validateAdminConsoleStartup({})).toThrow('ADMIN_CONSOLE_HOSTNAME')
    expect(() => validateAdminConsoleStartup({ ADMIN_CONSOLE_HOSTNAME: 'localhost' })).toThrow(
      'lowercase FQDN'
    )
  })

  it('accepts a lowercase FQDN in host mode', () => {
    mutableConfig.mode = 'host'

    expect(getConsoleHostname({ ADMIN_CONSOLE_HOSTNAME: 'console.example.test' })).toBe(
      'console.example.test'
    )
  })
})

it('accepts an exact explicit HTTPS origin with a port', () => {
  mutableConfig.mode = 'host'
  expect(
    getConsoleOrigin({
      ADMIN_CONSOLE_HOSTNAME: 'console.example.test',
      ADMIN_CONSOLE_ORIGIN: 'https://console.example.test:8443',
    })
  ).toBe('https://console.example.test:8443')
})
it.each([
  'http://console.example.test',
  'https://other.example.test',
  'https://console.example.test/',
  'https://console.example.test?x=1',
  'https://user@console.example.test',
  'https://CONSOLE.example.test',
  'https://console.example.test:443',
  'https://console.example.test#x',
])('rejects invalid explicit origin %s', (origin) => {
  mutableConfig.mode = 'host'
  expect(() =>
    getConsoleOrigin({
      ADMIN_CONSOLE_HOSTNAME: 'console.example.test',
      ADMIN_CONSOLE_ORIGIN: origin,
    })
  ).toThrow('ADMIN_CONSOLE_ORIGIN')
})
