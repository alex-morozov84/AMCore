import { jest } from '@jest/globals'
import { JwtService } from '@nestjs/jwt'

import type { LoginRateLimiterService } from '../src/core/auth/login-rate-limiter.service.js'
import { PasswordStepUpService } from '../src/core/auth/password-step-up.service.js'
import { TokenService } from '../src/core/auth/token.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { adminCommandFixture } from './mfa-admin-command.fixture.js'
import type { MfaProofFixture } from './mfa-proof.fixture.js'

export async function passwordStepUpFixture(
  fixture: MfaProofFixture,
  hash: string,
  windowSec = 600
): Promise<
  Awaited<ReturnType<typeof adminCommandFixture>> & {
    service: PasswordStepUpService
    tokens: TokenService
    jwt: JwtService
    limiter: {
      check: ReturnType<typeof jest.fn<() => Promise<void>>>
      consume: ReturnType<typeof jest.fn<() => Promise<void>>>
      reset: ReturnType<typeof jest.fn<() => Promise<void>>>
    }
  }
> {
  const actor = await adminCommandFixture(fixture, windowSec)
  const db = fixture.clients[0]!
  await db.user.update({ where: { id: actor.operator.user.id }, data: { passwordHash: hash } })
  const jwt = new JwtService({
    secret: '<fake-password-step-up-jwt-key-at-least-32>',
    signOptions: { expiresIn: '15m' },
  })
  const tokens = new TokenService(jwt, actor.env)
  const limiter = {
    check: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    consume: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    reset: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
  return {
    ...actor,
    tokens,
    jwt,
    limiter,
    service: new PasswordStepUpService(
      db as unknown as PrismaService,
      limiter as unknown as LoginRateLimiterService,
      tokens,
      actor.audit,
      actor.env
    ),
  }
}
