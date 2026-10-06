import { invitationJsonLimit, invitationRequestKind } from './invitation-request-boundary'

describe('invitation transport boundary', () => {
  it.each(['/auth/invites/accept', '/auth/%69nvites/inspect', '/AUTH/INVITES/continuations'])(
    'classifies secret capabilities: %s',
    (path) => {
      expect(invitationRequestKind(`/api/v1${path}`, '/api/v1')).toBe('personal')
    }
  )
  it('classifies manager families independently of invitation targets', () => {
    expect(
      invitationRequestKind('/api/v1/organizations/org-id/invite-operations/id', '/api/v1')
    ).toBe('manager')
    expect(
      invitationRequestKind('/api/v1/organizations/org-id/invites/role-choices', '/api/v1')
    ).toBe('manager')
    expect(invitationRequestKind('/api/v1/organizations/org-id/members', '/api/v1')).toBeNull()
  })
  it('bounds small admission/acceptance independently of manager JSON', () => {
    expect(invitationJsonLimit('/api/v1/auth/invites/accept', '/api/v1')).toBe(2048)
    expect(invitationJsonLimit('/api/v1/AUTH/%69nvites/%61ccept/', '/api/v1')).toBe(2048)
    expect(invitationJsonLimit('/api/v1/auth//invites/continuations', '/api/v1')).toBe(2048)
    expect(invitationJsonLimit('/api/v1/auth/invites/continuations', '/api/v1')).toBe(2048)
    expect(invitationJsonLimit('/api/v1/organizations/org-id/invites', '/api/v1')).toBe(16384)
    expect(invitationJsonLimit('/api/v1/auth/login', '/api/v1')).toBeNull()
  })
})
