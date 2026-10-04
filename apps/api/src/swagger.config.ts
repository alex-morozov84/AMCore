import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger'
import { cleanupOpenApiDoc } from 'nestjs-zod'

import { BULL_BOARD_MOUNT } from './infrastructure/queue/dashboard/bull-board-mount-state'

/** The one global prefix of the API (`main.ts` applies it; the OpenAPI paths carry it). */
export const API_GLOBAL_PREFIX = 'api/v1'

/**
 * Shared between `main.ts` (real bootstrap) and
 * `apps/api/test/openapi.e2e-spec.ts` (CI completeness gate) so the two
 * documents never silently drift apart.
 *
 * `apiKeyBearer` documents AMCore API keys as a **second named bearer
 * scheme**, not a separate `x-api-key` header: `ApiKeyGuard.parseApiKey()`
 * only reads `Authorization: Bearer amcore_live_<id>_<secret>` — there is no
 * `x-api-key` transport in this runtime. See `ai/models-talk.md` (Swagger/
 * OpenAPI completeness plan) for the design rationale.
 */
export function buildSwaggerConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('AMCore API')
    .setDescription('AMCore API documentation')
    .setVersion('0.0.1')
    .addBearerAuth()
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'amcore_live_<id>_<secret>',
        description:
          'AMCore API key sent as a bearer token: ' +
          '`Authorization: Bearer amcore_live_<id>_<secret>`. ' +
          'See docs/auth/api-keys.md.',
      },
      'apiKeyBearer'
    )
    .addCookieAuth('refresh_token')
    .build()
}

/**
 * The queue board is an Express-mounted UI, not a Nest controller, so the scanner cannot see it.
 * This adds its single documented operation. Nest decorators do NOT protect that mount (its
 * admission is a middleware); the description says what the middleware enforces. Added only when the
 * board is mounted, so a deployment without it documents nothing.
 */
export function addQueueBoardOperation(
  document: OpenAPIObject,
  mount: { readonly mounted: boolean },
  pathPrefix: string
): OpenAPIObject {
  if (!mount.mounted) return document
  const prefix = pathPrefix.replace(/^\/+|\/+$/g, '')
  const key = `${prefix ? `/${prefix}` : ''}/admin/queues`
  document.paths[key] = {
    get: {
      tags: ['admin'],
      summary: 'Read-only queue board (HTML) — SUPER_ADMIN only',
      description:
        'The Bull Board UI and its data API, mounted as Express middleware under this path. It is ' +
        'read-only: only GET and HEAD are served and any other method is answered with 405. ' +
        'Authentication is a middleware, not a Nest guard: a live SUPER_ADMIN bearer access token ' +
        '(sent by the Console BFF) or the browser `refresh_token` cookie; API keys are rejected. ' +
        'Raw job payloads, return values, error text, stack traces and logs are not displayed; a job ' +
        'shows its id, name and times and, for a queue with a reviewed projection, a few identifiers ' +
        '(template, locale and user id for email; notification id; AI run id). Errors carry only a ' +
        'fixed translation key.',
      security: [{ bearer: [] }, { cookie: [] }],
      responses: {
        '200': {
          description: 'The board page',
          content: { 'text/html': { schema: { type: 'string' } } },
        },
        '400': { description: 'The render context header of a bearer request is invalid' },
        '401': { description: 'No valid credential, or an API key was sent' },
        '403': { description: 'SUPER_ADMIN required' },
        '405': {
          description: 'Only GET and HEAD are served',
          headers: { Allow: { schema: { type: 'string' } } },
        },
        '500': { description: 'The page could not be rendered (fixed error body, no detail)' },
        '503': { description: 'Access could not be verified' },
      },
    },
  }
  return document
}

/**
 * The API document, built the same way by `main.ts` and the OpenAPI e2e suite. `pathPrefix` is the
 * global prefix the application was started with (`API_GLOBAL_PREFIX` in production, none in the
 * e2e harness).
 */
export function buildApiDocument(app: INestApplication, pathPrefix: string): OpenAPIObject {
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, buildSwaggerConfig()))
  return addQueueBoardOperation(document, BULL_BOARD_MOUNT, pathPrefix)
}
