import { jest } from '@jest/globals'

import { EmailIdentityService } from '../src/core/auth/email-identity.service.js'
import type { LoginRateLimiterService } from '../src/core/auth/login-rate-limiter.service.js'
import { MfaLoginStartService } from '../src/core/auth/mfa/mfa-login-start.service.js'
import { MfaPasswordIdentityService } from '../src/core/auth/mfa/mfa-password-identity.service.js'
import type { MfaSourceLimiterService } from '../src/core/auth/mfa/mfa-source-limiter.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import type { MfaProofFixture } from './mfa-proof.fixture.js'

type LimiterCall = ReturnType<typeof jest.fn<() => Promise<void>>>
type LoginFixture = Awaited<ReturnType<typeof createAuthorityAccount>> & {
  login: { check: LimiterCall; consume: LimiterCall; reset: LimiterCall }
  source: { consume: LimiterCall }
  service: MfaLoginStartService
}

export async function loginStartFixture(
  fixture: MfaProofFixture,
  hash: string,
  protectedAccount = true
): Promise<LoginFixture> {
  const db = fixture.clients[0]!
  const f = await createAuthorityAccount(fixture, protectedAccount)
  await db.user.update({ where: { id: f.user.id }, data: { passwordHash: hash } })
  const login = {
    check: jest.fn(async () => undefined),
    consume: jest.fn(async () => undefined),
    reset: jest.fn(async () => undefined),
  }
  const source = { consume: jest.fn(async () => undefined) }
  const passwords = new MfaPasswordIdentityService(
    db as unknown as PrismaService,
    new EmailIdentityService(),
    login as unknown as LoginRateLimiterService
  )
  const service = new MfaLoginStartService(
    db as unknown as PrismaService,
    passwords,
    source as unknown as MfaSourceLimiterService
  )
  return { ...f, login, source, service }
}
