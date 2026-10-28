import { randomBytes, randomUUID } from 'node:crypto'

import { AuthService } from '../../src/core/auth/auth.service.js'
import { MfaEncryptionService } from '../../src/core/auth/mfa/mfa-encryption.service.js'
import { mfaCredential } from '../../src/core/auth/mfa/mfa-secrets.js'
import { OAuthService } from '../../src/core/auth/oauth/oauth.service.js'
import { OAuthProviderFactory } from '../../src/core/auth/oauth/providers/oauth-provider.factory.js'
import {
  type InvitationHandoffProof,
  invitationHandoffProof,
} from '../../src/core/invitations/invitation-auth-handoff.js'
import { InvitationContinuationService } from '../../src/core/invitations/invitation-continuation.service.js'
import {
  carryInvitationBackend,
  trackInvitationOperation,
} from '../helpers/invitation-operation.js'
import type { InvitationProofFixture } from '../helpers/invitation-proof.js'
import { invitationFence, observeInvitationWait } from '../helpers/invitation-race.js'
import { createAuthorityAccount } from '../mfa-authority.fixture.js'

const jest = import.meta.jest

/** Both actual writers share a recipient, distinct attempts and an already-bound browser. */
export function registerSignupLockOrderProofs(getFixture: () => InvitationProofFixture): void {
  it.each(['oauth', 'registration'] as const)(
    'signup-email serializes %s first without a browser/account lock cycle',
    async (first) => {
      const f = getFixture(),
        db = f.prisma
      const user = await createAuthorityAccount(
        {
          clients: [db],
          codec: f.context.app.get(MfaEncryptionService),
        },
        false,
        'signup-lock@example.test'
      )
      const { token, invite } = await f.pending()
      await db.orgInvite.update({
        where: { id: invite.id },
        data: {
          email: user.user.email,
          emailCanonical: user.user.emailCanonical,
        },
      })
      const admission = await f.context.app.get(InvitationContinuationService).admit(token)
      await db.oAuthAccount.create({
        data: {
          userId: user.user.id,
          provider: 'GOOGLE',
          providerAccountId: 'signup-lock-provider',
        },
      })
      const factory = f.context.app.get(OAuthProviderFactory)
      const provider = jest.spyOn(factory, 'get').mockReturnValue({
        name: 'google',
        getAuthorizationURL: async (state: string) =>
          new URL(`https://provider.example.test?state=${state}`),
        exchangeCode: async () => ({ accessToken: '<fake-signup-lock-token>' }),
        getUserProfile: async () => ({
          provider: 'google',
          providerId: 'signup-lock-provider',
          email: user.user.email,
          emailVerified: true,
          displayName: null,
          avatarSourceUrl: null,
        }),
      })
      const handoff = (): InvitationHandoffProof =>
        invitationHandoffProof(randomBytes(16).toString('base64url'), mfaCredential())!
      const oauthHandoff = handoff(),
        registerHandoff = handoff()
      const oauth = f.context.app.get(OAuthService)
      const started = await oauth.getAuthorizationURL('google', undefined, {
        credential: admission.credential,
        attemptId: oauthHandoff.attemptId,
        handoff: oauthHandoff,
      })
      const state = new URL(started.url).searchParams.get('state')!
      const before = {
        sessions: await db.session.findMany(),
        families: await db.authSessionFamily.findMany(),
        flows: await db.mfaFlow.findMany(),
        users: await db.user.count(),
      }
      const operations = {
        oauth: () => oauth.handleCallback('google', '<fake-code>', state, started.browserNonce, {}),
        registration: () =>
          f.context.app
            .get(AuthService)
            .registerInvited(
              { password: '<fake-signup-password-Long123!>' },
              admission.credential,
              {
                handoff: registerHandoff,
                registrationBrowser: {
                  browser: user.requestBinding,
                  continuation: mfaCredential(),
                  vaultBinding: mfaCredential(),
                  operationId: randomUUID(),
                },
              }
            ),
      }
      const fence = invitationFence(
        db,
        (model, method, args) =>
          model === '$sql' &&
          method === '$executeRaw' &&
          args.some((arg) => typeof arg === 'string' && arg.startsWith('invitation-signup:'))
      )
      const run = (
        kind: keyof typeof operations
      ): { raw: Promise<unknown>; outcome: Promise<{ value: unknown; error: unknown }> } => {
        const raw = trackInvitationOperation<unknown>(() => operations[kind]())
        const outcome = raw.then(
          (value) => ({ value, error: undefined }),
          (error) => ({ value: undefined, error })
        )
        return { raw, outcome: carryInvitationBackend(raw, outcome) }
      }
      let one: ReturnType<typeof run> | undefined, two: ReturnType<typeof run> | undefined
      try {
        one = run(first)
        await fence.waitFor(one.raw)
        two = run(first === 'oauth' ? 'registration' : 'oauth')
        await observeInvitationWait(f.pool, two.outcome, fence.pid(), 'pg_advisory_xact_lock')
        fence.release()
        const results = await Promise.all([one.outcome, two.outcome])
        const linked = results[first === 'oauth' ? 0 : 1]!
        const registered = results[first === 'registration' ? 0 : 1]!
        expect(linked.error).toBeUndefined()
        expect(linked.value).toMatchObject({ mode: 'login_identity' })
        expect(registered.error).toMatchObject({ errorCode: 'EMAIL_ALREADY_EXISTS' })
        expect(await db.user.count()).toBe(before.users)
        expect(await db.session.findMany()).toEqual(before.sessions)
        expect(await db.authSessionFamily.findMany()).toEqual(before.families)
        expect(await db.mfaFlow.findMany()).toEqual(before.flows)
        expect(await db.invitationAuthHandoff.count()).toBe(0)
        expect(await db.orgMember.count({ where: { userId: user.user.id } })).toBe(0)
      } finally {
        fence.release()
        await Promise.allSettled([one?.outcome, two?.outcome])
        fence.restore()
        provider.mockRestore()
      }
    }
  )
}
