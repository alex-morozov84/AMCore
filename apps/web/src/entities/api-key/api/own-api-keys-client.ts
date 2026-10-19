import {
  type ApiKeyQuery,
  contextSessionBindingSchema,
  type CreateApiKeyInput,
  OWN_KEY_CLIENT_TIMEOUT_MS,
  OWN_KEY_ENVELOPE_BYTES,
  ownKeyCreatedSchema,
  ownKeyCreateSchema,
  ownKeyListSchema,
  type OwnKeyOrganizationsQuery,
  ownKeyOrganizationsQuerySchema,
  ownKeyOrganizationsSchema,
  ownKeyQuerySchema,
  ownKeyRevokedSchema,
  ownKeySessionSchema,
} from '@amcore/shared'
import { z } from 'zod'

import { ApiRequestError } from '@/shared/api/http-client'
import { parseRetryAfterSeconds } from '@/shared/api/retry-after'

import 'client-only'

async function boundedJson(response: Response, cap: number): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('INVALID_UPSTREAM_RESPONSE')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > cap) throw new Error('INVALID_UPSTREAM_RESPONSE')
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new Error('INVALID_UPSTREAM_RESPONSE')
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
async function command<T>(
  binding: string,
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  method = 'GET',
  body?: unknown,
  session = false
): Promise<T> {
  const response = await fetch(`/api/own-api-keys${path}`, {
    method,
    cache: 'no-store',
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(session ? 5000 : OWN_KEY_CLIENT_TIMEOUT_MS),
    ]),
    headers: {
      'X-AMCore-Context-Session': binding,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    // Never retain a raw error payload: even a broken server can echo a credential into it.
    const code =
      response.status === 401
        ? 'UNAUTHORIZED'
        : response.status === 409
          ? 'CONTEXT_SESSION_CHANGED'
          : response.status === 429
            ? 'RATE_LIMIT_EXCEEDED'
            : 'UNKNOWN_ERROR'
    throw new ApiRequestError(
      response.status,
      {
        statusCode: response.status,
        errorCode: code,
        message: code,
        timestamp: '',
        path: '',
        method: '',
      },
      parseRetryAfterSeconds(response.headers)
    )
  }
  if (response.status !== (method === 'POST' ? 201 : 200))
    throw new Error('INVALID_UPSTREAM_RESPONSE')
  const raw = await boundedJson(
    response,
    session ? 2048 : path.startsWith('/organizations') ? 36864 : OWN_KEY_ENVELOPE_BYTES
  )
  const parsed = z
    .strictObject({ binding: contextSessionBindingSchema, data: schema })
    .safeParse(raw)
  if (!parsed.success) throw new Error('INVALID_UPSTREAM_RESPONSE')
  if (parsed.data.binding !== binding) throw new ApiRequestError(409, undefined)
  return parsed.data.data
}
export const ownApiKeysClient = {
  organizations: (binding: string, query: OwnKeyOrganizationsQuery, signal: AbortSignal) => {
    const params = new URLSearchParams(
      Object.entries(ownKeyOrganizationsQuerySchema.parse(query))
        .filter(([, value]) => value !== undefined)
        .map(([k, v]) => [k, String(v)])
    )
    return command(binding, `/organizations?${params}`, ownKeyOrganizationsSchema, signal)
  },
  list: (binding: string, query: ApiKeyQuery, signal: AbortSignal) => {
    const params = new URLSearchParams(
      Object.entries(ownKeyQuerySchema.parse(query))
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)])
    )
    return command(binding, `?${params}`, ownKeyListSchema, signal)
  },
  create: (binding: string, input: CreateApiKeyInput, signal: AbortSignal) =>
    command(binding, '', ownKeyCreatedSchema, signal, 'POST', ownKeyCreateSchema.parse(input)),
  revoke: (binding: string, id: string, signal: AbortSignal) =>
    command(binding, `/${encodeURIComponent(id)}`, ownKeyRevokedSchema, signal, 'DELETE'),
  verify: (binding: string, signal: AbortSignal) =>
    command(binding, '/session', ownKeySessionSchema, signal, 'GET', undefined, true),
}
