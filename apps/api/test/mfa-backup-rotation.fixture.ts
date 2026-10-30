import { randomUUID } from 'node:crypto'

import { MfaBackupRotationService } from '../src/core/auth/mfa/mfa-backup-rotation.service.js'
import { continuationHash, type FlowRequest } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { MfaSetupAcknowledgementService } from '../src/core/auth/mfa/mfa-setup-acknowledgement.service.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import type { MfaProofFixture } from './mfa-proof.fixture.js'
import { verificationFixture } from './mfa-verification.fixture.js'

type RotationFixture = Awaited<ReturnType<typeof createAuthorityAccount>> & {
  request: FlowRequest
  codes: string[]
  effects: ReturnType<typeof verificationFixture>
  rotation: MfaBackupRotationService
  ack: MfaSetupAcknowledgementService
}

export async function backupRotationFixture(fixture: MfaProofFixture): Promise<RotationFixture> {
  const db = fixture.clients[0]!
  const f = await createAuthorityAccount(fixture)
  await db.user.update({ where: { id: f.user.id }, data: { emailVerified: true } })
  const now = await mfaDatabaseClock(db)
  const credential = mfaCredential()
  await db.authSessionFamily.update({
    where: { id: f.family.id },
    data: { mfaAt: new Date(now.getTime() - 700_000) },
  })
  await db.mfaFlow.update({
    where: { id: f.flow.id },
    data: {
      credentialHash: continuationHash(credential)!,
      purpose: 'rotate_codes',
      browserContextId: f.requestBinding.contextId,
      publicationGeneration: 1,
      expiresAt: new Date(now.getTime() + 300_000),
      data: {
        proofs: {
          primary: {
            method: 'password',
            eventId: randomUUID(),
            verifiedAt: f.family.primaryAt!.toISOString(),
            origin: { kind: 'family', familyId: f.family.id },
          },
          secondFactor: null,
        },
      },
    },
  })
  const backup = await db.$transaction((tx) =>
    fixture.first.replaceBackupCodes(tx, f.user.id, 3, 0)
  )
  const request: FlowRequest = {
    credential,
    purpose: 'rotate_codes',
    audience: 'product',
    bindingHash: f.requestBinding.bindingHash,
    browser: f.requestBinding,
  }
  const effects = verificationFixture(fixture)
  const prisma = db as unknown as PrismaService
  const source = { consume: async () => undefined } as never
  return {
    ...f,
    request,
    codes: backup!.codes,
    effects,
    rotation: new MfaBackupRotationService(prisma, fixture.first, source, effects.events),
    ack: new MfaSetupAcknowledgementService(prisma, source, effects.events),
  }
}
