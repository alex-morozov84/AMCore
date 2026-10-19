import type { OpenAPIObject } from '@nestjs/swagger'

const HEADER_COMPONENT = 'CorrelationId'

/** Every API response carries `X-Correlation-Id`; document it once and reference it everywhere. */
export function addCorrelationHeader(document: OpenAPIObject): void {
  document.components ??= {}
  document.components.headers ??= {}
  document.components.headers[HEADER_COMPONENT] = {
    description:
      'The request correlation ID, also the `correlationId` of error bodies and the `correlationId` ' +
      'field of this request’s log lines. It echoes a well-formed `X-Request-ID` or ' +
      '`X-Correlation-ID` request header (1–128 characters of `A-Za-z0-9._:-`) and is a generated ' +
      'UUID otherwise. A search aid only: a client chooses it, so it proves nothing about identity.',
    schema: { type: 'string', maxLength: 128, pattern: '^[A-Za-z0-9._:-]{1,128}$' },
  }
  for (const item of Object.values(document.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const) {
      for (const response of Object.values(item?.[method]?.responses ?? {})) {
        if (!response || '$ref' in response) continue
        response.headers = {
          ...response.headers,
          'X-Correlation-Id': { $ref: `#/components/headers/${HEADER_COMPONENT}` },
        }
      }
    }
  }
}
