import type { OpenAPIObject } from '@nestjs/swagger'

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const

/** OAuth steps that use Redis for their one-time state or ticket. The provider list does not. */
function isOAuthRedisStep(path: string): boolean {
  const oauth = path.indexOf('/auth/oauth')
  if (oauth === -1) return false
  const rest = path.slice(oauth + '/auth/oauth'.length)
  return rest !== '/providers'
}

const ADMISSION_503 =
  'Authentication temporarily unavailable (errorCode SERVICE_UNAVAILABLE): admission could not ' +
  'finish within its deadline because a dependency such as Redis was slow or down. The handler did ' +
  'not run. Retry later with backoff.'

const OAUTH_503 =
  'A one-time OAuth step could not use Redis in time (errorCode SERVICE_UNAVAILABLE). The operation ' +
  'may have partly completed: an account or provider link can already be saved. Start sign-in again.'

/**
 * Documents the dependency-unavailable answer once, for every operation that can return it,
 * without replacing a specialized `503` an operation already declares (abuse counters, health,
 * member API keys and similar).
 */
export function addAuthUnavailableResponses(document: OpenAPIObject): void {
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of METHODS) {
      const operation = item?.[method]
      if (!operation) continue
      const oauth = isOAuthRedisStep(path)
      if (!oauth && !(operation.security && operation.security.length > 0)) continue
      const specialized = operation.responses['503']
      if (specialized) {
        // Keep the operation's own 503 and its decision codes; only add the OAuth Redis case,
        // which that text does not cover.
        if (oauth && 'description' in specialized && !specialized.description.includes('Redis'))
          specialized.description = `${specialized.description}. ${OAUTH_503}`
        continue
      }
      operation.responses['503'] = {
        description: oauth ? OAUTH_503 : ADMISSION_503,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['statusCode', 'message', 'timestamp', 'path', 'method', 'errorCode'],
              properties: {
                statusCode: { type: 'integer', enum: [503] },
                message: { type: 'string' },
                timestamp: { type: 'string', format: 'date-time' },
                path: { type: 'string' },
                method: { type: 'string' },
                correlationId: { type: 'string' },
                errorCode: { type: 'string', enum: ['SERVICE_UNAVAILABLE'] },
              },
            },
          },
        },
      }
    }
  }
}
