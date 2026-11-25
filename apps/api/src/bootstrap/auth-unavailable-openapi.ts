import { isDeepStrictEqual } from 'node:util'

import type { OpenAPIObject } from '@nestjs/swagger'

import { addCommonError, httpExceptionSchema } from './common-error-openapi.js'

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const
const UNAVAILABLE_CODE = 'SERVICE_UNAVAILABLE'

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>
type ResponseObject = NonNullable<NonNullable<Operation['responses']>[string]>
type Described = Exclude<ResponseObject, { $ref: string }>

/** OAuth steps that use Redis for their one-time state or ticket. The provider list does not. */
function isOAuthRedisStep(path: string): boolean {
  const oauth = path.indexOf('/auth/oauth')
  if (oauth === -1) return false
  const rest = path.slice(oauth + '/auth/oauth'.length)
  return rest !== '/providers'
}

/** Each sentence carries a marker so a rerun or a test can tell which outcome is documented. */
export const ADMISSION_503_MARKER = 'admission could not finish'
export const OAUTH_503_MARKER = 'one-time OAuth step'

const ADMISSION_503 =
  `Authentication temporarily unavailable (errorCode ${UNAVAILABLE_CODE}): ${ADMISSION_503_MARKER} ` +
  'within its deadline because a dependency such as Redis was slow or down. The handler did ' +
  'not run. Retry later with backoff.'

const OAUTH_503 =
  `A ${OAUTH_503_MARKER} could not use Redis in time (errorCode ${UNAVAILABLE_CODE}). The operation ` +
  'may have partly completed: an account or provider link can already be saved. Start sign-in again.'

/**
 * Documents the dependency-unavailable answers for every operation that can return them.
 * An operation's own `503` (abuse counters, health, member API keys, organization creation)
 * keeps its description, codes and schema; the admission or OAuth case is merged into it so a
 * client can tell the meanings apart. A shared component response is copied inline first, so the
 * component itself is never changed.
 */
export function addAuthUnavailableResponses(document: OpenAPIObject): void {
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of METHODS) {
      const operation = item?.[method]
      if (!operation) continue
      const oauth = isOAuthRedisStep(path)
      const protectedOperation = operation.security?.some(
        (requirement) => 'bearer' in requirement || 'apiKeyBearer' in requirement
      )
      if (protectedOperation && !operation.responses['401'])
        addCommonError(document, operation, '401', 'A valid bearer credential is required.')
      if (!oauth && !protectedOperation) continue
      const additions = [
        ...(protectedOperation ? [{ marker: ADMISSION_503_MARKER, text: ADMISSION_503 }] : []),
        ...(oauth ? [{ marker: OAUTH_503_MARKER, text: OAUTH_503 }] : []),
      ]
      operation.responses['503'] = mergeUnavailable(document, operation.responses['503'], additions)
    }
  }
}

function mergeUnavailable(
  document: OpenAPIObject,
  existing: ResponseObject | undefined,
  additions: { marker: string; text: string }[]
): ResponseObject {
  const base = existing ? resolveResponse(document, existing) : undefined
  if (existing && !base) return existing
  const added = additions.filter(({ marker }) => !base?.description.includes(marker))
  if (base && !added.length) return base
  const description = [base?.description, ...added.map(({ text }) => text)]
    .filter(Boolean)
    .join(' ')
  const json = base?.content?.['application/json']
  const schema = json?.schema
  const common = unavailableJson.schema
  const sharedError =
    schema && '$ref' in schema && schema.$ref === '#/components/schemas/HttpExceptionResponse'
  const merged = !schema
    ? base
      ? httpExceptionSchema
      : common
    : sharedError ||
        isDeepStrictEqual(schema, common) ||
        isDeepStrictEqual(schema, httpExceptionSchema)
      ? schema
      : { anyOf: [schema, common] }

  return {
    ...base,
    description,
    content: { ...base?.content, 'application/json': { ...json, schema: merged } },
  }
}

function resolveResponse(document: OpenAPIObject, response: ResponseObject): Described | undefined {
  if (!('$ref' in response)) return response
  const prefix = '#/components/responses/'
  if (!response.$ref.startsWith(prefix)) return undefined
  const name = response.$ref.slice(prefix.length).replaceAll('~1', '/').replaceAll('~0', '~')
  const target = document.components?.responses?.[name]
  return target && !('$ref' in target) ? structuredClone(target) : undefined
}

const unavailableJson = {
  schema: {
    type: 'object' as const,
    required: ['statusCode', 'message', 'timestamp', 'path', 'method', 'errorCode'],
    properties: {
      statusCode: { type: 'integer', enum: [503] },
      message: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
      path: { type: 'string' },
      method: { type: 'string' },
      correlationId: { type: 'string' },
      errorCode: { type: 'string', enum: [UNAVAILABLE_CODE] },
    },
  },
}
