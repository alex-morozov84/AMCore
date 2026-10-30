import { ConfigService } from '@nestjs/config'

import {
  AuthErrorCode,
  BROWSER_AUTH_HEADERS,
  type RequestPrincipal,
  SystemRole,
} from '@amcore/shared'

import { hashBrowserBinding } from '../src/core/auth/mfa/browser-binding.js'
import { MfaJwtAdmissionService } from '../src/core/auth/mfa/mfa-jwt-admission.service.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { BrowserSessionContextService } from '../src/core/frontend-context/browser-session-context.service.js'
import { EnvService } from '../src/env/env.service.js'

import { authorityReader, createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

const transportKey = '<fake-local-browser-transport-key-at-least-32>'

describe('JWT authority after credential selection and actual trusted browser normalization', () => {
  const fixture = new MfaProofFixture()
  const transport = new BrowserSessionContextService(
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

  it('requires the actual verified binding; pending/revoked/old-generation families cannot pass', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const binding = mfaCredential()
    await db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { bindingHash: hashBrowserBinding(binding)! },
    })
    const request = {}
    const headers = {
      [BROWSER_AUTH_HEADERS.key]: transportKey,
      [BROWSER_AUTH_HEADERS.audience]: 'product',
      [BROWSER_AUTH_HEADERS.binding]: binding,
      [BROWSER_AUTH_HEADERS.contextId]: f.requestBinding.contextId,
      [BROWSER_AUTH_HEADERS.generation]: '1',
    }
    const principal: RequestPrincipal = { type: 'jwt', ...f.claims }
    const guard = new MfaJwtAdmissionService(authorityReader(db))
    await expect(guard.assert({}, principal)).rejects.toMatchObject({
      errorCode: AuthErrorCode.AUTH_CONTEXT_CHANGED,
    })
    transport.verify(request, headers)
    await expect(guard.assert(request, principal)).resolves.toMatchObject({
      principal,
      currentRole: principal.systemRole,
    })
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { publicationState: 'pending' },
    })
    await expect(guard.assert(request, principal)).rejects.toMatchObject({
      errorCode: AuthErrorCode.AUTH_CONTEXT_CHANGED,
    })
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { publicationState: 'published' },
    })
    await db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { generation: 2 },
    })
    await expect(guard.assert(request, principal)).rejects.toMatchObject({
      errorCode: AuthErrorCode.AUTH_CONTEXT_CHANGED,
    })
    await db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { generation: 1 },
    })
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { revokedAt: await mfaDatabaseClock(db) },
    })
    await expect(guard.assert(request, principal)).rejects.toMatchObject({
      errorCode: AuthErrorCode.AUTH_CONTEXT_CHANGED,
    })
  })

  it('preserves only never-protected legacy prepared login and rejects neutral bootstrap on data admission', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture, false)
    await db.mfaProtocol.update({ where: { id: 'platform' }, data: { state: 'prepared' } })
    const principal: RequestPrincipal = {
      type: 'jwt',
      sub: f.user.id,
      email: f.user.email,
      systemRole: SystemRole.User,
    }
    const guard = new MfaJwtAdmissionService(authorityReader(db))
    await expect(guard.assert({}, principal)).resolves.toMatchObject({
      principal,
      currentRole: principal.systemRole,
    })
    const bootstrap = {}
    transport.verify(bootstrap, {
      [BROWSER_AUTH_HEADERS.key]: transportKey,
      [BROWSER_AUTH_HEADERS.audience]: 'product',
    })
    await expect(guard.assert(bootstrap, principal)).rejects.toMatchObject({
      errorCode: AuthErrorCode.AUTH_CONTEXT_CHANGED,
    })
    await db.user.update({ where: { id: f.user.id }, data: { systemRole: SystemRole.SuperAdmin } })
    await expect(guard.assert({}, principal)).rejects.toMatchObject({
      errorCode: 'SERVICE_UNAVAILABLE',
    })
  })

  it('keeps ordinary direct residual access but rejects the deleted account from primary state', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture, false)
    const principal: RequestPrincipal = {
      type: 'jwt',
      sub: f.user.id,
      email: f.user.email,
      systemRole: SystemRole.User,
    }
    const guard = new MfaJwtAdmissionService(authorityReader(db))
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { revokedAt: await mfaDatabaseClock(db) },
    })
    await expect(guard.assert({}, principal)).resolves.toMatchObject({
      principal,
      currentRole: principal.systemRole,
    })
    await db.user.delete({ where: { id: f.user.id } })
    await expect(guard.assert({}, principal)).rejects.toMatchObject({
      errorCode: AuthErrorCode.SESSION_CHANGED,
    })
  })
})
