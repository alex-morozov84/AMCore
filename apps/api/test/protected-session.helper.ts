import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { generate } from 'otplib'
import request, { type Test } from 'supertest'

import { MfaEncryptionService } from '../src/core/auth/mfa/mfa-encryption.service.js'
import { createTotpSecret } from '../src/core/auth/mfa/mfa-totp.js'
import type { PrismaService } from '../src/prisma/index.js'

/** Previously enrolled account in this suite's isolated database; never a deployment activation. */
async function enroll(
  app: INestApplication,
  prisma: PrismaService,
  userId: string,
  email: string
): Promise<string> {
  await prisma.mfaProtocol.upsert({
    where: { id: 'platform' },
    create: { id: 'platform', state: 'active', version: 1 },
    update: { state: 'active' },
  })
  await prisma.mfaAccount.create({
    data: { userId, required: true, setupComplete: true, securityVersion: 1, codeGeneration: 1 },
  })
  const id = randomUUID()
  const { secret } = createTotpSecret(email)
  const encrypted = app.get(MfaEncryptionService).encrypt(userId, id, secret)
  await prisma.mfaFactor.create({ data: { id, userId, ...encrypted } })
  return secret
}

/** Proves password + TOTP and acknowledges the exact direct-client publication through HTTP. */
export async function protectedSession(
  app: INestApplication,
  prisma: PrismaService,
  userId: string,
  email: string,
  password: string,
  prefix = ''
): Promise<{ cookie: string; accessToken: string }> {
  const secret = await enroll(app, prisma, userId, email)
  const started = await request(app.getHttpServer())
    .post(`${prefix}/auth/login`)
    .send({ email, password })
    .expect(202)
  const command = (path: string, body: Record<string, unknown>): Test =>
    request(app.getHttpServer())
      .post(`${prefix}/auth/mfa/${path}`)
      .set('x-mfa-continuation', started.body.continuation)
      .send(body)
      .expect(200)
  await command('verify', {
    purpose: 'login',
    operationId: randomUUID(),
    proof: { method: 'totp', code: await generate({ secret }) },
  }).expect(({ body }) => expect(body.outcome).toBe('verified'))
  const complete = { purpose: 'login', operationId: randomUUID(), vaultBinding: null }
  const issued = await command('complete', complete)
  await command('publication/acknowledge', {
    ...complete,
    accessToken: issued.body.accessToken,
    receipt: issued.body.publication.receipt,
  })
  const cookie = (issued.headers['set-cookie'] as unknown as string[])
    .find((value) => value.startsWith('refresh_token='))
    ?.split(';')[0]
  if (!cookie) throw new Error('Protected fixture did not receive its refresh cookie')
  return { cookie, accessToken: issued.body.accessToken as string }
}
