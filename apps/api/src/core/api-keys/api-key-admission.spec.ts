import type { RequestPrincipal } from '@amcore/shared'
import { SystemRole } from '@amcore/shared'

import { invitationActor } from '../organizations/invitation-actor'

import { apiKeyAdmission, registerApiKeyAdmission } from './api-key-admission'

const owner: RequestPrincipal = {
  type: 'api_key',
  sub: 'owner',
  organizationId: 'org',
  scopes: ['manage:TeamAccess'],
  systemRole: SystemRole.User,
}

describe('Request-local cryptographic key evidence', () => {
  it('rejects principal/body key-ID spoofing without cryptographic registration', () => {
    const user = { ...owner, keyId: 'forged-key' }
    const request = {
      user,
      keyId: 'forged-key',
      privilegedAdmission: { authenticated: user, principal: user },
    }
    expect(() => invitationActor(request)).toThrow()
  })
  it('retains exact evidence through effective principal cloning without serializing into principal', () => {
    const user = { ...owner }
    const request = { user, privilegedAdmission: { authenticated: owner, principal: user } }
    registerApiKeyAdmission(request, 'verified-key', owner)
    const actor = invitationActor(request)
    expect(actor.key?.keyId).toBe('verified-key')
    expect(actor.principal).not.toHaveProperty('keyId')
    expect(JSON.stringify(actor.principal)).not.toContain('verified-key')
    expect(() => apiKeyAdmission({ ...request }, owner)).toThrow()
    expect(() => apiKeyAdmission(request, { ...owner, sub: 'other' })).toThrow()
    expect(() => apiKeyAdmission(request, { ...owner, organizationId: 'other' })).toThrow()
    expect(() => apiKeyAdmission(request, { ...owner, scopes: [] })).toThrow()
  })
})
