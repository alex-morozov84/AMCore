// @vitest-environment node
import type { notFound } from 'next/navigation'
import type * as Shared from '@amcore/shared'
import { type CatalogueLocale, localePathPrefix, type ProductAdminConfig } from '@amcore/shared'
import { afterEach, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({
  placement: { version: 1, mode: 'path', alias: 'staff_portal' } as ProductAdminConfig,
  console: { enabled: false, mode: 'disabled' as 'disabled' | 'path' | 'host', alias: 'ops_panel' },
}))

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', async (original) => original<{ notFound: typeof notFound }>())
vi.mock('@amcore/shared', async (original) => ({
  ...(await original<typeof Shared>()),
  get PRODUCT_ADMIN_CONFIG() {
    return settings.placement
  },
}))
vi.mock('@/shared/lib/admin-console-topology', () => ({ ADMIN_CONSOLE_CONFIG: settings.console }))

import { requireConsoleEnabled, withConsoleHostGuard } from '@/shared/lib/console-host-guard'

import { resolveProductWebContext } from './product-web-context.server'

const languages: { served: CatalogueLocale[]; chosen: CatalogueLocale; prefix: string }[] = [
  { served: ['en'], chosen: 'en', prefix: '' },
  { served: ['ru'], chosen: 'ru', prefix: '' },
  { served: ['en', 'ru'], chosen: 'en', prefix: '/en' },
  { served: ['en', 'ru'], chosen: 'ru', prefix: '/ru' },
  { served: ['ru', 'en'], chosen: 'en', prefix: '/en' },
  { served: ['ru', 'en'], chosen: 'ru', prefix: '/ru' },
]
const placements = [
  { mode: 'path', authority: 'site.example.test', login: '/staff_portal/login' },
  { mode: 'host', authority: 'staff.example.test', login: '/login' },
] as const
const consoles = [
  { mode: 'disabled', siteStatus: 404, consoleStatus: 404 },
  { mode: 'path', siteStatus: 204, consoleStatus: 404 },
  { mode: 'host', siteStatus: 404, consoleStatus: 204 },
] as const
const combinations = languages.flatMap((language) =>
  placements.flatMap((placement) => consoles.map((console) => ({ language, placement, console })))
)

afterEach(() => vi.unstubAllEnvs())

it.each(combinations)(
  'routes configured login and Console under $language.served/$language.chosen, $placement.mode/$console.mode',
  async ({ language, placement, console }) => {
    settings.placement = { version: 1, alias: 'staff_portal', mode: placement.mode }
    settings.console.mode = console.mode
    settings.console.enabled = console.mode !== 'disabled'
    vi.stubEnv('FRONTEND_URL', 'https://site.example.test')
    vi.stubEnv('PRODUCT_ADMIN_ORIGIN', `https://${placement.authority}`)
    vi.stubEnv('ADMIN_CONSOLE_ORIGIN', 'https://ops.example.test')
    vi.stubEnv('ADMIN_CONSOLE_HOSTNAME', 'ops.example.test')
    vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-configured-context-key-at-least-32>')

    const context = resolveProductWebContext(
      new Headers({ host: placement.authority }),
      'admin-auth'
    )
    const path = localePathPrefix(language.chosen, language.served) + context.loginPath
    expect(context.origin + path).toBe(
      `https://${placement.authority}${language.prefix}${placement.login}`
    )
    if (console.mode === 'disabled')
      expect(requireConsoleEnabled).toThrow(
        expect.objectContaining({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
      )
    else expect(requireConsoleEnabled).not.toThrow()

    for (const [host, status] of [
      ['site.example.test', console.siteStatus],
      ['ops.example.test', console.consoleStatus],
    ] as const) {
      const request = new Request(`https://${host}/api/console/access`, { headers: { host } })
      const handler = vi.fn(async () => new Response(null, { status: 204 }))
      expect((await withConsoleHostGuard(request, handler)).status).toBe(status)
      expect(handler).toHaveBeenCalledTimes(status === 204 ? 1 : 0)
    }
  }
)
