import type { RequestPrincipal } from '@amcore/shared'
import { SystemRole } from '@amcore/shared'

import {
  interpolateConditions,
  UnresolvedConditionPlaceholderError,
} from './interpolate-conditions'

describe('interpolateConditions', () => {
  const principal: RequestPrincipal = {
    type: 'jwt',
    sub: 'user-123',
    systemRole: SystemRole.User,
    organizationId: 'org-1',
    aclVersion: 5,
  }

  it('resolves a known top-level path', () => {
    expect(interpolateConditions({ assignedToId: '${user.sub}' }, principal)).toEqual({
      assignedToId: 'user-123',
    })
  })

  it('resolves a known nested path', () => {
    expect(interpolateConditions({ orgId: '${user.organizationId}' }, principal)).toEqual({
      orgId: 'org-1',
    })
  })

  it('fails closed when a known field is legitimately absent on this principal (e.g. no org context), not just on a typo', () => {
    const noOrg: RequestPrincipal = { ...principal, organizationId: undefined }
    expect(() => interpolateConditions({ orgId: '${user.organizationId}' }, noOrg)).toThrow(
      UnresolvedConditionPlaceholderError
    )
  })

  it('passes through non-template fields unchanged, including literal null', () => {
    expect(interpolateConditions({ deletedAt: null, active: true }, principal)).toEqual({
      deletedAt: null,
      active: true,
    })
  })

  it('fails closed on an unknown top-level placeholder instead of silently widening the condition', () => {
    expect(() =>
      interpolateConditions({ assignedToId: '${user.doesNotExist}' }, principal)
    ).toThrow(UnresolvedConditionPlaceholderError)
  })

  it('fails closed on an unknown nested placeholder', () => {
    expect(() => interpolateConditions({ assignedToId: '${user.foo.bar}' }, principal)).toThrow(
      UnresolvedConditionPlaceholderError
    )
  })

  it('fails closed when only one of several fields has an unresolvable placeholder', () => {
    expect(() =>
      interpolateConditions(
        { orgId: '${user.organizationId}', ownerId: '${user.missing}' },
        principal
      )
    ).toThrow(UnresolvedConditionPlaceholderError)
  })

  it('includes the offending path in the error message', () => {
    expect(() => interpolateConditions({ x: '${user.bogus}' }, principal)).toThrow(
      'unresolved placeholder "${user.bogus}"'
    )
  })
})
