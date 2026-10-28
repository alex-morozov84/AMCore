import { randomUUID } from 'node:crypto'

import request, { type Response, type Test } from 'supertest'

import type { RequestPrincipal } from '@amcore/shared'

import { MfaEncryptionService } from '../src/core/auth/mfa/mfa-encryption.service.js'
import { backupCodeHash, generateBackupCodes } from '../src/core/auth/mfa/mfa-secrets.js'
import { createTotpSecret } from '../src/core/auth/mfa/mfa-totp.js'
import type { MfaAccount, User } from '../src/generated/prisma/client.js'

import type { E2ETestContext } from './helpers.js'

async function seedDomainEnrollment(
  context: E2ETestContext,
  userId: string
): Promise<{ user: User; account: MfaAccount; factorVersion: number }> {
  if (new URL(context.postgresContainer.getConnectionUri()).pathname !== '/amcore_test')
    throw new Error('Operator fixture requires the owned disposable E2E database')
  const db = context.prisma
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
  if (user.systemRole !== 'SUPER_ADMIN') throw new Error('Operator fixture requires an operator')
  await db.mfaProtocol.upsert({
    where: { id: 'platform' },
    create: { id: 'platform', state: 'active' },
    update: { state: 'active', version: 1 },
  })
  let account = await db.mfaAccount.upsert({
    where: { userId: user.id },
    create: { userId: user.id, required: true, setupComplete: true, codeGeneration: 1 },
    update: {},
  })
  if (account.emergencyRequired)
    throw new Error('Domain fixture cannot repair an emergency account')
  let factor = await db.mfaFactor.findUnique({ where: { userId: user.id } })
  if (!factor) {
    // Explicit initial enrollment fixture, also after role-promotion epoch creation.
    account = await db.mfaAccount.update({
      where: { userId: user.id },
      data: {
        required: true,
        setupComplete: true,
        codeGeneration: Math.max(1, account.codeGeneration),
      },
    })
    const id = randomUUID()
    const { secret } = createTotpSecret(user.email)
    const encrypted = context.app.get(MfaEncryptionService).encrypt(user.id, id, secret)
    factor = await db.mfaFactor.create({ data: { id, userId: user.id, ...encrypted } })
  }
  if (!account.setupComplete)
    throw new Error('Domain fixture cannot repair incomplete factor state')
  return { user, account, factorVersion: factor.version }
}

/** Domain tests seed enrollment only; login, proof consumption and publication use real HTTP. */
export async function loginDomainOperator(
  context: E2ETestContext,
  credentials: { email: string; password: string }
): Promise<Response> {
  const userId = (
    await context.prisma.user.findUniqueOrThrow({
      where: { emailCanonical: credentials.email.trim().toLowerCase() },
    })
  ).id
  const { user, account } = await seedDomainEnrollment(context, userId)
  const db = context.prisma
  const code = generateBackupCodes()[0]!
  await db.mfaRecoveryCode.create({
    data: {
      userId: user.id,
      generation: account.codeGeneration,
      hash: backupCodeHash(user.id, account.codeGeneration, code),
    },
  })
  const http = (): ReturnType<typeof request> => request(context.app.getHttpServer())
  const started = await http().post('/auth/login').send(credentials).expect(202)
  expect(started.body).toMatchObject({ kind: 'mfa', state: 'verify_required' })
  const pending = (path: string): Test =>
    http().post(`/auth/mfa/${path}`).set('x-mfa-continuation', started.body.continuation)
  await pending('verify')
    .send({
      purpose: 'login',
      operationId: randomUUID(),
      proof: { method: 'recovery_code', code },
    })
    .expect(200)
    .expect(({ body }) => expect(body.outcome).toBe('verified'))
  const operationId = randomUUID()
  const issued = await pending('complete')
    .send({ purpose: 'login', operationId, vaultBinding: null })
    .expect(200)
  await pending('publication/acknowledge')
    .send({
      purpose: 'login',
      operationId,
      vaultBinding: null,
      accessToken: issued.body.accessToken,
      receipt: issued.body.publication.receipt,
    })
    .expect(200)
  return issued
}

/** Existing domain service fixtures seed explicit durable authority, never an auth bypass. */
export async function seedDomainOperatorSession(
  context: E2ETestContext,
  sessionId: string
): Promise<RequestPrincipal & { type: 'jwt' }> {
  const session = await context.prisma.session.findUniqueOrThrow({ where: { id: sessionId } })
  const { user, account, factorVersion } = await seedDomainEnrollment(context, session.userId)
  await context.prisma.authSessionFamily.create({
    data: {
      id: session.familyId,
      userId: user.id,
      securityVersion: account.securityVersion,
      primaryMethod: 'password',
      primaryAt: session.lastAuthAt,
      primaryProofId: randomUUID(),
      mfaMethod: 'totp',
      mfaAt: session.lastAuthAt,
      mfaProofId: randomUUID(),
      factorVersion,
      publicationState: 'published',
      expiresAt: session.expiresAt,
    },
  })
  return {
    type: 'jwt' as const,
    sub: user.id,
    email: user.email,
    systemRole: user.systemRole,
    sid: session.id,
    fid: session.familyId,
    securityVersion: account.securityVersion,
  }
}
