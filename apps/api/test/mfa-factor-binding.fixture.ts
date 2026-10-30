import { randomUUID } from 'node:crypto'

import { generate } from 'otplib'

import { MfaFactorBindingService } from '../src/core/auth/mfa/mfa-factor-binding.service.js'
import { continuationHash, type FlowRequest } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { MfaSeedDraftService } from '../src/core/auth/mfa/mfa-seed-draft.service.js'
import { MfaSetupAcknowledgementService } from '../src/core/auth/mfa/mfa-setup-acknowledgement.service.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import type { PrismaService } from '../src/prisma/index.js'

import { loginStartFixture } from './mfa-login-start.fixture.js'
import type { MfaProofFixture } from './mfa-proof.fixture.js'
import { verificationFixture } from './mfa-verification.fixture.js'

type BindingFixture = Awaited<ReturnType<typeof loginStartFixture>> & {
  request: FlowRequest
  seed: string
  binding: MfaFactorBindingService
  ack: MfaSetupAcknowledgementService
  effects: ReturnType<typeof verificationFixture>
}

export async function factorBindingFixture(
  fixture: MfaProofFixture,
  hash: string,
  password: string,
  replacement = false
): Promise<BindingFixture> {
  const db = fixture.clients[0]!
  const f = await loginStartFixture(fixture, hash)
  await db.user.update({ where: { id: f.user.id }, data: { emailVerified: true } })
  let request: FlowRequest
  if (replacement) {
    const credential = mfaCredential()
    const now = await mfaDatabaseClock(db)
    const primaryId = randomUUID()
    const mfaId = randomUUID()
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { primaryProofId: primaryId, mfaProofId: mfaId },
    })
    await db.mfaFlow.update({
      where: { id: f.flow.id },
      data: {
        purpose: 'replace_factor',
        credentialHash: continuationHash(credential)!,
        browserContextId: f.requestBinding.contextId,
        publicationGeneration: 1,
        expiresAt: new Date(now.getTime() + 900_000),
        data: {
          proofs: {
            primary: {
              eventId: primaryId,
              method: 'password',
              verifiedAt: f.family.primaryAt!.toISOString(),
              origin: { kind: 'family', familyId: f.family.id },
            },
            secondFactor: {
              eventId: mfaId,
              method: 'totp',
              factorVersion: 1,
              verifiedAt: f.family.mfaAt!.toISOString(),
              origin: { kind: 'family', familyId: f.family.id },
            },
          },
        },
      },
    })
    request = {
      credential,
      purpose: 'replace_factor',
      audience: 'product',
      bindingHash: f.requestBinding.bindingHash,
      browser: f.requestBinding,
    }
  } else {
    await db.mfaFactor.delete({ where: { userId: f.user.id } })
    await db.mfaAccount.update({ where: { userId: f.user.id }, data: { setupComplete: false } })
    const start = await f.service.password(
      f.user.email,
      password,
      'source',
      { kind: 'browser', binding: f.requestBinding },
      randomUUID()
    )
    if (start.kind !== 'mfa') throw new Error('Expected setup start')
    request = start.request
  }
  const prisma = db as unknown as PrismaService
  const source = f.source as never
  const drafts = new MfaSeedDraftService(prisma, fixture.codec, source)
  const seed = await drafts.open(request, randomUUID(), false, 'source')
  if (seed.outcome !== 'seed') throw new Error('Expected unbound seed')
  const effects = verificationFixture(fixture)
  return {
    ...f,
    request,
    seed: seed.secret,
    effects,
    binding: new MfaFactorBindingService(
      prisma,
      fixture.codec,
      fixture.first,
      source,
      effects.events
    ),
    ack: new MfaSetupAcknowledgementService(prisma, source, effects.events),
  }
}

export async function seedProof(
  fixture: MfaProofFixture,
  seed: string,
  stepOffset = 0
): Promise<{ method: 'totp'; code: string }> {
  const now = await mfaDatabaseClock(fixture.clients[0]!)
  return {
    method: 'totp',
    code: await generate({
      secret: seed,
      algorithm: 'sha1',
      digits: 6,
      period: 30,
      epoch: Math.floor(now.getTime() / 1000) + stepOffset * 30,
    }),
  }
}
