import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

describe('Observability metrics (e2e)', () => {
  let context: E2ETestContext
  let app: INestApplication

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
  }, 120000)

  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await cleanOrgData(context.prisma)
    await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
  })

  it('exports metrics and records HTTP RED for 401, 404, and 429 without raw IDs', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401)

    await request(app.getHttpServer()).get('/organizations/raw-org-id').expect(401)

    await request(app.getHttpServer()).get('/not-found/raw-resource-id').expect(404)

    let sawTooManyRequests = false
    for (let i = 0; i < 15; i++) {
      const response = await request(app.getHttpServer()).get('/auth/oauth/providers')
      if (response.status === 429) {
        sawTooManyRequests = true
        break
      }
    }
    expect(sawTooManyRequests).toBe(true)

    const metrics = await request(app.getHttpServer()).get('/metrics').expect(200)
    expect(metrics.headers['content-type']).toContain('text/plain')
    expect(metrics.text).toContain('# HELP amcore_http_requests_total')
    expect(metrics.text).toContain('# HELP amcore_db_pool_connections')
    expect(metrics.text).toContain('amcore_db_pool_connections{state="total"')
    expect(metrics.text).toContain('amcore_db_pool_connections{state="idle"')
    expect(metrics.text).toContain('amcore_db_pool_connections{state="waiting"')
    expect(metrics.text).toContain('status_code="401"')
    expect(metrics.text).toContain('status_code="404"')
    expect(metrics.text).toContain('status_code="429"')
    expect(metrics.text).toContain('route="unknown"')
    expect(metrics.text).not.toContain('raw-org-id')
    expect(metrics.text).not.toContain('raw-resource-id')

    // Positive proof that parameterized + guard-rejected routes get a meaningful
    // normalized template (not everything collapsing to `unknown`): the request
    // to `/organizations/raw-org-id` must be recorded as `:id` with status 401,
    // and the throttled route must be recorded with status 429.
    const counterLines = metrics.text
      .split('\n')
      .filter((line) => line.startsWith('amcore_http_requests_total'))
    expect(
      counterLines.find(
        (line) => line.includes('route="/organizations/:id"') && line.includes('status_code="401"')
      )
    ).toBeDefined()
    expect(
      counterLines.find(
        (line) =>
          line.includes('route="/auth/oauth/providers"') && line.includes('status_code="429"')
      )
    ).toBeDefined()
  })
})
