import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger'
import { cleanupOpenApiDoc } from 'nestjs-zod'

import type { E2ETestContext } from './helpers'
import { setupE2ETest, teardownE2ETest } from './helpers'

/**
 * Arc C — OpenAPI success-surface completeness (ADR-050).
 *
 * Generates the OpenAPI document the same way `main.ts` does (DocumentBuilder
 * + `cleanupOpenApiDoc`) from the fully-booted AppModule, then asserts the
 * documented success response of every public operation **exactly** matches an
 * explicit expected inventory: the precise success status code and the body
 * kind (typed JSON schema / 204 no-content / 3xx redirect / text). The check
 * runs both ways — every documented operation must be in the inventory and
 * every inventory entry must be documented — so a new handler that ships
 * without a typed `@ZodResponse` (or with the wrong status) fails CI, and a
 * silent status flip (e.g. a `POST` defaulting back to 200) is caught.
 *
 * Terminus health probes (`/health*`) document 200/503 via `@ApiResponse`
 * without a body schema by design and are the one justified exclusion.
 */
type BodyKind = 'json' | 'none' | 'redirect' | 'text' | 'stream'
interface Expected {
  status: string
  kind: BodyKind
}

// Paths carry no global prefix here — `setupE2ETest` does not call
// `setGlobalPrefix('api/v1')`, matching how the document is scanned.
const EXPECTED: Record<string, Expected> = {
  // auth
  'post /auth/register': { status: '201', kind: 'json' },
  'post /auth/login': { status: '200', kind: 'json' },
  'post /auth/logout': { status: '204', kind: 'none' },
  'post /auth/refresh': { status: '200', kind: 'json' },
  'get /auth/me': { status: '200', kind: 'json' },
  'patch /auth/me': { status: '200', kind: 'json' },
  'post /auth/me/avatar': { status: '201', kind: 'json' },
  'delete /auth/me/avatar': { status: '204', kind: 'none' },
  'post /auth/step-up': { status: '200', kind: 'json' },
  'get /auth/sessions': { status: '200', kind: 'json' },
  'delete /auth/sessions/{sessionId}': { status: '204', kind: 'none' },
  'delete /auth/sessions': { status: '204', kind: 'none' },
  'post /auth/forgot-password': { status: '200', kind: 'json' },
  'post /auth/reset-password': { status: '204', kind: 'none' },
  'post /auth/verify-email': { status: '204', kind: 'none' },
  'post /auth/resend-verification': { status: '200', kind: 'json' },
  // oauth
  'get /auth/oauth/providers': { status: '200', kind: 'json' },
  'get /auth/oauth/{provider}': { status: '302', kind: 'redirect' },
  'get /auth/oauth/{provider}/link': { status: '302', kind: 'redirect' },
  'get /auth/oauth/{provider}/callback': { status: '302', kind: 'redirect' },
  'post /auth/oauth/{provider}/callback': { status: '302', kind: 'redirect' },
  'post /auth/oauth/exchange': { status: '200', kind: 'json' },
  // auth-invites
  'post /auth/invites/accept': { status: '200', kind: 'json' },
  // admin
  'get /admin/users': { status: '200', kind: 'json' },
  'patch /admin/users/{id}': { status: '200', kind: 'json' },
  'post /admin/cleanup': { status: '200', kind: 'json' },
  'get /admin/organizations': { status: '200', kind: 'json' },
  // api-keys
  'post /api-keys': { status: '201', kind: 'json' },
  'get /api-keys': { status: '200', kind: 'json' },
  'delete /api-keys/{id}': { status: '204', kind: 'none' },
  // organizations
  'post /organizations': { status: '201', kind: 'json' },
  'get /organizations': { status: '200', kind: 'json' },
  'get /organizations/{id}': { status: '200', kind: 'json' },
  'patch /organizations/{id}': { status: '200', kind: 'json' },
  'delete /organizations/{id}': { status: '204', kind: 'none' },
  'post /organizations/{id}/switch': { status: '200', kind: 'json' },
  // members
  'post /organizations/{orgId}/members/invite': { status: '202', kind: 'json' },
  'delete /organizations/{orgId}/members/{userId}': { status: '204', kind: 'none' },
  'post /organizations/{orgId}/members/{userId}/roles/{roleId}': { status: '204', kind: 'none' },
  'delete /organizations/{orgId}/members/{userId}/roles/{roleId}': { status: '204', kind: 'none' },
  // roles
  'get /organizations/{orgId}/roles': { status: '200', kind: 'json' },
  'post /organizations/{orgId}/roles': { status: '201', kind: 'json' },
  'patch /organizations/{orgId}/roles/{roleId}': { status: '200', kind: 'json' },
  'delete /organizations/{orgId}/roles/{roleId}': { status: '204', kind: 'none' },
  'post /organizations/{orgId}/roles/{roleId}/permissions': { status: '201', kind: 'json' },
  'delete /organizations/{orgId}/roles/{roleId}/permissions/{permId}': {
    status: '204',
    kind: 'none',
  },
  // invites
  'get /organizations/{orgId}/invites': { status: '200', kind: 'json' },
  'delete /organizations/{orgId}/invites/{inviteId}': { status: '204', kind: 'none' },
  // notifications (Arc A.6 — feed/preferences/master-toggle)
  'get /notifications': { status: '200', kind: 'json' },
  'get /notifications/unread-count': { status: '200', kind: 'json' },
  'post /notifications/read-all': { status: '200', kind: 'json' },
  'post /notifications/{id}/read': { status: '204', kind: 'none' },
  'post /notifications/{id}/archive': { status: '204', kind: 'none' },
  'get /notifications/capabilities': { status: '200', kind: 'json' },
  'get /notifications/preferences': { status: '200', kind: 'json' },
  'put /notifications/preferences': { status: '204', kind: 'none' },
  'patch /notifications/settings': { status: '204', kind: 'none' },
  // notifications Telegram linking (Arc D — the webhook route is @ApiExcludeEndpoint, not here)
  'post /notifications/telegram/link': { status: '201', kind: 'json' },
  'get /notifications/telegram/connection': { status: '200', kind: 'json' },
  'delete /notifications/telegram/connection': { status: '204', kind: 'none' },
  // notifications realtime (Arc C — SSE stream, text/event-stream not JSON)
  'get /notifications/stream': { status: '200', kind: 'stream' },
  // ai (Track C — ADR-054, Arc C: conversation + durable-run create/fetch)
  'post /ai/conversations': { status: '201', kind: 'json' },
  'get /ai/conversations/{id}': { status: '200', kind: 'json' },
  'post /ai/runs': { status: '201', kind: 'json' },
  'get /ai/runs': { status: '200', kind: 'json' },
  'get /ai/runs/{id}': { status: '200', kind: 'json' },
  'post /ai/runs/{id}/cancel': { status: '200', kind: 'json' },
  // ai approvals (Arc E — human-in-the-loop decision surface)
  'get /ai/approvals': { status: '200', kind: 'json' },
  'post /ai/approvals/{id}/decision': { status: '200', kind: 'json' },
  // ai realtime (Arc C — status-only SSE stream, text/event-stream not JSON)
  'get /ai/runs/{id}/stream': { status: '200', kind: 'stream' },
  // metrics — Prometheus exposition (text, not JSON)
  'get /metrics': { status: '200', kind: 'text' },
}

describe('OpenAPI success surface (e2e)', () => {
  let app: INestApplication
  let context: E2ETestContext
  let document: OpenAPIObject

  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
  const EXCLUDED_PREFIXES = ['/health']

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app

    const config = new DocumentBuilder()
      .setTitle('AMCore API')
      .addBearerAuth()
      .addCookieAuth('refresh_token')
      .build()
    document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config))
  }, 120000)

  afterAll(async () => {
    if (context) {
      await teardownE2ETest(context)
    }
  }, 120000)

  const isExcluded = (path: string): boolean =>
    EXCLUDED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))

  const jsonSchema = (response: Record<string, unknown> | undefined): object | undefined =>
    (response?.content as Record<string, { schema?: object }> | undefined)?.['application/json']
      ?.schema
  const textSchema = (response: Record<string, unknown> | undefined): object | undefined =>
    (response?.content as Record<string, { schema?: object }> | undefined)?.['text/plain']?.schema
  const eventStreamSchema = (response: Record<string, unknown> | undefined): object | undefined =>
    (response?.content as Record<string, { schema?: object }> | undefined)?.['text/event-stream']
      ?.schema
  const nonEmpty = (schema: object | undefined): boolean =>
    !!schema && Object.keys(schema).length > 0

  // Collect every documented operation as `${method} ${path}` → responses.
  const collectOperations = (): Map<string, Record<string, object>> => {
    const ops = new Map<string, Record<string, object>>()
    for (const [path, item] of Object.entries(document.paths)) {
      if (isExcluded(path)) continue
      for (const method of HTTP_METHODS) {
        const op = (item as Record<string, { responses?: Record<string, object> }>)[method]
        if (op) ops.set(`${method} ${path}`, op.responses ?? {})
      }
    }
    return ops
  }

  it('documents exactly the expected success status and body kind for every operation', () => {
    const ops = collectOperations()
    const violations: string[] = []

    // 1. Every documented operation must be in the inventory (forces a new
    //    handler to be added here — the guard).
    for (const key of ops.keys()) {
      if (!EXPECTED[key]) violations.push(`${key}: documented but missing from the test inventory`)
    }

    // 2. Every inventory entry must be documented (catches removed/renamed ops).
    for (const key of Object.keys(EXPECTED)) {
      if (!ops.has(key)) violations.push(`${key}: in the inventory but not documented`)
    }

    // 3. Each operation documents exactly the expected success status and a
    //    body of the expected kind, with no conflicting extra success status.
    for (const [key, responses] of ops) {
      const expected = EXPECTED[key]
      if (!expected) continue

      const successCodes = Object.keys(responses).filter((c) => /^[23]\d\d$/.test(c))
      if (successCodes.length !== 1) {
        violations.push(
          `${key}: expected exactly one success status, got [${successCodes.join(', ')}]`
        )
        continue
      }
      const [code] = successCodes
      if (code !== expected.status) {
        violations.push(`${key}: expected status ${expected.status}, documented ${code}`)
        continue
      }

      const response = responses[code] as Record<string, unknown>
      switch (expected.kind) {
        case 'json':
          if (!nonEmpty(jsonSchema(response))) {
            violations.push(`${key}: ${code} has no application/json body schema`)
          }
          break
        case 'text':
          if (!nonEmpty(textSchema(response))) {
            violations.push(`${key}: ${code} has no text/plain body schema`)
          }
          break
        case 'stream':
          if (!nonEmpty(eventStreamSchema(response))) {
            violations.push(`${key}: ${code} has no text/event-stream body schema`)
          }
          break
        case 'none':
          if (jsonSchema(response)) violations.push(`${key}: ${code} must not carry a body schema`)
          break
        case 'redirect':
          // 3xx already asserted by the status match; redirects carry no body.
          break
      }
    }

    expect(violations).toEqual([])
  })
})
