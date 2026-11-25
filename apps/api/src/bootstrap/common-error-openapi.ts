import type { OpenAPIObject } from '@nestjs/swagger'

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>

export const httpExceptionSchema = {
  type: 'object' as const,
  required: ['statusCode', 'message', 'timestamp', 'path', 'method'],
  properties: {
    statusCode: { type: 'integer' },
    message: { type: 'string' },
    errorCode: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
    path: { type: 'string' },
    method: { type: 'string' },
    correlationId: { type: 'string' },
    stack: { type: 'string', description: 'Development only' },
    details: { type: 'object', additionalProperties: true },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['field', 'message'],
        properties: {
          field: { type: 'string' },
          message: { type: 'string' },
          code: { type: 'string' },
          errorCode: { type: 'string' },
        },
      },
    },
  },
}

export function addCommonError(
  document: OpenAPIObject,
  operation: Operation,
  status: '401' | '429',
  description: string
): void {
  document.components ??= {}
  document.components.schemas ??= {}
  document.components.schemas.HttpExceptionResponse ??= httpExceptionSchema
  const response = operation.responses[status]
  const existing =
    response && '$ref' in response
      ? document.components.responses?.[response.$ref.split('/').at(-1) ?? '']
      : response
  if ((response && !existing) || (existing && '$ref' in existing)) return

  const json = existing?.content?.['application/json']
  const common = { $ref: '#/components/schemas/HttpExceptionResponse' }
  const declared = json?.schema
  const alreadyCommon = declared && '$ref' in declared && declared.$ref === common.$ref
  operation.responses[status] = {
    ...existing,
    ...(existing?.headers && { headers: { ...existing.headers } }),
    description: [existing?.description, description].filter(Boolean).join(' '),
    content: {
      ...existing?.content,
      'application/json': {
        ...json,
        schema: declared && !alreadyCommon ? { anyOf: [declared, common] } : common,
      },
    },
  }
}
