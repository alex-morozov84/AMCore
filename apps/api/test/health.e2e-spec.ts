import type { INestApplication } from '@nestjs/common'
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
  })

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
})
