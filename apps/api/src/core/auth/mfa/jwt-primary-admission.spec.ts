import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import {
  beginJwtPrimaryAdmission,
  hasEnclosingJwtAdmission,
  retainJwtPrimaryProjection,
  takeJwtPrimaryProjection,
} from './jwt-primary-admission.js'
import type { MfaPrimaryProjection } from './mfa-primary-projection.schema.js'

const principal: RequestPrincipal = { type: 'jwt', sub: 'own-user', systemRole: SystemRole.User }
const projection = {} as MfaPrimaryProjection
it('consumes a snapshot once, without preserving a grant across a later read', () => {
  const request = {},
    finish = beginJwtPrimaryAdmission(request)
  retainJwtPrimaryProjection(request, principal, projection)
  finish()
  expect(hasEnclosingJwtAdmission(request)).toBe(false)
  expect(takeJwtPrimaryProjection(request, principal)).toBe(projection)
  expect(takeJwtPrimaryProjection(request, principal)).toBeNull()
})
it('rejects another principal identity and clears evidence on another credential selection', () => {
  const request = {},
    finish = beginJwtPrimaryAdmission(request)
  retainJwtPrimaryProjection(request, principal, projection)
  expect(takeJwtPrimaryProjection(request, { ...principal })).toBeNull()
  retainJwtPrimaryProjection(request, principal, projection)
  const again = beginJwtPrimaryAdmission(request)
  expect(takeJwtPrimaryProjection(request, principal)).toBeNull()
  again()
  finish()
})
it('cannot retain primary evidence from a caller header or an unmarked request', () => {
  expect(() =>
    retainJwtPrimaryProjection({ headers: { 'x-primary-admitted': 'true' } }, principal, projection)
  ).toThrow('Enclosing JWT admission required')
})
