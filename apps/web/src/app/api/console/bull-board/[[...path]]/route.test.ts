import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/console/board-handler', () => ({ handleConsoleBoard: vi.fn() }))
vi.mock('@/shared/lib/console-host-guard', () => ({ withConsoleHostGuard: vi.fn() }))

import { handleConsoleBoard } from '@/shared/api/console/board-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from './route'

const request = (method = 'GET') =>
  new Request('https://console.example.test/api/console/bull-board/api/queues', { method })
const context = (path?: string[]) => ({ params: Promise.resolve({ path }) })

describe('/api/console/bull-board', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(withConsoleHostGuard).mockImplementation((_request, run) => run())
  })

  it.each([
    ['GET', GET],
    ['HEAD', HEAD],
  ] as const)('serves %s only from inside the Console host guard', async (method, handler) => {
    vi.mocked(handleConsoleBoard).mockResolvedValue(new Response('{}'))
    await handler(request(method), context(['api', 'queues']))
    expect(withConsoleHostGuard).toHaveBeenCalledOnce()
    expect(handleConsoleBoard).toHaveBeenCalledWith(expect.any(Request), ['api', 'queues'])
  })

  it('answers 404 for a foreign host before any board work', async () => {
    vi.mocked(withConsoleHostGuard).mockResolvedValue(new Response(null, { status: 404 }))
    expect((await GET(request(), context([]))).status).toBe(404)
    expect(handleConsoleBoard).not.toHaveBeenCalled()
  })

  it('passes an empty path for the entry page', async () => {
    vi.mocked(handleConsoleBoard).mockResolvedValue(new Response('{}'))
    await GET(request(), context(undefined))
    expect(handleConsoleBoard).toHaveBeenCalledWith(expect.any(Request), [])
  })

  it.each([
    ['POST', POST],
    ['PUT', PUT],
    ['PATCH', PATCH],
    ['DELETE', DELETE],
    ['OPTIONS', OPTIONS],
  ] as const)('refuses %s with 405 and never reaches the board', async (method, handler) => {
    const response = await handler(request(method))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
    expect(handleConsoleBoard).not.toHaveBeenCalled()
  })
})
