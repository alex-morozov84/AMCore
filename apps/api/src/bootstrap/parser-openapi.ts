import type { OpenAPIObject } from '@nestjs/swagger'

/** Document parser refusals without replacing route-specific validation/domain responses. */
export function addParserResponses(document: OpenAPIObject): void {
  for (const item of Object.values(document.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const) {
      const operation = item?.[method]
      if (!operation?.requestBody) continue
      for (const [status, description] of [
        ['400', 'Malformed body/header, excessive form nesting or unsafe JSON keys'],
        ['413', 'Decoded body or form parameter limit exceeded (PAYLOAD_TOO_LARGE)'],
        ['415', 'Unsupported request charset, content encoding or media format'],
      ] as const) {
        operation.responses[status] ??= {
          description,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['statusCode', 'message', 'timestamp', 'path', 'method'],
                properties: {
                  statusCode: { type: 'integer', enum: [Number(status)] },
                  message: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  path: { type: 'string' },
                  method: { type: 'string' },
                  correlationId: { type: 'string' },
                  errorCode: { type: 'string' },
                },
              },
            },
          },
          ...(status === '415'
            ? {
                headers: {
                  'Accept-Encoding': {
                    description:
                      'Present for an unsupported content encoding, not a charset-only failure',
                    schema: { type: 'string', example: 'identity, gzip, deflate, br' },
                  },
                },
              }
            : {}),
        }
      }
    }
  }
}
