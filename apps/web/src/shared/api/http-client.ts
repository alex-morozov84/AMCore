import type { ApiErrorResponse } from './types'

/**
 * A non-2xx response with a parsed (or unparseable) body. Replaces
 * `AxiosError<ApiErrorResponse>` now that every browser->backend call goes
 * through the same-origin BFF (ADR-068) instead of axios calling `apps/api`
 * directly with a bearer token attached client-side.
 */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorResponse | undefined,
    /** Whole seconds from a `Retry-After` response header (RFC 9110, ADR-073), when present. */
    public readonly retryAfterSeconds?: number
  ) {
    super(body?.message ?? `Request failed with status ${status}`)
    this.name = 'ApiRequestError'
  }
}

/**
 * Parse a `Retry-After` header (RFC 9110 §10.2.3). AMCore's own global
 * rate-limit guard only ever emits the delay-seconds form (a non-negative
 * integer), never the HTTP-date form, so that's the only shape parsed here
 * — an HTTP-date value (or anything else non-numeric) is intentionally
 * ignored rather than guessed at.
 */
function parseRetryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get('Retry-After')
  if (raw === null) return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

/** `fetch()` itself rejected — offline, DNS, a dropped connection. Replaces axios's `ERR_NETWORK`. */
export class ApiNetworkError extends Error {
  constructor(cause: unknown) {
    super('Network request failed', { cause })
    this.name = 'ApiNetworkError'
  }
}

async function safeJson(response: Response): Promise<ApiErrorResponse | undefined> {
  try {
    return (await response.json()) as ApiErrorResponse
  } catch {
    return undefined
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, init)
  } catch (error) {
    throw new ApiNetworkError(error)
  }

  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      await safeJson(response),
      parseRetryAfterSeconds(response.headers)
    )
  }

  // Matches `/api/auth/logout`'s own contract, but written generically —
  // any future no-content BFF response is handled the same way.
  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }
}

/**
 * No `Content-Type` header: the browser must set its own
 * `multipart/form-data; boundary=...` from the `FormData` object, which a
 * manually-set header would override and break.
 */
function formInit(method: string, body: FormData): RequestInit {
  return { method, body }
}

/**
 * Same-origin BFF client (ADR-068). No `baseURL` (relative paths land on
 * this Next app's own `/api/*` Route Handlers, never `apps/api` directly),
 * no manual `Authorization` header (the BFF attaches it server-side from
 * the Redis-held access token), no manual `credentials` option (browser
 * `fetch` already defaults to `credentials: 'same-origin'`, which is
 * exactly what's needed to send `amcore_session`).
 */
export const apiClient = {
  get: <T>(path: string): Promise<T> => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, jsonInit('POST', body)),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, jsonInit('PATCH', body)),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, jsonInit('PUT', body)),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, body: FormData): Promise<T> =>
    request<T>(path, formInit('POST', body)),
}
