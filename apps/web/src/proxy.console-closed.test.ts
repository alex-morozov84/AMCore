import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server')
  return { default: () => () => NextResponse.next() }
})

async function proxyWith(mode: 'disabled' | 'path') {
  vi.resetModules()
  vi.doMock('@/shared/lib/admin-console.generated', () => ({
    ADMIN_CONSOLE_CONFIG: { enabled: mode !== 'disabled', mode, slug: 'admin' },
  }))
  return (await import('./proxy')).default
}

const request = (path: string) => new NextRequest(`https://app.example.com${path}`)

afterEach(() => {
  vi.doUnmock('@/shared/lib/admin-console.generated')
  vi.resetModules()
})

describe('proxy with the Console turned off', () => {
  it.each([
    '/admin',
    '/admin/users',
    '/en/admin',
    '/ru/admin/audit',
    '/api/console/access',
    '/api/console/users/1/role',
  ])('answers 404 for %s before any page runs', async (path) => {
    const proxy = await proxyWith('disabled')
    expect((await proxy(request(path))).status).toBe(404)
  })

  it.each(['/en/login', '/api/health', '/administrators', '/en/administrators', '/api/consolex'])(
    'leaves %s alone',
    async (path) => {
      const proxy = await proxyWith('disabled')
      expect((await proxy(request(path))).status).not.toBe(404)
    }
  )
})

describe('proxy with the Console in path mode', () => {
  it.each(['/en/admin', '/api/console/access'])('does not refuse %s', async (path) => {
    const proxy = await proxyWith('path')
    expect((await proxy(request(path))).status).not.toBe(404)
  })
})
