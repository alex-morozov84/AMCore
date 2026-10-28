import { createHash, randomUUID } from 'node:crypto'

import { type JwtPayload, SystemRole } from '@amcore/shared'

import {
  type BrowserRequestBinding,
  browserRequestBinding,
  hashBrowserBinding,
} from '../src/core/auth/mfa/browser-binding.js'
import { MfaAuthorityReader } from '../src/core/auth/mfa/mfa-authority-reader.service.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { createTotpSecret } from '../src/core/auth/mfa/mfa-totp.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import type {
  AuthSessionFamily,
  MfaFlow,
  PrismaClient,
  Session,
  User,
} from '../src/generated/prisma/client.js'
import type { PrismaService } from '../src/prisma/index.js'

import type { MfaProofFixture } from './mfa-proof.fixture.js'

const hash = (text: string): string => createHash('sha256').update(text).digest('hex')

export function authorityReader(db: PrismaClient): MfaAuthorityReader {
  return new MfaAuthorityReader(db as unknown as PrismaService)
}

/** Isolated Testcontainers state only; no deployment activation command is invoked. */
export async function createAuthorityAccount(
  fixture: Pick<MfaProofFixture, 'clients' | 'codec'>,
  protectedAccount = true,
  email = 'authority.fixture@example.test'
): Promise<{
  user: User
  family: AuthSessionFamily
  session: Session
  flow: MfaFlow
  claims: JwtPayload
  requestBinding: BrowserRequestBinding
}> {
  const db = fixture.clients[0]!
  const now = await mfaDatabaseClock(db)
  const expiresAt = new Date(now.getTime() + 3_600_000)
  const user = await db.user.create({
    data: {
      email,
      emailCanonical: email,
      passwordHash: 'original-fixture-hash',
      systemRole: protectedAccount ? SystemRole.SuperAdmin : SystemRole.User,
    },
  })
  await db.mfaAccount.create({
    data: {
      userId: user.id,
      securityVersion: 3,
      required: protectedAccount,
      setupComplete: protectedAccount,
    },
  })
  if (protectedAccount) {
    const factorId = randomUUID()
    await db.mfaFactor.create({
      data: {
        id: factorId,
        userId: user.id,
        ...fixture.codec.encrypt(user.id, factorId, createTotpSecret(user.email).secret),
        lastAcceptedStep: 42n,
      },
    })
  }
  const binding = mfaCredential()
  const bindingHash = hashBrowserBinding(binding)!
  const context = await db.browserAuthContext.create({
    data: { bindingHash, audience: 'product', generation: 1, state: 'published', expiresAt },
  })
  const family = await db.authSessionFamily.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      securityVersion: 3,
      primaryMethod: 'password',
      primaryAt: now,
      primaryProofId: 'password-fixture-event',
      ...(protectedAccount
        ? { mfaMethod: 'totp', mfaAt: now, mfaProofId: 'factor-fixture-event', factorVersion: 1 }
        : {}),
      publicationState: 'published',
      browserContextId: context.id,
      publicationGeneration: 1,
      expiresAt,
    },
  })
  await db.browserAuthContext.update({
    where: { id: context.id },
    data: { currentFamilyId: family.id },
  })
  const session = await db.session.create({
    data: {
      userId: user.id,
      familyId: family.id,
      refreshToken: hash(`fixture-refresh:${user.id}`),
      expiresAt,
      lastAuthAt: now,
    },
  })
  const flow = await db.mfaFlow.create({
    data: {
      userId: user.id,
      credentialHash: hash(`fixture-flow:${user.id}`),
      purpose: 'reauthenticate',
      authorityKind: 'session',
      audience: 'product',
      bindingHash,
      securityVersion: 3,
      sourceFamilyId: family.id,
      sourceSecurityVersion: 3,
      expiresAt,
    },
  })
  const claims: JwtPayload = {
    sub: user.id,
    email: user.email,
    systemRole: user.systemRole,
    sid: session.id,
    fid: family.id,
    securityVersion: 3,
    browserBound: true,
  }
  return {
    user,
    family,
    session,
    flow,
    claims,
    requestBinding: browserRequestBinding(binding, 'product', {
      contextId: context.id,
      generation: 1,
    })!,
  }
}
