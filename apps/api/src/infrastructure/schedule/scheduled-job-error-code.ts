/**
 * The error classes a job may report by name. The list is closed on purpose: a name outside it is
 * reported as `unexpected`, because a class name chosen by a library or by user input could carry
 * content. A job that needs a domain code returns `failed('its_code')` itself.
 */
export const SAFE_ERROR_CODES: ReadonlySet<string> = new Set([
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientInitializationError',
  'PrismaClientValidationError',
  'PrismaClientRustPanicError',
  'DatabaseError',
  'TimeoutError',
  'AbortError',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'AppException',
  'HttpException',
])

/** A code from a closed list: never a message and never an arbitrary name. */
export function errorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  return SAFE_ERROR_CODES.has(name) ? name : 'unexpected'
}
