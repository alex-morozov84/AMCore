import { randomUUID } from 'node:crypto'

import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import {
  lockBrowserLoginBinding,
  reserveBrowserLogin,
} from '../src/core/auth/mfa/browser-login-reservation.js'
import { MfaFamilyIssuanceService } from '../src/core/auth/mfa/mfa-family-issuance.service.js'
import { continuationHash, type FlowRequest } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { TokenService } from '../src/core/auth/token.service.js'
import { EnvService } from '../src/env/env.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import type { MfaProofFixture } from './mfa-proof.fixture.js'

interface Options {
  protected?: boolean
  direct?: boolean
  oauth?: boolean
  sourceSession?: boolean
}
type IssuanceFixture = Awaited<ReturnType<typeof createAuthorityAccount>> & {
  request: FlowRequest
  jwt: JwtService
  tokens: TokenService
  service: MfaFamilyIssuanceService
  operationId: string
  vaultBinding: string | null
}

/** Durable preverified identity/proof fixture, not a real password/OAuth HTTP adapter. */
export async function familyIssuanceFixture(
  fixture: MfaProofFixture,
  options: Options = {}
): Promise<IssuanceFixture> {
  const db = fixture.clients[0]!
  const protectedAccount = options.protected ?? true
  const f = await createAuthorityAccount(fixture, protectedAccount)
  const credential = mfaCredential()
  const now = await mfaDatabaseClock(db)
  let browser = options.direct ? null : f.requestBinding
  await db.$transaction(async (tx) => {
    if (browser && !options.sourceSession) {
      const locked = await lockBrowserLoginBinding(tx, browser, f.user.id)
      if (!locked) throw new Error('Cannot reserve browser fixture')
      const context = await reserveBrowserLogin(
        tx,
        locked,
        browser,
        f.flow.id,
        new Date(now.getTime() + 300_000)
      )
      if (!context) throw new Error('Cannot advance browser fixture')
      browser = { ...browser, generation: context.generation }
    }
    await tx.mfaFlow.update({
      where: { id: f.flow.id },
      data: {
        credentialHash: continuationHash(credential)!,
        expiresAt: new Date(now.getTime() + 300_000),
        purpose: options.sourceSession ? 'reauthenticate' : 'login',
        authorityKind: options.sourceSession ? 'session' : 'identity',
        sourceFamilyId: options.sourceSession ? f.family.id : null,
        sourceSecurityVersion: options.sourceSession ? 3 : null,
        browserContextId: browser?.contextId ?? null,
        publicationGeneration: browser?.generation ?? null,
        audience: browser?.audience ?? 'direct',
        bindingHash: browser?.bindingHash ?? 'direct-fixture-binding',
        data: {
          proofs: {
            primary: options.oauth
              ? null
              : {
                  method: 'password',
                  eventId: randomUUID(),
                  verifiedAt: now.toISOString(),
                  origin: { kind: 'flow', flowId: f.flow.id },
                },
            secondFactor:
              protectedAccount && !options.oauth
                ? {
                    method: 'totp',
                    eventId: randomUUID(),
                    verifiedAt: now.toISOString(),
                    factorVersion: 1,
                    origin: { kind: 'flow', flowId: f.flow.id },
                  }
                : null,
          },
          ...(options.oauth && {
            identity: {
              method: 'oauth',
              eventId: randomUUID(),
              verifiedAt: now.toISOString(),
              securityVersion: 3,
            },
          }),
        },
      },
    })
  })
  const request: FlowRequest = {
    credential,
    purpose: options.sourceSession ? 'reauthenticate' : 'login',
    audience: browser?.audience ?? 'direct',
    bindingHash: browser?.bindingHash ?? 'direct-fixture-binding',
    browser,
  }
  const jwt = new JwtService({
    secret: '<fake-local-family-issuer-signing-key-at-least-32>',
    signOptions: { expiresIn: '15m' },
  })
  const tokens = new TokenService(jwt, new EnvService(new ConfigService({ JWT_REFRESH_DAYS: 30 })))
  return {
    ...f,
    request,
    jwt,
    tokens,
    service: new MfaFamilyIssuanceService(db as unknown as PrismaService, tokens),
    operationId: randomUUID(),
    vaultBinding: browser ? mfaCredential() : null,
  }
}
