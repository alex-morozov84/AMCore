import { AuthType } from '@amcore/shared'

import { AUTH_TYPE_KEY } from '../auth/decorators/auth.decorator'
import { REQUEST_CONTEXT_POLICY } from '../auth/organization-context/request-context-policy'

import { AuthInvitesController } from './auth-invites.controller'
import { InvitesController } from './invites.controller'
import { MembersController } from './members.controller'

/** Metadata invariants; wire/body/status contracts are proved by OpenAPI and HTTP e2e. */
describe('invitation controller boundaries', () => {
  it('has no legacy member invitation handler or class-wide API-key invitation grant', () => {
    expect('invite' in MembersController.prototype).toBe(false)
    expect(Reflect.getMetadata(AUTH_TYPE_KEY, InvitesController)).toEqual([AuthType.Bearer])
    expect(Reflect.getMetadata(AUTH_TYPE_KEY, AuthInvitesController)).toEqual([AuthType.Bearer])
  })

  it.each(['create', 'reissue', 'revokeInvite', 'listInvites', 'roleChoices'] as const)(
    'requires actual organization context for %s',
    (method) => {
      const policy = Reflect.getMetadata(
        REQUEST_CONTEXT_POLICY,
        InvitesController.prototype[method]
      )
      expect(policy).toEqual({ kind: 'organization', selector: { param: 'orgId' } })
      expect(policy.legacyPlatformMembershipBypass).toBeUndefined()
    }
  )

  it.each(['accept', 'inspect', 'inspectContinuation', 'operation'] as const)(
    'keeps recipient %s independent of organization membership',
    (method) => {
      expect(
        Reflect.getMetadata(REQUEST_CONTEXT_POLICY, AuthInvitesController.prototype[method])
      ).toEqual({ kind: 'personal' })
    }
  )
})
