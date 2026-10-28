import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import { BROWSER_AUTH_HEADERS, SystemRole } from '@amcore/shared'

import { hashBrowserBinding } from '../src/core/auth/mfa/browser-binding.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { PrivilegedAdmissionService } from '../src/core/auth/privileged-admission.service.js'
import { PrivilegedRoleService } from '../src/core/auth/privileged-role.service.js'
import { BrowserSessionContextService } from '../src/core/frontend-context/browser-session-context.service.js'
import { EnvService } from '../src/env/env.service.js'
import { BullBoardAuthService } from '../src/infrastructure/queue/dashboard/bull-board-auth.service.js'
import type { BoardAuthRequest } from '../src/infrastructure/queue/dashboard/bull-board-auth-context.js'
import { BullBoardBearerAuthService } from '../src/infrastructure/queue/dashboard/bull-board-bearer-auth.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { authorityReader, createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

const transportKey = '<fake-board-private-context-key-at-least-32>'

describe('Both read-only Board credentials use primary family and actual browser authority', () => {
  const fixture = new MfaProofFixture()
  const jwt = new JwtService({ secret: '<fake-board-local-jwt-secret-at-least-32>' })
  const contexts = new BrowserSessionContextService(
    new EnvService(new ConfigService({ WEB_FRONTEND_CONTEXT_KEY: transportKey }))
  )
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    const db = fixture.clients[0]!
    await db.user.deleteMany()
    await db.browserAuthContext.deleteMany()
    await db.mfaProtocol.upsert({
      where: { id: 'platform' },
      create: { id: 'platform', state: 'active' },
      update: { state: 'active', version: 1 },
    })
  })

  async function setup() {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const binding = mfaCredential()
    await db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { bindingHash: hashBrowserBinding(binding)! },
    })
    const request: BoardAuthRequest = {
      headers: {
        [BROWSER_AUTH_HEADERS.key]: transportKey,
        [BROWSER_AUTH_HEADERS.audience]: 'product',
        [BROWSER_AUTH_HEADERS.binding]: binding,
        [BROWSER_AUTH_HEADERS.contextId]: f.requestBinding.contextId,
        [BROWSER_AUTH_HEADERS.generation]: '1',
      },
    }
    const prisma = db as unknown as PrismaService
    const reader = authorityReader(db)
    const bearer = new BullBoardBearerAuthService(
      jwt,
      new PrivilegedAdmissionService(new PrivilegedRoleService(prisma)),
      reader,
      contexts
    )
    const cookie = new BullBoardAuthService(prisma, reader, contexts)
    const token = jwt.sign(f.claims, { expiresIn: '15m' })
    const raw = `fixture-refresh:${f.user.id}`
    const verify = async (req: BoardAuthRequest = request) => [
      (await bearer.verify(token, req)).kind,
      await cookie.verifyAccess(raw, req),
    ]
    return { db, f, request, verify, bearer, cookie, token, raw }
  }

  it('accepts both transports, without renewing proofs, rotating or revoking credentials', async () => {
    const { db, f, verify } = await setup()
    const before = await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })
    await expect(verify()).resolves.toEqual(['authorized', 'authorized'])
    await expect(
      db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })
    ).resolves.toEqual(before)
    await expect(db.session.findUniqueOrThrow({ where: { id: f.session.id } })).resolves.toEqual(
      f.session
    )
  })

  it('refuses absent, neutral, malformed and mismatched private browser evidence', async () => {
    const { request, verify } = await setup()
    await expect(verify({ headers: {} })).resolves.toEqual(['session_changed', 'session_changed'])
    await expect(
      verify({
        headers: {
          [BROWSER_AUTH_HEADERS.key]: transportKey,
          [BROWSER_AUTH_HEADERS.audience]: 'product',
        },
      })
    ).resolves.toEqual(['session_changed', 'session_changed'])
    for (const [header, value] of [
      [BROWSER_AUTH_HEADERS.key, '<fake-wrong-private-key>'],
      [BROWSER_AUTH_HEADERS.generation, 'invalid'],
      [BROWSER_AUTH_HEADERS.binding, mfaCredential()],
      [BROWSER_AUTH_HEADERS.generation, '2'],
    ]) {
      const outcome = await verify({ headers: { ...request.headers, [header!]: value } })
      expect(outcome).toEqual(
        header === BROWSER_AUTH_HEADERS.key || value === 'invalid'
          ? ['forbidden', 'forbidden']
          : ['session_changed', 'session_changed']
      )
    }
  })

  it.each(['pending', 'epoch', 'factor', 'revoke', 'generation'])(
    'refuses the next request after %s changes, with no positive cache',
    async (change) => {
      const { db, f, verify } = await setup()
      await expect(verify()).resolves.toEqual(['authorized', 'authorized'])
      if (change === 'pending')
        await db.authSessionFamily.update({
          where: { id: f.family.id },
          data: { publicationState: 'pending' },
        })
      if (change === 'epoch')
        await db.mfaAccount.update({ where: { userId: f.user.id }, data: { securityVersion: 4 } })
      if (change === 'factor')
        await db.mfaFactor.update({ where: { userId: f.user.id }, data: { version: 2 } })
      if (change === 'revoke')
        await db.authSessionFamily.update({
          where: { id: f.family.id },
          data: { revokedAt: new Date() },
        })
      if (change === 'generation')
        await db.browserAuthContext.update({
          where: { id: f.requestBinding.contextId },
          data: { generation: 2 },
        })
      await expect(verify()).resolves.toEqual(['session_changed', 'session_changed'])
    }
  )

  it('distinguishes stable-family access tokens from the presented refresh credential itself', async () => {
    const { db, f, verify } = await setup()
    await db.session.update({ where: { id: f.session.id }, data: { revokedAt: new Date() } })
    await expect(verify()).resolves.toEqual(['authorized', 'unauthenticated'])
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { revokedAt: new Date() },
    })
    await expect(verify()).resolves.toEqual(['session_changed', 'unauthenticated'])
  })

  it('returns unavailable in prepared state for an enrolled account, and refuses demotion', async () => {
    const { db, f, verify } = await setup()
    await db.mfaProtocol.update({ where: { id: 'platform' }, data: { state: 'prepared' } })
    await expect(verify()).resolves.toEqual(['unavailable', 'unavailable'])
    await db.user.update({ where: { id: f.user.id }, data: { systemRole: SystemRole.User } })
    await expect(verify()).resolves.toEqual(['forbidden', 'forbidden'])
  })
})
