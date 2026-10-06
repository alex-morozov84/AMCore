import { randomBytes } from 'node:crypto'

import { JwtService } from '@nestjs/jwt'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { AuthService } from '../../src/core/auth/auth.service'
import { SessionService } from '../../src/core/auth/session.service'
import { TokenService } from '../../src/core/auth/token.service'
import { invitationHandoffProof } from '../../src/core/invitations/invitation-auth-handoff'
import { InvitationAuthHandoffService } from '../../src/core/invitations/invitation-auth-handoff.service'
import { InvitationContinuationService } from '../../src/core/invitations/invitation-continuation.service'
import { InvitationLiveSessionService } from '../../src/core/invitations/invitation-live-session.service'
import type { InvitationProofFixture } from '../helpers/invitation-proof'

type IssuedFixture = Omit<InvitationProofFixture, 'actor'> & {
  auth: Awaited<ReturnType<AuthService['registerInvited']>>
  actor: RequestPrincipal
  proof: NonNullable<ReturnType<typeof invitationHandoffProof>>
  admission: Awaited<ReturnType<InvitationContinuationService['admit']>>
  session: SessionService
  handoffs: InvitationAuthHandoffService
}

export function registerHandoffProofs(getFixture: () => InvitationProofFixture): void {
  async function issued(): Promise<IssuedFixture> {
    const f = getFixture()
    const { token, invite } = await f.pending()
    await f.prisma.orgInvite.update({
      where: { id: invite.id },
      data: {
        email: 'new-invited@example.test',
        emailCanonical: 'new-invited@example.test',
      },
    })
    const admission = await f.context.app.get(InvitationContinuationService).admit(token)
    const proof = invitationHandoffProof(
      randomBytes(16).toString('base64url'),
      randomBytes(32).toString('base64url')
    )!
    const auth = await f.context.app
      .get(AuthService)
      .registerInvited({ password: 'StrongP@ss123' }, admission.credential, { handoff: proof })
    const claims = f.context.app.get(JwtService).verify(auth.accessToken)
    const actor: RequestPrincipal = {
      type: 'jwt',
      sub: claims.sub,
      sid: claims.sid,
      email: auth.user.email,
      systemRole: SystemRole.User,
    }
    return {
      ...f,
      auth,
      actor,
      proof,
      admission,
      session: f.context.app.get(SessionService),
      handoffs: f.context.app.get(InvitationAuthHandoffService),
    }
  }

  it('R18 pending handoff cannot refresh into an unmarked child; confirmation is exact and idempotent', async () => {
    const { context, prisma, auth, actor, proof, session, handoffs, admission } = await issued()
    const tokens = context.app.get(TokenService)
    const live = context.app.get(InvitationLiveSessionService)
    await expect(
      context.app
        .get(AuthService)
        .registerInvited({ password: 'StrongP@ss123' }, admission.credential, { handoff: proof })
    ).rejects.toMatchObject({ errorCode: 'AUTH_HANDOFF_ALREADY_STARTED' })
    const before = await prisma.session.count({ where: { userId: actor.sub } })
    await expect(
      session.rotateRefreshToken(tokens.hashRefreshToken(auth.refreshToken), { userId: actor.sub })
    ).rejects.toMatchObject({ errorCode: 'AUTH_HANDOFF_INVALID' })
    expect(await prisma.session.count({ where: { userId: actor.sub } })).toBe(before)
    await expect(live.assert(actor, prisma)).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED' })
    await expect(
      handoffs.settle(proof, 'confirm', { ...actor, sid: 'other-session' })
    ).rejects.toMatchObject({ errorCode: 'AUTH_HANDOFF_INVALID' })
    expect(await handoffs.settle(proof, 'confirm', actor)).toEqual({ status: 'confirmed' })
    expect(await handoffs.settle(proof, 'confirm', actor)).toEqual({ status: 'confirmed' })
    await live.assert(actor, prisma)
    await expect(handoffs.settle(proof, 'abort')).rejects.toMatchObject({
      errorCode: 'AUTH_HANDOFF_CONFIRMED',
    })
    expect(await prisma.orgMember.count({ where: { userId: actor.sub } })).toBe(0)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor.sub } })).emailVerified).toBe(
      false
    )
  })

  it('R18 DB deadline sweep aborts only newly tagged session; account remains usable', async () => {
    const { prisma, actor, proof, handoffs } = await issued()
    await prisma.invitationAuthHandoff.update({
      where: { attemptId: proof.attemptId },
      data: { deadline: new Date(0) },
    })
    await expect(handoffs.settle(proof, 'confirm', actor)).rejects.toMatchObject({
      errorCode: 'AUTH_HANDOFF_INVALID',
    })
    await handoffs.sweep()
    const current = await prisma.session.findUniqueOrThrow({ where: { id: actor.sid } })
    expect(current.revokedAt).not.toBeNull()
    expect(current.revocationReason).toBe('invitation-handoff-aborted')
    expect(await handoffs.settle(proof, 'abort')).toEqual({ status: 'aborted' })
    expect(await prisma.user.count({ where: { id: actor.sub } })).toBe(1)
    expect(await prisma.orgMember.count({ where: { userId: actor.sub } })).toBe(0)
  })
}
