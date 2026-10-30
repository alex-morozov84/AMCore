import { randomUUID } from 'node:crypto'

import { MfaAuthorityReader } from '../src/core/auth/mfa/mfa-authority-reader.service.js'
import {
  continuationHash,
  directFlowBinding,
  type FlowRequest,
  lockMfaFlow,
} from '../src/core/auth/mfa/mfa-flow-lock.js'
import {
  backupCodeHash,
  generateBackupCodes,
  mfaCredential,
} from '../src/core/auth/mfa/mfa-secrets.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { OAuthService } from '../src/core/auth/oauth/oauth.service.js'
import type { OAuthStateData } from '../src/core/auth/oauth/oauth-state.service.js'
import type { PasswordStepUpSource } from '../src/core/auth/password-step-up-authority.js'
import { SessionService } from '../src/core/auth/session.service.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

/** Actual callback mutation/primary locks; provider and one-use state are controlled stand-ins. */
describe('Protected provider linking retains its exact original family through callback', () => {
  const fixture = new MfaProofFixture()
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

  async function prepared() {
    const db = fixture.clients[0]!,
      f = await createAuthorityAccount(fixture)
    const states = new Map<string, OAuthStateData>()
    const source: PasswordStepUpSource = {
      principal: { ...f.claims, type: 'jwt' },
      browser: f.requestBinding,
    }
    const provider = {
      getAuthorizationURL: async (state: string) =>
        new URL(`https://provider.example.test/consent?state=${state}`),
      exchangeCode: async () => ({ accessToken: '<fake-provider-access>' }),
      getUserProfile: async () => ({
        providerId: 'protected-link-provider',
        provider: 'google',
        email: f.user.email,
        emailVerified: true,
        displayName: null,
        avatarUrl: null,
      }),
    }
    const service = new OAuthService(
      db as never,
      {} as never,
      { invalidateUser: async () => undefined } as never,
      { get: () => provider } as never,
      {
        store: async (key: string, value: OAuthStateData) => {
          states.set(key, value)
        },
        consume: async (key: string) => {
          const value = states.get(key)
          states.delete(key)
          return value ?? null
        },
      } as never,
      {} as never,
      { setContext: () => undefined, info: () => undefined } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    )
    const started = await service.getLinkAuthorizationURL('google', f.user.id, undefined, source)
    const state = new URL(started.url).searchParams.get('state')!
    const complete = () =>
      service.handleCallback('google', '<fake-provider-code>', state, started.browserNonce, {
        userAgent: 'test-agent',
        ipAddress: '127.0.0.1',
      })
    return { db, f, service, states, state, source, complete }
  }

  it('links once, retires all old authority and preserves factor/replay/backup state', async () => {
    const f = await prepared()
    const nativeFamily = await f.db.authSessionFamily.create({
      data: {
        ...f.f.family,
        id: randomUUID(),
        browserContextId: null,
        publicationGeneration: null,
      },
    })
    const nativeSession = await f.db.session.create({
      data: {
        ...f.f.session,
        id: randomUUID(),
        familyId: nativeFamily.id,
        refreshToken: randomUUID(),
      },
    })
    const code = generateBackupCodes()[0]!
    await f.db.mfaRecoveryCode.create({
      data: {
        userId: f.f.user.id,
        generation: 0,
        hash: backupCodeHash(f.f.user.id, 0, code),
      },
    })
    const sessionCredential = mfaCredential(),
      loginCredential = mfaCredential()
    await f.db.mfaFlow.update({
      where: { id: f.f.flow.id },
      data: {
        credentialHash: continuationHash(sessionCredential)!,
        browserContextId: f.f.family.browserContextId,
        publicationGeneration: f.f.family.publicationGeneration,
      },
    })
    await f.db.mfaFlow.create({
      data: {
        userId: f.f.user.id,
        credentialHash: continuationHash(loginCredential)!,
        purpose: 'login',
        authorityKind: 'identity',
        audience: 'native',
        bindingHash: directFlowBinding(loginCredential)!,
        securityVersion: 3,
        expiresAt: f.f.family.expiresAt,
      },
    })
    const flows: FlowRequest[] = [
      {
        credential: sessionCredential,
        purpose: 'reauthenticate',
        audience: 'product',
        bindingHash: f.f.requestBinding.bindingHash,
        browser: f.f.requestBinding,
      },
      {
        credential: loginCredential,
        purpose: 'login',
        audience: 'native',
        bindingHash: directFlowBinding(loginCredential)!,
        browser: null,
      },
    ]
    const nativeClaims = {
      ...f.f.claims,
      fid: nativeFamily.id,
      sid: nativeSession.id,
      browserBound: undefined,
    }
    const reader = new MfaAuthorityReader(f.db)
    expect(await reader.readForRuntime(f.f.claims, f.f.requestBinding)).toMatchObject({
      kind: 'admitted',
    })
    expect(await reader.readForRuntime(nativeClaims, null)).toMatchObject({ kind: 'admitted' })
    for (const flow of flows)
      expect(await f.db.$transaction((tx) => lockMfaFlow(tx, flow))).not.toBeNull()
    const factors = await f.db.mfaFactor.findMany(),
      codes = await f.db.mfaRecoveryCode.findMany()
    expect(f.states.get(f.state)?.linkSource).toMatchObject({
      principal: { fid: f.f.family.id, securityVersion: 3 },
      browser: f.f.requestBinding,
    })
    expect(await f.complete()).toMatchObject({ mode: 'link', reauthenticationRequired: true })
    expect(await f.db.oAuthAccount.count()).toBe(1)
    expect(
      await f.db.mfaAccount.findUniqueOrThrow({ where: { userId: f.f.user.id } })
    ).toMatchObject({ securityVersion: 4 })
    expect(await f.db.session.count()).toBe(2)
    expect(await f.db.authSessionFamily.count()).toBe(2)
    expect(await reader.readForRuntime(f.f.claims, f.f.requestBinding)).toMatchObject({
      kind: 'denied',
    })
    expect(await reader.readForRuntime(nativeClaims, null)).toMatchObject({ kind: 'denied' })
    const sessions = new SessionService(
      f.db as never,
      {} as never,
      {} as never,
      { setContext: () => undefined } as never
    )
    await expect(
      sessions.validateRefreshToken(f.f.session.refreshToken, f.f.requestBinding)
    ).rejects.toMatchObject({ errorCode: 'TOKEN_INVALID' })
    await expect(sessions.validateRefreshToken(nativeSession.refreshToken)).rejects.toMatchObject({
      errorCode: 'TOKEN_INVALID',
    })
    for (const flow of flows)
      expect(await f.db.$transaction((tx) => lockMfaFlow(tx, flow))).toBeNull()
    expect(await f.db.mfaFactor.findMany()).toEqual(factors)
    expect(await f.db.mfaRecoveryCode.findMany()).toEqual(codes)
    await expect(f.complete()).rejects.toMatchObject({ errorCode: 'OAUTH_STATE_INVALID' })
    expect(
      await f.db.mfaAccount.findUniqueOrThrow({ where: { userId: f.f.user.id } })
    ).toMatchObject({ securityVersion: 4 })
    expect(await f.db.oAuthAccount.count()).toBe(1)
    expect(await f.db.session.count()).toBe(2)
  })

  it('rolls provider, epoch and family retirement back if session revocation fails', async () => {
    const f = await prepared()
    const before = {
      account: await f.db.mfaAccount.findMany(),
      families: await f.db.authSessionFamily.findMany(),
      sessions: await f.db.session.findMany(),
      flows: await f.db.mfaFlow.findMany(),
    }
    // A real database failure after epoch/family writes proves transactional rollback.
    await f.db
      .$executeRaw`CREATE FUNCTION core.reject_link_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled link revocation failure'; END $$`
    await f.db
      .$executeRaw`CREATE TRIGGER reject_link_revocation BEFORE UPDATE ON core.sessions FOR EACH ROW EXECUTE FUNCTION core.reject_link_revocation()`
    try {
      await expect(f.complete()).rejects.toThrow()
      expect(await f.db.oAuthAccount.count()).toBe(0)
      expect(await f.db.mfaAccount.findMany()).toEqual(before.account)
      expect(await f.db.authSessionFamily.findMany()).toEqual(before.families)
      expect(await f.db.session.findMany()).toEqual(before.sessions)
      expect(await f.db.mfaFlow.findMany()).toEqual(before.flows)
      await expect(f.complete()).rejects.toMatchObject({ errorCode: 'OAUTH_STATE_INVALID' })
    } finally {
      await f.db.$executeRaw`DROP TRIGGER reject_link_revocation ON core.sessions`
      await f.db.$executeRaw`DROP FUNCTION core.reject_link_revocation()`
    }
  })

  it.each([
    'revoked',
    'epoch',
    'browser',
    'stale-proof',
    'expired-state',
    'missing-source',
  ] as const)(
    'refuses %s at callback without attaching a provider or borrowing another family',
    async (kind) => {
      const f = await prepared(),
        now = await mfaDatabaseClock(f.db)
      await f.db.authSessionFamily.create({
        data: {
          ...f.f.family,
          id: randomUUID(),
          browserContextId: null,
          publicationGeneration: null,
        },
      })
      if (kind === 'revoked')
        await f.db.authSessionFamily.update({
          where: { id: f.f.family.id },
          data: { revokedAt: now },
        })
      if (kind === 'epoch')
        await f.db.mfaAccount.update({
          where: { userId: f.f.user.id },
          data: { securityVersion: { increment: 1 } },
        })
      if (kind === 'browser')
        await f.db.browserAuthContext.update({
          where: { id: f.f.requestBinding.contextId },
          data: { generation: { increment: 1 } },
        })
      if (kind === 'stale-proof')
        await f.db.authSessionFamily.update({
          where: { id: f.f.family.id },
          data: { mfaAt: new Date(now.getTime() - 601000) },
        })
      if (kind === 'expired-state')
        f.states.get(f.state)!.linkSource!.expiresAt = new Date(now.getTime() - 1).toISOString()
      if (kind === 'missing-source') delete f.states.get(f.state)!.linkSource
      await expect(f.complete()).rejects.toMatchObject({
        errorCode: kind === 'stale-proof' ? 'STEP_UP_REQUIRED' : 'SESSION_CHANGED',
      })
      expect(await f.db.oAuthAccount.count()).toBe(0)
    }
  )

  it('does not create protected link state from a user ID or stale password-only evidence', async () => {
    const f = await prepared()
    await expect(f.service.getLinkAuthorizationURL('google', f.f.user.id)).rejects.toMatchObject({
      errorCode: 'SESSION_CHANGED',
    })
    await f.db.authSessionFamily.update({ where: { id: f.f.family.id }, data: { mfaAt: null } })
    await expect(
      f.service.getLinkAuthorizationURL('google', f.f.user.id, undefined, f.source)
    ).rejects.toMatchObject({ errorCode: 'SESSION_CHANGED' })
  })
})
