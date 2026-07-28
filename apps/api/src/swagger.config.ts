import { DocumentBuilder, type OpenAPIObject } from '@nestjs/swagger'

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
