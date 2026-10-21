import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import type { E2ETestContext } from './helpers'
import { setupE2ETest, teardownE2ETest } from './helpers'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('Correlation ID (e2e)', () => {
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

  it('echoes a well-formed inbound ID on a success response', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-ID', 'probe-1.2:3')
      .expect(200)

    expect(response.headers['x-correlation-id']).toBe('probe-1.2:3')
  })

  it('echoes the same ID on an error response and in its body', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .set('X-Correlation-ID', 'probe-404')
      .expect(404)

    expect(response.headers['x-correlation-id']).toBe('probe-404')
    expect(response.body.correlationId).toBe('probe-404')
  })

  it('generates a UUID when no header arrives', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200)

    expect(response.headers['x-correlation-id']).toMatch(UUID)
  })

  it.each(['has space', 'a'.repeat(129), 'semi;colon', '<script>'])(
    'replaces a malformed inbound ID (%s) with a generated UUID',
    async (value) => {
      const response = await request(app.getHttpServer())
        .get('/health/live')
        .set('X-Request-ID', value)
        .expect(200)

      expect(response.headers['x-correlation-id']).toMatch(UUID)
    }
  )

  it('ignores a malformed X-Request-ID and takes a valid X-Correlation-ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-ID', 'has space')
      .set('X-Correlation-ID', 'fallback-1')
      .expect(200)

    expect(response.headers['x-correlation-id']).toBe('fallback-1')
  })
})
