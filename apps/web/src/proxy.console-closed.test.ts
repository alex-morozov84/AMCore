import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@amcore/shared', async (importOriginal: () => Promise<object>) => ({
  ...(await importOriginal()),
  // This test covers a two-locale build, whatever `locales.json` holds.
  SERVED_LOCALES: ['en', 'ru'],
  DEFAULT_LOCALE: 'en',
}))
vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server')
  return { default: () => () => NextResponse.next() }
})

async function proxyWith(mode: 'disabled' | 'path') {
  vi.resetModules()
  vi.doMock('@/shared/lib/admin-console-topology', () => ({
    ADMIN_CONSOLE_CONFIG: { enabled: mode !== 'disabled', mode, alias: 'admin' },
  }))
  return (await import('./proxy')).default
}

const request = (path: string) => new NextRequest(`https://app.example.com${path}`)

afterEach(() => {
  vi.doUnmock('@/shared/lib/admin-console-topology')
  vi.resetModules()
})

describe('proxy with the Console turned off', () => {
  it.each(['/admin', '/admin/users', '/en/admin', '/ru/admin/audit'])(
    'answers 404 for %s before any page runs',
    async (path) => {
      const proxy = await proxyWith('disabled')
      expect((await proxy(request(path))).status).toBe(404)
    }
  )

  it.each(['/en/login', '/administrators', '/en/administrators'])(
    'leaves %s alone',
    async (path) => {
      const proxy = await proxyWith('disabled')
      expect((await proxy(request(path))).status).not.toBe(404)
    }
  )
})

describe('proxy with the Console in path mode', () => {
  it.each(['/en/admin', '/admin/users'])('does not refuse %s', async (path) => {
    const proxy = await proxyWith('path')
    expect((await proxy(request(path))).status).not.toBe(404)
  })
})
