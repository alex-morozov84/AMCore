import { describe, expect, it, vi } from 'vitest'

import {
  assertConsoleExternalLinks,
  CONSOLE_EXTERNAL_LINK_ENV,
  getConsoleExternalLinks,
  parseConsoleExternalUrl,
} from './console-external-links'

describe('parseConsoleExternalUrl', () => {
  it.each([
    ['https://grafana.example.com', 'https://grafana.example.com/'],
    ['  https://grafana.example.com/d/abc?orgId=1  ', 'https://grafana.example.com/d/abc?orgId=1'],
    [
      'https://grafana.example.com:8443/d/x#panel-2',
      'https://grafana.example.com:8443/d/x#panel-2',
    ],
    ['http://localhost:3001/d/x', 'http://localhost:3001/d/x'],
    ['http://127.0.0.1:9093', 'http://127.0.0.1:9093/'],
    ['https://ГРАФАНА.example.com/', 'https://xn--80aaaj6cp3a.example.com/'],
  ])('keeps the normalized address of %s', (raw, href) => {
    expect(parseConsoleExternalUrl(raw)).toBe(href)
  })

  it.each([
    undefined,
    '',
    '   ',
    'not a url',
    '//grafana.example.com/d/x',
    '/d/x',
    'grafana.example.com',
    '*',
    'https://*.example.com',
    'http://grafana.example.com',
    'ftp://grafana.example.com',
    'https://user:pw@grafana.example.com',
    'https://user@grafana.example.com',
    'javascript:alert(1)',
    'data:text/html,<p>x</p>',
    'https://grafana.example.com/a b',
    'https://grafana.example.com/\u0007',
    'https://grafana.example.com/a\nb',
    `https://grafana.example.com/${'a'.repeat(2048)}`,
  ])('refuses %p', (raw) => {
    expect(parseConsoleExternalUrl(raw)).toBeNull()
  })
})

describe('getConsoleExternalLinks', () => {
  it('reads the three variables and gives null for unset or unusable ones', () => {
    expect(
      getConsoleExternalLinks({
        [CONSOLE_EXTERNAL_LINK_ENV.metrics]: 'https://grafana.example.com/d/x',
        [CONSOLE_EXTERNAL_LINK_ENV.logs]: '',
        [CONSOLE_EXTERNAL_LINK_ENV.alerts]: 'javascript:alert(1)',
      })
    ).toEqual({
      metrics: 'https://grafana.example.com/d/x',
      logs: null,
      alerts: null,
    })
  })
})

describe('assertConsoleExternalLinks', () => {
  it.each([
    [{}],
    [{ ADMIN_CONSOLE_LOGS_URL: '  ' }],
    [{ ADMIN_CONSOLE_METRICS_URL: 'https://g.example.com/d' }],
  ])('accepts %p', (env) => {
    expect(() => assertConsoleExternalLinks(env)).not.toThrow()
  })

  it.each([
    ['ADMIN_CONSOLE_METRICS_URL', 'http://grafana.example.com'],
    ['ADMIN_CONSOLE_LOGS_URL', 'javascript:alert(1)'],
    ['ADMIN_CONSOLE_ALERTS_URL', 'grafana.example.com'],
  ])('refuses %s=%s at start-up and names the variable', (name, value) => {
    expect(() => assertConsoleExternalLinks({ [name]: value })).toThrow(new RegExp(name))
  })
})

describe('validateAdminConsoleStartupOrExit', () => {
  it('stops the server and names the variable when an external tool address is unusable', async () => {
    vi.resetModules()
    vi.doMock('server-only', () => ({}))
    vi.stubEnv('ADMIN_CONSOLE_METRICS_URL', 'http://grafana.example.com')
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const { validateAdminConsoleStartupOrExit } = await import('./admin-console-startup')
    validateAdminConsoleStartupOrExit()

    expect(exit).toHaveBeenCalledWith(1)
    expect(String(write.mock.calls[0]?.[0])).toMatch(/ADMIN_CONSOLE_METRICS_URL must be/)
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('lets the server start when every address is empty or usable', async () => {
    vi.resetModules()
    vi.doMock('server-only', () => ({}))
    vi.stubEnv('ADMIN_CONSOLE_METRICS_URL', 'https://grafana.example.com/d/x')
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    const { validateAdminConsoleStartupOrExit } = await import('./admin-console-startup')
    validateAdminConsoleStartupOrExit()

    expect(exit).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })
})
