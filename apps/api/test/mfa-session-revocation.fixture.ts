import { randomUUID } from 'node:crypto'

import type { FlowRequest } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { continuationHash, directFlowBinding } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { mfaCredential, mfaHash } from '../src/core/auth/mfa/mfa-secrets.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import type { AuthSessionFamily, PrismaClient, Session } from '../src/generated/prisma/client.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import type { MfaProofFixture } from './mfa-proof.fixture.js'

/** Exact source F, unrelated independent G and a separately authorized direct login capability. */
export async function revocationGraph(fixture: MfaProofFixture): Promise<
  Awaited<ReturnType<typeof createAuthorityAccount>> & {
    db: PrismaClient
    g: AuthSessionFamily
    other: Session
    source: FlowRequest
    direct: FlowRequest
  }
> {
  const db = fixture.clients[0]!
  const f = await createAuthorityAccount(fixture)
  const g = await db.authSessionFamily.create({
    data: { ...f.family, id: randomUUID(), browserContextId: null, publicationGeneration: null },
  })
  const other = await db.session.create({
    data: {
      userId: f.user.id,
      familyId: g.id,
      refreshToken: mfaHash(mfaCredential()),
      expiresAt: g.expiresAt,
    },
  })
  const credential = mfaCredential()
  await db.mfaFlow.update({
    where: { id: f.flow.id },
    data: {
      credentialHash: continuationHash(credential)!,
      browserContextId: f.requestBinding.contextId,
      publicationGeneration: 1,
    },
  })
  const source: FlowRequest = {
    credential,
    purpose: 'reauthenticate',
    audience: 'product',
    bindingHash: f.requestBinding.bindingHash,
    browser: f.requestBinding,
  }
  const independent = mfaCredential()
  const bindingHash = directFlowBinding(independent)!
  const now = await mfaDatabaseClock(db)
  await db.mfaFlow.create({
    data: {
      userId: f.user.id,
      credentialHash: continuationHash(independent)!,
      purpose: 'login',
      authorityKind: 'identity',
      audience: 'direct',
      bindingHash,
      securityVersion: 3,
      expiresAt: new Date(now.getTime() + 300_000),
    },
  })
  const direct: FlowRequest = {
    credential: independent,
    purpose: 'login',
    audience: 'direct',
    bindingHash,
    browser: null,
  }
  return { ...f, db, g, other, source, direct }
}
