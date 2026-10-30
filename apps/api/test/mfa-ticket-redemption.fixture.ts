import { randomUUID } from 'node:crypto'

import { EmailIdentityService } from '../src/core/auth/email-identity.service.js'
import type { LoginRateLimiterService } from '../src/core/auth/login-rate-limiter.service.js'
import { MfaFactorBindingService } from '../src/core/auth/mfa/mfa-factor-binding.service.js'
import type { FlowRequest } from '../src/core/auth/mfa/mfa-flow-lock.js'
import type { LoginStart } from '../src/core/auth/mfa/mfa-login-start.service.js'
import { MfaOfflineRecovery } from '../src/core/auth/mfa/mfa-offline-recovery.js'
import { MfaPasswordIdentityService } from '../src/core/auth/mfa/mfa-password-identity.service.js'
import { MfaSeedDraftService } from '../src/core/auth/mfa/mfa-seed-draft.service.js'
import { MfaSetupAcknowledgementService } from '../src/core/auth/mfa/mfa-setup-acknowledgement.service.js'
import type { MfaSourceLimiterService } from '../src/core/auth/mfa/mfa-source-limiter.service.js'
import { MfaTicketRedemptionService } from '../src/core/auth/mfa/mfa-ticket-redemption.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { loginStartFixture } from './mfa-login-start.fixture.js'
import type { MfaProofFixture } from './mfa-proof.fixture.js'
import { verificationFixture } from './mfa-verification.fixture.js'

type RecoveryFixture = Awaited<ReturnType<typeof loginStartFixture>> & {
  issued: Awaited<ReturnType<MfaOfflineRecovery['issue']>>
  start: Extract<LoginStart, { request: FlowRequest }>
  effects: ReturnType<typeof verificationFixture>
  redemption: MfaTicketRedemptionService
  drafts: MfaSeedDraftService
  binding: MfaFactorBindingService
  ack: MfaSetupAcknowledgementService
}

export async function ticketRedemptionFixture(
  fixture: MfaProofFixture,
  hash: string,
  password: string,
  direct = false
): Promise<RecoveryFixture> {
  const db = fixture.clients[0]!
  const f = await loginStartFixture(fixture, hash)
  const effects = verificationFixture(fixture)
  const issued = await new MfaOfflineRecovery(db, effects.events).issue({
    userId: f.user.id,
    reason: 'lost phone and backup codes',
    confirmation: `RESET ${f.user.id}`,
  })
  const start = await f.service.password(
    f.user.email,
    password,
    'source',
    direct ? { kind: 'direct' } : { kind: 'browser', binding: f.requestBinding },
    randomUUID()
  )
  if (start.kind !== 'recovery_ticket_required')
    throw new Error('Expected restricted recovery-pending flow')
  const prisma = db as unknown as PrismaService
  const source = f.source as unknown as MfaSourceLimiterService
  const passwords = new MfaPasswordIdentityService(
    prisma,
    new EmailIdentityService(),
    f.login as unknown as LoginRateLimiterService
  )
  return {
    ...f,
    issued,
    start,
    effects,
    redemption: new MfaTicketRedemptionService(prisma, passwords, source, effects.events),
    drafts: new MfaSeedDraftService(prisma, fixture.codec, source),
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
