import { AppException } from '../../common/exceptions/domain/app.exception'

export function establishmentError(code: string, status = 409): AppException {
  return new AppException(
    code,
    status,
    code,
    code === 'SETUP_BUSY'
      ? { state: 'unavailable', retryAfterSeconds: 1 }
      : code === 'SETUP_UNCONFIRMED'
        ? { state: 'unavailable' }
        : undefined
  )
}

export function databaseCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
}

export function databaseSqlState(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const value = error as {
    meta?: {
      code?: string
      driverAdapterError?: {
        cause?: { originalCode?: string }
      }
    }
  }
  return value.meta?.driverAdapterError?.cause?.originalCode ?? value.meta?.code
}

export function establishmentFailure(error: unknown, setup: boolean): never {
  if (error instanceof AppException) throw error
  const code = databaseCode(error)
  const state = databaseSqlState(error)
  if (setup && (state === '42501' || code === 'P2021' || code === 'P2022'))
    throw establishmentError('SETUP_NOT_READY')
  if (code === 'P2034' || state === '40P01' || state === '55P03')
    throw establishmentError(
      setup ? 'SETUP_BUSY' : 'ORGANIZATION_CREATION_CONFLICT',
      setup ? 503 : 409
    )
  throw establishmentError(setup ? 'SETUP_UNCONFIRMED' : 'ORGANIZATION_CREATION_UNCONFIRMED', 503)
}

/** Only an exact organization slug violation proves this attempt rolled back. */
export function isOrganizationSlugConflict(error: unknown): boolean {
  if (databaseCode(error) !== 'P2002' || !error || typeof error !== 'object') return false
  const meta = (error as { meta?: Record<string, unknown> }).meta
  if (meta?.modelName !== 'Organization') return false
  const index = (
    meta.driverAdapterError as { cause?: { constraint?: { index?: string } } } | undefined
  )?.cause?.constraint?.index
  if (index !== undefined) return index === 'organizations_slug_key'
  const target = meta.target
  return (
    (Array.isArray(target) && target.length === 1 && target[0] === 'slug') ||
    target === 'organizations_slug_key'
  )
}

/** Resolve only a canonical-email race; unrelated uniqueness failures never retry preparation. */
export function isCanonicalEmailConflict(error: unknown): boolean {
  if (databaseCode(error) !== 'P2002' || !error || typeof error !== 'object') return false
  const meta = (
    error as {
      meta?: {
        modelName?: string
        target?: unknown
        driverAdapterError?: {
          cause?: { constraint?: { index?: string } }
        }
      }
    }
  ).meta
  if (meta?.modelName !== 'User') return false
  const index = meta.driverAdapterError?.cause?.constraint?.index
  if (index !== undefined) return index === 'users_emailCanonical_key'
  return (
    Array.isArray(meta.target) && meta.target.length === 1 && meta.target[0] === 'emailCanonical'
  )
}
