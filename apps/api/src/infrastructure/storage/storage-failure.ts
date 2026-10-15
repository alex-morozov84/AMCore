export type StorageFailureClass = 'access_denied' | 'io_error'

/**
 * Collapse a provider or filesystem error into a safe class. Raw provider text (an
 * endpoint, a bucket name, a request id) never reaches an unauthenticated response.
 */
export function classifyFailure(error: unknown): StorageFailureClass {
  const e = error as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.code === 'EACCES' ||
    e?.code === 'EPERM' ||
    e?.name === 'AccessDenied' ||
    e?.$metadata?.httpStatusCode === 403
    ? 'access_denied'
    : 'io_error'
}
