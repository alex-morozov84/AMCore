// @vitest-environment node
import { BULL_BOARD_CONTENT_SECURITY_POLICY, BULL_BOARD_CONTEXT_HEADER } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./board-locale', () => {
  // The language and the path back to Background work, as the locale module answers them in a
  // multi-locale build; its own tests cover the real thing in whichever mode is generated.
  const readBoardLocale = (request: Request) =>
    (request.headers.get('cookie') ?? '').includes('NEXT_LOCALE=ru') ? 'ru' : 'en'
  return {
    readBoardLocale,
    consoleBackgroundWorkPath: (request: Request) =>
      `/${readBoardLocale(request)}/admin/background-work`,
  }
})
vi.mock('./authenticated-proxy', () => ({ resolveConsoleAccessToken: vi.fn() }))

import { resolveConsoleAccessToken } from './authenticated-proxy'
import { handleConsoleBoard } from './board-handler'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const PAGE = new Request('https://app.example.test/api/console/bull-board/', {
  headers: { accept: 'text/html', cookie: 'NEXT_LOCALE=ru; amcore_session=secret-vault-id' },
})

function expectBoardErrorHeaders(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('content-security-policy')).toBe(BULL_BOARD_CONTENT_SECURITY_POLICY)
  expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('x-frame-options')).toBe('DENY')
  expect(response.headers.get('set-cookie')).toBeNull()
  expect(response.headers.get('location')).toBeNull()
}

function asset(path = 'api/queues', init: RequestInit = {}): Request {
  return new Request(`https://app.example.test/api/console/bull-board/${path}`, {
    headers: {
      accept: 'application/json',
      cookie: 'amcore_session=secret-vault-id',
      authorization: 'Bearer browser-supplied',
      'x-forwarded-for': '203.0.113.9',
      [BULL_BOARD_CONTEXT_HEADER]: 'browser-forged',
      origin: 'https://app.example.test',
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
    ...init,
  })
}

function boardResponse(init: ResponseInit & { csp?: string | null } = {}): Response {
  const { csp = BULL_BOARD_CONTENT_SECURITY_POLICY, ...rest } = init
  const headers = new Headers({
    'content-type': 'application/json',
    'cache-control': 'private, no-store',
    'set-cookie': 'leak=1',
    location: 'https://evil.example/',
    'x-powered-by': 'Express',
    ...(rest.headers as Record<string, string> | undefined),
  })
  if (csp) headers.set('content-security-policy', csp)
  const body = rest.status === 304 ? null : '{"queues":[]}'
  return new Response(body, { status: 200, ...rest, headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveConsoleAccessToken).mockResolvedValue({ token: 'access-token' })
  fetchMock.mockResolvedValue(boardResponse())
})

describe('board bridge — what reaches the API', () => {
  it('forwards one GET to the fixed mount with the server-held bearer and a fresh context', async () => {
    await handleConsoleBoard(asset(), ['api', 'queues'])
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toMatch(/\/api\/v1\/admin\/queues\/api\/queues$/)
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', cache: 'no-store' })
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer access-token')
    expect(headers.get('accept')).toBe('application/json')
  })

  it('builds the upstream headers from scratch: no cookie, origin, forwarded or forged header', async () => {
    await handleConsoleBoard(asset(), ['api', 'queues'])
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers)
    expect([...headers.keys()].sort()).toEqual(
      ['accept', 'authorization', BULL_BOARD_CONTEXT_HEADER].sort()
    )
    expect(headers.get('authorization')).not.toContain('browser-supplied')
    const context = JSON.parse(
      Buffer.from(headers.get(BULL_BOARD_CONTEXT_HEADER)!, 'base64url').toString('utf8')
    )
    expect(context).toEqual({
      basePath: '/api/console/bull-board',
      locale: 'en',
      returnHref: '/en/admin/background-work',
    })
  })

  it('sends the locale of the visitor and conditional headers for assets', async () => {
    await handleConsoleBoard(
      asset('static/js/a.js', { headers: { cookie: 'NEXT_LOCALE=ru', 'if-none-match': '"abc"' } }),
      ['static', 'js', 'a.js']
    )
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers)
    expect(headers.get('if-none-match')).toBe('"abc"')
    const context = JSON.parse(
      Buffer.from(headers.get(BULL_BOARD_CONTEXT_HEADER)!, 'base64url').toString('utf8')
    )
    expect(context.locale).toBe('ru')
  })

  it.each([[['..']], [['a%2Fb']], [['x', 'y', 'z', 'a', 'b', 'c', 'd']]])(
    'answers 404 for the path %j without any session or upstream work',
    async (segments) => {
      const response = await handleConsoleBoard(asset(), segments)
      expect(response.status).toBe(404)
      expectBoardErrorHeaders(response)
      expect(resolveConsoleAccessToken).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('answers 404 for a query the board never sends', async () => {
    const request = new Request('https://app.example.test/api/console/bull-board/api/queues?x=1')
    const response = await handleConsoleBoard(request, ['api', 'queues'])
    expect(response.status).toBe(404)
    expectBoardErrorHeaders(response)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards the abort of the browser and bounds the request with its own deadline', async () => {
    const browser = new AbortController()
    await handleConsoleBoard(
      new Request('https://app.example.test/api/console/bull-board/api/queues', {
        signal: browser.signal,
      }),
      ['api', 'queues']
    )
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.signal?.aborted).toBe(false)
    browser.abort()
    expect(init.signal?.aborted).toBe(true)
  })
})

describe('board bridge — what reaches the browser', () => {
  it('serves a board response with its own CSP, no caching and nothing of the upstream envelope', async () => {
    const response = await handleConsoleBoard(asset(), ['api', 'queues'])
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"queues":[]}')
    expect(response.headers.get('content-security-policy')).toBe(BULL_BOARD_CONTENT_SECURITY_POLICY)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-type')).toBe('application/json')
    for (const name of ['set-cookie', 'location', 'x-powered-by']) {
      expect(response.headers.get(name)).toBeNull()
    }
  })

  it('never lets the token reach the browser', async () => {
    const response = await handleConsoleBoard(asset(), ['api', 'queues'])
    expect(JSON.stringify([...response.headers])).not.toContain('access-token')
    expect(await response.text()).not.toContain('access-token')
  })

  it('forces a cache policy the board did not ask for into the private one', async () => {
    fetchMock.mockResolvedValue(
      boardResponse({ headers: { 'cache-control': 'public, max-age=999' } })
    )
    expect(
      (await handleConsoleBoard(asset(), ['api', 'queues'])).headers.get('cache-control')
    ).toBe('private, no-store')
    fetchMock.mockResolvedValue(
      boardResponse({ headers: { 'cache-control': 'private, no-cache' } })
    )
    expect(
      (await handleConsoleBoard(asset(), ['static', 'a.js'])).headers.get('cache-control')
    ).toBe('private, no-cache')
  })

  it('serves a 304 revalidation of an asset', async () => {
    fetchMock.mockResolvedValue(boardResponse({ status: 304 }))
    expect((await handleConsoleBoard(asset('static/a.js'), ['static', 'a.js'])).status).toBe(304)
  })

  it.each([null, "default-src 'self' https:", `${BULL_BOARD_CONTENT_SECURITY_POLICY}; x`])(
    'serves nothing when the CSP is %j',
    async (csp) => {
      fetchMock.mockResolvedValue(boardResponse({ csp }))
      const response = await handleConsoleBoard(asset(), ['api', 'queues'])
      expect(response.status).toBe(503)
      expectBoardErrorHeaders(response)
      expect(await response.text()).not.toContain('"queues":[]')
    }
  )

  it('never follows or exposes an upstream redirect', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })
    )
    const response = await handleConsoleBoard(asset(), ['api', 'queues'])
    expect(response.status).toBe(503)
    expect(response.headers.get('location')).toBeNull()
  })
})

describe('board bridge — states', () => {
  it.each([401, 403, 404, 500, 503])(
    'gives a refused data request its own error policy, GET and HEAD (upstream %i)',
    async (status) => {
      fetchMock.mockResolvedValue(new Response('RAW_UPSTREAM_ERROR', { status }))
      const expected = status === 500 ? 503 : status
      for (const method of ['GET', 'HEAD']) {
        const request = asset('static/missing.js', { method })
        const response = await handleConsoleBoard(request, ['static', 'missing.js'])
        expect(response.status).toBe(expected)
        expectBoardErrorHeaders(response)
        const body = await response.text()
        if (method === 'HEAD') expect(body).toBe('')
        else {
          expect(JSON.parse(body)).toMatchObject({
            statusCode: expected,
            message: 'Queue board unavailable',
            path: new URL(request.url).pathname,
          })
          expect(body).not.toContain('RAW_UPSTREAM_ERROR')
        }
      }
    }
  )

  it('never stores its own invalid-path HEAD answer', async () => {
    const response = await handleConsoleBoard(asset('a%2Fb', { method: 'HEAD' }), ['a%2Fb'])
    expect(response.status).toBe(404)
    expectBoardErrorHeaders(response)
    expect(await response.text()).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers a data request without a session with the session failure', async () => {
    vi.mocked(resolveConsoleAccessToken).mockResolvedValue({
      failure: new Response(null, { status: 401 }),
    })
    const response = await handleConsoleBoard(asset(), ['api', 'queues'])
    expect(response.status).toBe(401)
    expectBoardErrorHeaders(response)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([401, 403])('hides the board from a page load that is refused (%i)', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }))
    const response = await handleConsoleBoard(PAGE, [])
    expect(response.status).toBe(404)
    expect(response.headers.get('location')).toBeNull()
  })

  it('hides the board from a page load without a Console session', async () => {
    vi.mocked(resolveConsoleAccessToken).mockResolvedValue({
      failure: new Response(null, { status: 401 }),
    })
    expect((await handleConsoleBoard(PAGE, [])).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers a data request refused by the API with that status', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }))
    expect((await handleConsoleBoard(asset(), ['api', 'queues'])).status).toBe(403)
  })

  it.each([
    ['not mounted', () => fetchMock.mockResolvedValue(new Response(null, { status: 404 }))],
    ['failing', () => fetchMock.mockResolvedValue(new Response(null, { status: 500 }))],
    ['unavailable', () => fetchMock.mockResolvedValue(new Response(null, { status: 503 }))],
    ['unreachable', () => fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))],
    ['timed out', () => fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'))],
  ])(
    'sends a page load back to Background work, unavailable, when the board is %s',
    async (_label, arrange) => {
      arrange()
      const response = await handleConsoleBoard(PAGE, [])
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/ru/admin/background-work?board=unavailable')
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  )

  it('answers a failing data request with a JSON status, never a redirect', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))
    const response = await handleConsoleBoard(asset(), ['api', 'queues'])
    expect(response.status).toBe(503)
    expect(response.headers.get('location')).toBeNull()
  })

  it('leaves a missing asset a 404', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))
    expect((await handleConsoleBoard(asset('static/nope.js'), ['static', 'nope.js'])).status).toBe(
      404
    )
  })

  it('treats a page load by Sec-Fetch-Dest as a document even without an Accept header', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))
    const request = new Request('https://app.example.test/api/console/bull-board/', {
      headers: { 'sec-fetch-dest': 'document' },
    })
    expect((await handleConsoleBoard(request, [])).status).toBe(302)
  })
})
