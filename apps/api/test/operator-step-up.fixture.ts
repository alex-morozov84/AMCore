import { randomUUID } from 'node:crypto'

import request, { type Test } from 'supertest'

import { backupCodeHash, generateBackupCodes } from '../src/core/auth/mfa/mfa-secrets.js'
import { TokenService } from '../src/core/auth/token.service.js'

import type { E2ETestContext } from './helpers.js'

/** Real source-family HTTP reauthentication; fixture provisions only an unused backup code. */
export async function reauthenticateDomainOperator(
  context: E2ETestContext,
  token: string,
  password: string
): Promise<void> {
  const claims = context.app.get(TokenService).verifyAccessToken(token)
  const account = await context.prisma.mfaAccount.findUniqueOrThrow({
    where: { userId: claims.sub },
  })
  const code = generateBackupCodes()[0]!
  await context.prisma.mfaRecoveryCode.create({
    data: {
      userId: claims.sub,
      generation: account.codeGeneration,
      hash: backupCodeHash(claims.sub, account.codeGeneration, code),
    },
  })
  const started = await request(context.app.getHttpServer())
    .post('/auth/mfa/session-flow')
    .auth(token, { type: 'bearer' })
    .send({ purpose: 'reauthenticate', operationId: randomUUID() })
    .expect(200)
  const pending = (path: string): Test =>
    request(context.app.getHttpServer())
      .post(`/auth/mfa/${path}`)
      .set('x-mfa-continuation', started.body.continuation)
  const primary = await pending('password')
    .send({ purpose: 'reauthenticate', operationId: randomUUID(), password })
    .expect(200)
  expect(['verified', 'proof_required']).toContain(primary.body.outcome)
  expect(primary.body.requiredProofs ?? []).not.toContain('password')
  await pending('verify')
    .send({
      purpose: 'reauthenticate',
      operationId: randomUUID(),
      proof: { method: 'recovery_code', code },
    })
    .expect(200)
    .expect(({ body }) => expect(body.outcome).toBe('verified'))
  await pending('reauthenticate')
    .send({ purpose: 'reauthenticate', operationId: randomUUID() })
    .expect(200)
    .expect(({ body }) => expect(body.outcome).toBe('completed'))
}
