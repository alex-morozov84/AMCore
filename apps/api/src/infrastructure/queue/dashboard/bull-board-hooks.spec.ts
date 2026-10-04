import type { BullBoardRequest, ControllerHandlerReturnType } from '@bull-board/api/typings/app'

import { BOARD_LOCALE_HEADER } from './bull-board-boundary.middleware'
import { boardCopy } from './bull-board-copy'
import { BOARD_HOOKS, BOARD_UI_CONFIG } from './bull-board-hooks'

const CANARY = 'CANARY_HOOK_SECRET'
const before = BOARD_HOOKS.before!
const after = BOARD_HOOKS.after!

function request(
  params: Record<string, unknown> = {},
  headers: Record<string, string | undefined> = {}
): BullBoardRequest {
  return { queues: new Map(), uiConfig: {}, query: {}, params, body: {}, headers }
}

describe('board hooks', () => {
  describe('before', () => {
    it.each([
      ['/api/queues'],
      ['/api/queues/:queueName/:jobId'],
      ['/api/queues/:queueName/:jobId/logs'],
    ])('allows GET %s', async (route) => {
      expect(await before({ method: 'get', route, request: request() })).toEqual({ allow: true })
    })

    it.each([
      ['get', '/api/redis/stats', 404],
      ['get', '/api/queues/:queueName/workers', 404],
      ['get', '/api/queues/:queueName/:jobId/flow', 404],
      ['get', '/api/job-schedulers', 404],
      ['put', '/api/queues/:queueName/pause', 405],
      ['put', '/api/queues/pause', 405],
      ['post', '/api/queues/:queueName/add', 405],
      ['patch', '/api/queues/:queueName/:jobId/update-data', 405],
      ['put', '/api/queues', 405],
    ] as const)('denies %s %s with %i', async (method, route, status) => {
      expect(await before({ method, route, request: request() })).toEqual({ allow: false, status })
    })
  })

  describe('after', () => {
    const queueBody = {
      queues: [{ name: 'email', counts: {}, jobs: [], extra: CANARY }],
    } as unknown as ControllerHandlerReturnType

    it('rebuilds the queues response with the closed projection', async () => {
      const result = await after(
        { method: 'get', route: '/api/queues', request: request() },
        { status: 200, body: queueBody.body }
      )
      expect(JSON.stringify(result.body)).not.toContain(CANARY)
      expect(result.status).toBe(200)
    })

    it('projects a job with its queue name taken from the route', async () => {
      const job = {
        job: { name: 'send-email', timestamp: 1, data: { template: 'welcome', to: CANARY } },
        status: 'waiting',
      }
      const result = await after(
        {
          method: 'get',
          route: '/api/queues/:queueName/:jobId',
          request: request({ queueName: 'email', jobId: '1' }),
        },
        { status: 200, body: job }
      )
      expect((result.body as { job: { data: unknown } }).job.data).toEqual({ template: 'welcome' })
      expect(JSON.stringify(result.body)).not.toContain(CANARY)
    })

    it('hides a job of a queue the board does not know', async () => {
      const result = await after(
        {
          method: 'get',
          route: '/api/queues/:queueName/:jobId',
          request: request({ queueName: 'default', jobId: '1' }),
        },
        {
          status: 200,
          body: { job: { name: 'x', timestamp: 1, data: { a: CANARY } }, status: 'waiting' },
        }
      )
      expect((result.body as { job: { data: unknown } }).job.data).toBe('[hidden]')
    })

    it('never returns raw log lines even if the logs route reaches the handler', async () => {
      const result = await after(
        {
          method: 'get',
          route: '/api/queues/:queueName/:jobId/logs',
          request: request({}, { [BOARD_LOCALE_HEADER]: 'ru' }),
        },
        { status: 200, body: [`LOG ${CANARY}`] }
      )
      expect(result.body).toEqual([boardCopy('ru').logsHidden])
    })

    it('ignores a client-forged locale value', async () => {
      const result = await after(
        {
          method: 'get',
          route: '/api/queues/:queueName/:jobId/logs',
          request: request({}, { [BOARD_LOCALE_HEADER]: '<script>' }),
        },
        { status: 200, body: [] }
      )
      expect(result.body).toEqual([boardCopy('en').logsHidden])
    })
  })

  it('hides every optional diagnostic channel and slows polling', () => {
    expect(BOARD_UI_CONFIG).toMatchObject({
      hideRedisDetails: true,
      showWorkers: false,
      showMetrics: false,
      hideDocsLink: true,
      pollingInterval: { showSetting: false, forceInterval: 15 },
    })
  })
})
