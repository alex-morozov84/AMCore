import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/console/queues-handler', () => ({ handleConsoleQueues: vi.fn() }))
vi.mock('@/shared/lib/console-host-guard', () => ({ withConsoleHostGuard: vi.fn() }))

import { handleConsoleQueues } from '@/shared/api/console/queues-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

import { GET } from './route'

describe('GET /api/console/background-work/queues', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the request through the console host guard first', async () => {
    const request = new Request('https://console.example.test/api/console/background-work/queues')
    vi.mocked(withConsoleHostGuard).mockResolvedValue(new Response(null, { status: 404 }))
    expect((await GET(request)).status).toBe(404)
    expect(withConsoleHostGuard).toHaveBeenCalledWith(request, expect.any(Function))
    expect(handleConsoleQueues).not.toHaveBeenCalled()
  })

  it('serves the summary only from inside the guard', async () => {
    const request = new Request('https://console.example.test/api/console/background-work/queues')
    vi.mocked(handleConsoleQueues).mockResolvedValue(new Response('{}'))
    vi.mocked(withConsoleHostGuard).mockImplementation((_req, run) => run())
    await GET(request)
    expect(handleConsoleQueues).toHaveBeenCalledWith(request)
  })
})
