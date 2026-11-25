import type { OpenAPIObject } from '@nestjs/swagger'

import { addCommonError } from './common-error-openapi.js'

export const OPENAPI_RATE_LIMIT = 'x-amcore-rate-limit'

const RATE_LIMIT_HEADERS = {
  'X-RateLimit-Limit': 'Burst capacity.',
  'X-RateLimit-Remaining': 'Remaining requests in the current burst.',
  'X-RateLimit-Reset': 'Seconds until burst capacity is restored.',
}

export function addRateLimitResponses(document: OpenAPIObject): void {
  for (const item of Object.values(document.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const) {
      const operation = item?.[method]
      if (!operation) continue
      const metadata = operation as typeof operation & { [OPENAPI_RATE_LIMIT]?: boolean }
      const exempt = metadata[OPENAPI_RATE_LIMIT] === false
      delete metadata[OPENAPI_RATE_LIMIT]
      if (exempt) continue

      addCommonError(
        document,
        operation,
        '429',
        'The request limiter refused the request (RATE_LIMIT_EXCEEDED).'
      )

      for (const response of Object.values(operation.responses)) {
        if (!response || '$ref' in response) continue
        response.headers ??= {}
        for (const [name, description] of Object.entries(RATE_LIMIT_HEADERS)) {
          response.headers[name] ??= {
            description: `Present after the request limiter makes a decision. ${description}`,
            schema: { type: 'integer', minimum: 0 },
          }
        }
      }

      const limited = operation.responses['429']
      if (limited && !('$ref' in limited)) {
        limited.headers ??= {}
        limited.headers['Retry-After'] ??= {
          description:
            'Seconds to wait when the request limiter or a specific operation supplies a retry interval.',
          schema: { type: 'integer', minimum: 1 },
        }
      }
    }
  }
}
