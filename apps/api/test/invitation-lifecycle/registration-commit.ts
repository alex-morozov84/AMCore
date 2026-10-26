import { randomBytes } from 'node:crypto'

import { AuthErrorCode, InviteErrorCode } from '@amcore/shared'

import { AuthService } from '../../src/core/auth/auth.service'
import { TokenService } from '../../src/core/auth/token.service'
import { TokenManagerService } from '../../src/core/auth/token-manager.service'
import {
  type InvitationHandoffProof,
  invitationHandoffProof,
} from '../../src/core/invitations/invitation-auth-handoff'
import { InvitationContinuationService } from '../../src/core/invitations/invitation-continuation.service'
import { invitationClock } from '../../src/core/invitations/invitation-locks'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
const jest = import.meta.jest

const EMAIL = 'commit-boundary@example.test'
const PASSWORD = 'StrongP@ss123'

/** Invited signup commits user, session, handoff and verification token as one unit. */
export function registerRegistrationCommitProofs(getFixture: () => InvitationProofFixture): void {
  async function admitted(): Promise<{
    f: InvitationProofFixture
    invite: { id: string }
    admission: { credential: string }
    auth: AuthService
  }> {
    const f = getFixture()
    const { token, invite } = await f.pending()
    await f.prisma.orgInvite.update({
      where: { id: invite.id },
      data: { email: EMAIL, emailCanonical: EMAIL },
    })
    const admission = await f.context.app.get(InvitationContinuationService).admit(token)
    return { f, invite, admission, auth: f.context.app.get(AuthService) }
  }
  const proof = (): InvitationHandoffProof =>
    invitationHandoffProof(
      randomBytes(16).toString('base64url'),
      randomBytes(32).toString('base64url')
    )!
  const counts = async (
    f: InvitationProofFixture
  ): Promise<{ users: number; sessions: number; tokens: number; handoffs: number }> => ({
    users: await f.prisma.user.count({ where: { emailCanonical: EMAIL } }),
    sessions: await f.prisma.session.count(),
    tokens: await f.prisma.emailVerificationToken.count(),
    handoffs: await f.prisma.invitationAuthHandoff.count(),
  })

  afterEach(() => jest.restoreAllMocks())

  it.each(['token issuance', 'access token signing'] as const)(
    'RC1 %s failure rolls back user, session, handoff and token; the continuation stays usable',
    async (stage) => {
      const { f, admission, auth } = await admitted()
      const failure = new Error(`${stage} failed`)
      if (stage === 'token issuance')
        jest
          .spyOn(f.context.app.get(TokenManagerService), 'generateEmailVerificationToken')
          .mockImplementationOnce(() => Promise.reject(failure))
      else
        jest
          .spyOn(f.context.app.get(TokenService), 'generateAccessToken')
          .mockImplementationOnce(() => {
            throw failure
          })
      const before = await counts(f)
      const attempt = proof()

      await expect(
        auth.registerInvited({ password: PASSWORD }, admission.credential, { handoff: attempt })
      ).rejects.toBe(failure)

      expect(await counts(f)).toEqual(before)
      expect(
        await f.prisma.invitationAuthHandoff.count({ where: { attemptId: attempt.attemptId } })
      ).toBe(0)
      jest.restoreAllMocks()
      const retried = await auth.registerInvited({ password: PASSWORD }, admission.credential, {
        handoff: proof(),
      })
      expect(retried.user.email).toBe(EMAIL)
      expect((await counts(f)).users).toBe(1)
    }
  )

  it('RC2 expiry reached after token issuance and before the final check commits nothing', async () => {
    const { f, admission, auth } = await admitted()
    const continuation = f.context.app.get(InvitationContinuationService)
    const manager = f.context.app.get(TokenManagerService)
    const lockValid = continuation.lockValid.bind(continuation)
    const issue = manager.generateEmailVerificationToken.bind(manager)
    const reached = { admitted: false, issued: false, expired: false }
    let expiresAt = new Date(0)
    // The first expiry fence passes against the real database clock; the deadline handed to the
    // final check is then set 250 ms ahead of that clock, so it does not depend on earlier load.
    jest.spyOn(continuation, 'lockValid').mockImplementationOnce(async (tx, credential) => {
      const result = await lockValid(tx, credential)
      expiresAt = new Date((await invitationClock(tx)).getTime() + 250)
      reached.admitted = true
      return { ...result, expiresAt }
    })
    // Token issuance runs for real, then waits (inside the same transaction) until the database
    // clock has passed the deadline. The only operation left is the final expiry check.
    jest
      .spyOn(manager, 'generateEmailVerificationToken')
      .mockImplementationOnce(async (...args) => {
        const issued = await issue(...args)
        reached.issued = true
        const tx = args[2]!
        while ((await invitationClock(tx)) <= expiresAt) await new Promise((r) => setTimeout(r, 25))
        reached.expired = true
        return issued
      })
    const before = await counts(f)

    await expect(
      auth.registerInvited({ password: PASSWORD }, admission.credential, { handoff: proof() })
    ).rejects.toMatchObject({ errorCode: InviteErrorCode.INVITE_INVALID_OR_EXPIRED })

    expect(reached).toEqual({ admitted: true, issued: true, expired: true })
    expect(await counts(f)).toEqual(before)
  })

  it('RC3 ordinary and invited signup for one canonical email leave exactly one account', async () => {
    const { f, admission, auth } = await admitted()

    const results = await Promise.allSettled([
      auth.register({ email: EMAIL, password: PASSWORD }, {}),
      auth.registerInvited({ password: PASSWORD }, admission.credential, { handoff: proof() }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const result of results) {
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ errorCode: AuthErrorCode.EMAIL_ALREADY_EXISTS })
    }
    expect((await counts(f)).users).toBe(1)
  })
}
