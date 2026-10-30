import type { RequestPrincipal } from '@amcore/shared'

import type { MfaPrimaryProjection } from './mfa-primary-projection.schema.js'

const enclosingGuard = new WeakSet<object>()
const projections = new WeakMap<
  object,
  { principal: RequestPrincipal; projection: MfaPrimaryProjection }
>()

/** Clear on each credential selection. Only the global guard can select this request-bound path. */
export function beginJwtPrimaryAdmission(request: object): () => void {
  projections.delete(request)
  enclosingGuard.add(request)
  return () => enclosingGuard.delete(request)
}
export function hasEnclosingJwtAdmission(request: object): boolean {
  return enclosingGuard.has(request)
}
export function retainJwtPrimaryProjection(
  request: object,
  principal: RequestPrincipal,
  projection: MfaPrimaryProjection
): void {
  if (!enclosingGuard.has(request)) throw new Error('Enclosing JWT admission required')
  projections.set(request, { principal, projection })
}
/** Consumed once for exactly the selected principal; refresh or another credential must read again. */
export function takeJwtPrimaryProjection(
  request: object,
  principal: RequestPrincipal
): MfaPrimaryProjection | null {
  const value = projections.get(request)
  projections.delete(request)
  return value?.principal === principal ? value.projection : null
}
