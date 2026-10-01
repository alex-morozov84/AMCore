import { jest } from '@jest/globals'
import type { INestApplication } from '@nestjs/common'
import { MemoryHealthIndicator } from '@nestjs/terminus'
import request from 'supertest'

import type { E2ETestContext } from './helpers'
import { setupE2ETest, teardownE2ETest } from './helpers'

describe('Health (e2e)', () => {
  let app: INestApplication
  let context: E2ETestContext

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
  }, 120000)

  afterAll(async () => {
    if (context) {
      await teardownE2ETest(context)
    }
  }, 120000)

  it.each([
    ['/health', ['database', 'redis', 'disk', 'memory_heap']],
    ['/health/startup', ['database', 'redis']],
    ['/health/ready', ['database', 'redis', 'disk', 'memory_heap']],
    ['/health/live', ['memory_heap']],
  ])('returns 200 without authentication for %s', async (path, keys) => {
    const response = await request(app.getHttpServer()).get(path).expect(200)

    expect(response.body.status).toBe('ok')
    expect(response.body.timestamp).toBeUndefined()
    expect(Object.keys(response.body.info ?? {})).toEqual(keys)
  })

  it.each(['/health', '/health/ready', '/health/live'])(
    'preserves 503 for a returned down indicator at %s',
    async (path) => {
      const spy = jest
        .spyOn(app.get(MemoryHealthIndicator), 'checkHeap')
        .mockResolvedValue({ memory_heap: { status: 'down' } })
      try {
        const response = await request(app.getHttpServer()).get(path).expect(503)
        expect(response.body.statusCode).toBe(503)
      } finally {
        spy.mockRestore()
      }
    }
  )

  it('returns 200 for a fulfilled degraded indicator', async () => {
    const spy = jest
      .spyOn(app.get(MemoryHealthIndicator), 'checkHeap')
      .mockResolvedValue({ memory_heap: { status: 'degraded' } })
    try {
      const response = await request(app.getHttpServer()).get('/health/ready').expect(200)
      expect(response.body.status).toBe('degraded')
    } finally {
      spy.mockRestore()
    }
  })

  it('returns 500 for an unexpected provider exception', async () => {
    const spy = jest
      .spyOn(app.get(MemoryHealthIndicator), 'checkHeap')
      .mockRejectedValue(new Error('private unexpected provider fault'))
    try {
      await request(app.getHttpServer()).get('/health/ready').expect(500)
    } finally {
      spy.mockRestore()
    }
  })
})
