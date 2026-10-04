// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
}))

import {
  BOARD_UPSTREAM_PATH,
  buildBoardRenderContext,
  buildBoardUpstreamUrl,
  consoleBackgroundWorkPath,
  encodeBoardRenderContext,
} from './board-upstream'

const API = 'http://api.internal:5002'
const build = (segments: string[], search = '') => buildBoardUpstreamUrl(API, segments, search)

describe('board upstream URL', () => {
  it('maps the browser path under the one fixed mount', () => {
    expect(build([])?.toString()).toBe(`${API}${BOARD_UPSTREAM_PATH}`)
    expect(build(['api', 'queues'])?.pathname).toBe(`${BOARD_UPSTREAM_PATH}/api/queues`)
    expect(build(['queue', 'email', 'job:1_a-b.c'])?.pathname).toBe(
      `${BOARD_UPSTREAM_PATH}/queue/email/job:1_a-b.c`
    )
    expect(build(['static', 'js', 'main.f107.js'])?.pathname).toBe(
      `${BOARD_UPSTREAM_PATH}/static/js/main.f107.js`
    )
  })

  it.each([
    [['..']],
    [['.']],
    [['api', '..', 'x']],
    [['a/b']],
    [['a%2Fb']],
    [['%2e%2e']],
    [['a\\b']],
    [['']],
    [['a b']],
    [['x'.repeat(129)]],
    [['a', 'b', 'c', 'd', 'e', 'f', 'g']],
    [['http://evil.example']],
    [['//evil.example']],
  ])('refuses the segments %j', (segments) => {
    expect(build(segments)).toBeNull()
  })

  it('keeps only the four board query keys with plain values', () => {
    expect(
      build(['api', 'queues'], '?activeQueue=email&status=failed&page=2&jobsPerPage=10')?.search
    ).toBe('?activeQueue=email&status=failed&page=2&jobsPerPage=10')
    expect(build(['api', 'queues'], '')?.search).toBe('')
  })

  it.each([
    '?foo=1',
    '?page=1&page=2',
    '?status=a%20b',
    '?page=',
    '?activeQueue=../x',
    `?page=${'1'.repeat(65)}`,
  ])('refuses the query %s', (search) => {
    expect(build(['api', 'queues'], search)).toBeNull()
  })

  it('ignores a trailing slash of the API origin and never leaves the mount', () => {
    expect(buildBoardUpstreamUrl(`${API}/`, [], '')?.pathname).toBe(BOARD_UPSTREAM_PATH)
  })
})

describe('board render context', () => {
  const request = (cookie?: string) =>
    new Request('https://console.example.test/api/console/bull-board/', {
      headers: cookie ? { cookie } : {},
    })

  it('uses the public path, the locale of the cookie and the Background work page', () => {
    expect(buildBoardRenderContext(request('NEXT_LOCALE=ru'))).toEqual({
      basePath: '/api/console/bull-board',
      locale: 'ru',
      returnHref: '/ru/admin/background-work',
    })
  })

  it('falls back to the default locale for an absent or unknown cookie value', () => {
    for (const cookie of [undefined, 'NEXT_LOCALE=de', 'NEXT_LOCALE=', 'other=1']) {
      expect(buildBoardRenderContext(request(cookie))?.locale).toBe('en')
    }
  })

  it('points a document that cannot be shown at the same page', () => {
    expect(consoleBackgroundWorkPath(request('NEXT_LOCALE=ru'))).toBe('/ru/admin/background-work')
  })

  it('encodes as base64url JSON the API can read back', () => {
    const context = buildBoardRenderContext(request('NEXT_LOCALE=en'))!
    const header = encodeBoardRenderContext(context)
    expect(header).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toEqual(context)
  })
})
