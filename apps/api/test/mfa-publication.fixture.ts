import { randomBytes, randomUUID } from 'node:crypto'

import { JwtService } from '@nestjs/jwt'

import { continuationHash } from '../src/core/auth/mfa/mfa-flow-lock.js'
import type { PublicationCommand } from '../src/core/auth/mfa/mfa-publication-authority.js'
import {
  type PublicationRecord,
  publicationSecretHash,
} from '../src/core/auth/mfa/mfa-publication-record.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { PendingSessionProof } from '../src/core/auth/mfa/pending-session-proof.js'
import { invitationHandoffProof } from '../src/core/invitations/invitation-auth-handoff.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import type { MfaProofFixture } from './mfa-proof.fixture.js'

const jwt = new JwtService({ secret: '<fake-publication-signing-key-for-isolated-DB-test>' })
interface Options {
  protected?: boolean
  oauth?: boolean
  invitation?: boolean
  direct?: boolean
  handoffKey?: string
}

/** Pending rows only, not a real password/OAuth HTTP issuer or an activation command. */
export async function pendingPublication(
  fixture: Pick<MfaProofFixture, 'clients' | 'codec'>,
  options: Options = {}
): Promise<
  Awaited<ReturnType<typeof createAuthorityAccount>> & {
    command: PublicationCommand
    record: PublicationRecord
    token: string
  }
> {
  const db = fixture.clients[0]!
  const f = await createAuthorityAccount(fixture, options.protected ?? false)
  const now = await mfaDatabaseClock(db)
  const deadline = new Date(now.getTime() + 60_000)
  const continuation = mfaCredential()
  const vaultBinding = options.direct ? null : mfaCredential()
  const receipt = options.protected ? mfaCredential() : null
  let invitation: PublicationRecord['invitation'] = null
  let handoff: PublicationCommand['handoff'] = null
  if (options.invitation) {
    const org = await db.organization.create({
      data: { name: 'Publication fixture', slug: randomUUID() },
    })
    const role = await db.role.create({
      data: { name: 'Publication member', organizationId: org.id },
    })
    const invite = await db.orgInvite.create({
      data: {
        organizationId: org.id,
        email: f.user.email,
        emailCanonical: f.user.emailCanonical,
        tokenHash: randomUUID(),
        expiresAt: f.family.expiresAt,
        roleIntents: {
          create: {
            ordinal: 0,
            requestedRoleId: role.id,
            liveRoleId: role.id,
            roleNameAtIssue: role.name,
          },
        },
      },
    })
    const attemptId = randomBytes(16).toString('base64url')
    handoff = invitationHandoffProof(attemptId, options.handoffKey ?? mfaCredential())!
    invitation = {
      attemptId,
      inviteId: invite.id,
      organizationId: org.id,
      generation: invite.generation,
      recipient: f.user.emailCanonical,
    }
    await db.invitationAuthHandoff.create({
      data: { ...handoff, sessionId: f.session.id, actorId: f.user.id, deadline },
    })
  }
  const browser = options.direct
    ? null
    : { ...f.requestBinding, stagedBindingHash: publicationSecretHash('vault', vaultBinding)! }
  const record: PublicationRecord = {
    kind: 'issued_family',
    familyId: f.family.id,
    sessionId: f.session.id,
    securityVersion: 3,
    browser: browser
      ? {
          contextId: browser.contextId,
          generation: browser.generation,
          audience: browser.audience,
          stagedBindingHash: browser.stagedBindingHash,
        }
      : null,
    invitation,
    transferId: null,
  }
  await db.mfaFlow.update({
    where: { id: f.flow.id },
    data: {
      credentialHash: continuationHash(continuation)!,
      purpose: 'login',
      authorityKind: 'identity',
      state: 'committed',
      sourceFamilyId: null,
      sourceSecurityVersion: null,
      audience: options.direct ? 'direct' : 'product',
      bindingHash: options.direct ? 'direct-fixture-binding' : f.requestBinding.bindingHash,
      browserContextId: browser?.contextId ?? null,
      publicationGeneration: browser?.generation ?? null,
    },
  })
  await db.authSessionFamily.update({
    where: { id: f.family.id },
    data: {
      publicationState: 'pending',
      publicationDeadline: deadline,
      receiptHash: publicationSecretHash('receipt', receipt),
      browserContextId: browser?.contextId ?? null,
      publicationGeneration: browser?.generation ?? null,
      ...(options.oauth && { primaryMethod: 'oauth', primaryAt: null, primaryProofId: null }),
    },
  })
  if (browser)
    await db.browserAuthContext.update({
      where: { id: browser.contextId },
      data: {
        state: 'reserved',
        currentFamilyId: null,
        reservedFlowId: f.flow.id,
        stagedBindingHash: browser.stagedBindingHash,
      },
    })
  const operationId = randomUUID()
  await db.mfaOperation.create({
    data: { id: operationId, flowId: f.flow.id, kind: 'issue_family', result: record },
  })
  const token = jwt.sign(
    { ...f.claims, browserBound: options.direct ? undefined : true },
    { expiresIn: 120 }
  )
  const purpose = options.direct
    ? 'direct_mfa_receipt'
    : invitation
      ? 'invitation_publication'
      : 'browser_publication'
  const command: PublicationCommand = {
    proof: PendingSessionProof.verify(token, jwt, purpose),
    continuation,
    operationId,
    audience: options.direct ? 'direct' : 'product',
    bindingHash: options.direct ? 'direct-fixture-binding' : f.requestBinding.bindingHash,
    browser: options.direct ? null : f.requestBinding,
    vaultBinding,
    receipt,
    handoff,
  }
  return { ...f, command, record, token }
}

export function publicationProof(
  token: string,
  purpose: 'browser_publication' | 'invitation_publication' | 'direct_mfa_receipt'
): PendingSessionProof {
  return PendingSessionProof.verify(token, jwt, purpose)
}
