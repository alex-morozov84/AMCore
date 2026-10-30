import { randomBytes, randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'
import {
  BROWSER_AUTH_HEADERS,
  loginSchema,
  registerSchema,
  type UserResponse,
} from '@amcore/shared'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const browser = vi.hoisted(() => ({
  cookies: {} as Record<string, string>,
  source: null as Headers | null,
}))
vi.mock('server-only', () => ({}))
// Provider linking DAL is outside this independent login composition.
vi.mock('./dal', () => ({ getOptionalSessionEntry: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (browser.cookies[name] ? { value: browser.cookies[name] } : undefined),
  }),
  headers: async () => browser.source ?? new Headers(),
}))

import { proxyToBackend } from './authenticated-proxy'
import { readBrowserAuthAttempt } from './browser-auth-attempt'
import { handleBrowserBootstrap } from './browser-bootstrap-handler'
import { handleBrowserOAuth } from './browser-login-handler'
import { handleCredentialAuth } from './credential-auth-handler'
import { invitationAckHandler } from './invitation-ack-handler'
import { invitationCookiePolicy } from './invitation-cookie'
import { invitationCredentialHandler } from './invitation-credential-handler'
import { admitInvitationFlow, newInvitationOwner } from './invitation-flow-authority'
import { invitationOAuthReservation } from './invitation-oauth-reservation'
import { invitationOwnerHash, invitationOwnerStore } from './invitation-owner-store'
import { handleLogout } from './logout-handler'
import { commandPendingMfa, inspectPendingMfa } from './mfa-pending-handler'
import { inspectMfaSettings } from './mfa-settings-handler'
import { completeSourceReauthentication, startSourceReauthentication } from './mfa-source-operation'
import { handleOAuthExchange } from './oauth-exchange-handler'
import { proxyOAuthAuthorize } from './oauth-provider-proxy'
import { productContextDeps } from './product-context-deps'
import { resolveProductWebContext } from './product-web-context.server'
import { productWebRoute } from './product-web-route'
import { getWebRedisClient } from './redis-client'

let container: StartedRedisContainer
beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start()
  vi.stubEnv('REDIS_URL', container.getConnectionUrl())
  vi.stubEnv('FRONTEND_URL', 'http://localhost:3002')
  vi.stubEnv('PRODUCT_ADMIN_ORIGIN', '')
  vi.stubEnv('WEB_INVITATION_LOCAL_HTTP_ORIGIN', 'http://localhost:3002')
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-browser-flow-private-key-at-least-32>')
}, 60000)
afterAll(async () => {
  await (await getWebRedisClient()).close()
  await container?.stop()
  vi.unstubAllEnvs()
})
beforeEach(async () => {
  browser.cookies = {}
  browser.source = null
  await (await getWebRedisClient()).flushDb()
})
afterEach(() => vi.unstubAllGlobals())

const user: UserResponse = {
  id: 'user-A',
  email: 'demo@example.test',
  emailVerified: true,
  name: null,
  avatarUrl: null,
  phone: null,
  locale: 'en',
  timezone: 'UTC',
  createdAt: new Date(0).toISOString(),
  lastLoginAt: null,
}
function request(path: string, body?: unknown) {
  const source = new Headers({
    host: 'localhost:3002',
    origin: 'http://localhost:3002',
    'content-type': 'application/json',
    cookie: Object.entries(browser.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join(';'),
  })
  browser.source = source
  return new Request(`http://localhost:3002${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: source,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function acceptCookies(response: NextResponse) {
  for (const cookie of response.cookies.getAll()) {
    if (!cookie.value) delete browser.cookies[cookie.name]
    else browser.cookies[cookie.name] = cookie.value
  }
}
function context() {
  return resolveProductWebContext(request('/').headers, 'site-auth')
}

/** Real BFF and Redis CAS, with a strict upstream stand-in. Actual API password/proof/publication has its own HTTP suite. */
function upstream(
  protectedAccount = false,
  loseCredentialResponse = false,
  loseAckResponse = false,
  registrationCommitted?: () => Promise<void>,
  initialSetup: boolean | 'recovery_ticket' = false
) {
  const enrollment = Boolean(initialSetup)
  let recoveryPending = initialSetup === 'recovery_ticket'
  const anchor = randomBytes(32).toString('base64url')
  let continuation = randomBytes(32).toString('base64url')
  const receipt = protectedAccount ? randomBytes(32).toString('base64url') : null
  let generation = 0,
    phase: 'empty' | 'pending' | 'published' | 'retired' = 'empty',
    verified = false,
    operationId = ''
  let dataRequests = 0,
    acknowledgements = 0,
    retirements = 0,
    refreshes = 0
  let logouts = 0
  let usedRecovery = false
  let needsPassword = false
  let bound = false,
    codesSaved = false,
    codeGeneration = 1
  let invited: { attemptId: string; cleanupKey: string } | undefined
  const accessToken = `fakeheader.${Buffer.from(JSON.stringify({ sub: user.id, sid: 'session-A' })).toString('base64url')}.fakesignature`
  const view = () => ({
    contextId: 'context-A',
    generation,
    state: phase === 'published' ? 'published' : generation ? 'reserved' : 'empty',
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  })
  const status = () => ({
    kind: 'mfa',
    purpose: enrollment ? 'initial_setup' : 'login',
    state: enrollment
      ? !bound
        ? 'enrollment_required'
        : !codesSaved
          ? 'codes_pending'
          : 'ready'
      : needsPassword
        ? 'password_required'
        : protectedAccount && !verified
          ? 'verify_required'
          : 'ready',
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    requiredProofs: [
      ...(needsPassword ? ['password'] : []),
      ...(!enrollment && protectedAccount && !verified ? ['second_factor'] : []),
    ],
    remainingCodes: usedRecovery ? 0 : 1,
    generation: enrollment ? (bound ? codeGeneration : 0) : 1,
  })
  const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname
    const headers = new Headers(init?.headers)
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {}
    if (path.endsWith('/browser-publications/bootstrap'))
      return Response.json(
        body.binding
          ? { kind: 'existing', view: view() }
          : { kind: 'created', binding: anchor, view: view() }
      )
    if (invited && path.endsWith('/abort')) {
      expect(headers.get('x-invitation-handoff-key')).toBe(invited.cleanupKey)
      return phase === 'published'
        ? Response.json({ errorCode: 'AUTH_HANDOFF_CONFIRMED' }, { status: 409 })
        : Response.json({ status: 'aborted' })
    }
    if (path.endsWith('/auth/oauth/google')) {
      if (headers.has('x-invitation-auth-attempt-id'))
        invited = {
          attemptId: headers.get('x-invitation-auth-attempt-id')!,
          cleanupKey: headers.get('x-invitation-handoff-key')!,
        }
      expect(headers.get(BROWSER_AUTH_HEADERS.binding)).toBe(anchor)
      return new Response(null, {
        status: 302,
        headers: {
          location: 'https://provider.example.test/authorize',
          'set-cookie': 'oauth_state=fake-state; Path=/; HttpOnly; SameSite=Lax',
        },
      })
    }
    expect(headers.get(BROWSER_AUTH_HEADERS.binding)).toBe(anchor)
    expect(headers.get(BROWSER_AUTH_HEADERS.audience)).toBe('product')
    if (path.endsWith('/auth/register') || path.endsWith('/auth/invites/register')) {
      if (headers.has('x-invitation-auth-attempt-id'))
        invited = {
          attemptId: headers.get('x-invitation-auth-attempt-id')!,
          cleanupKey: headers.get('x-invitation-handoff-key')!,
        }
      const retained = await readBrowserAuthAttempt(browser.source!, context())
      expect(retained?.record.state).toBe('issuing')
      continuation = headers.get('x-mfa-continuation')!
      operationId = headers.get('x-amcore-login-attempt')!
      expect(retained?.record.id).toBe(operationId)
      generation += 1
      phase = 'pending'
      await registrationCommitted?.()
      return Response.json(
        {
          user,
          accessToken,
          publication: {
            continuation,
            operationId,
            receipt: null,
            familyId: 'family-A',
            securityVersion: 1,
            browser: { contextId: 'context-A', generation, audience: 'product' },
          },
        },
        {
          status: 201,
          headers: { 'set-cookie': `refresh_token=${'1'.repeat(64)}; Path=/; HttpOnly` },
        }
      )
    }
    if (path.endsWith('/auth/login') || path.endsWith('/auth/oauth/exchange')) {
      if (headers.has('x-invitation-auth-attempt-id'))
        invited = {
          attemptId: headers.get('x-invitation-auth-attempt-id')!,
          cleanupKey: headers.get('x-invitation-handoff-key')!,
        }
      if (path.endsWith('/auth/oauth/exchange')) {
        expect(headers.get('cookie')).toBe(`refresh_token=${'2'.repeat(64)}`)
        const retained = await readBrowserAuthAttempt(browser.source!, context())
        expect(headers.get('x-amcore-oauth-attempt')).toBe(retained?.record.id)
        needsPassword = protectedAccount
      }
      generation += 1
      return Response.json(
        {
          ...status(),
          continuation,
          nextAction: recoveryPending
            ? 'recovery_ticket'
            : enrollment
              ? 'enroll'
              : protectedAccount
                ? 'verify'
                : 'complete',
          browser: { contextId: 'context-A', generation },
        },
        { status: 202 }
      )
    }
    if (path.endsWith('/auth/mfa/redeem-recovery-ticket')) {
      expect(recoveryPending).toBe(true)
      expect(headers.get('x-mfa-continuation')).toBe(continuation)
      if (body.ticket !== 'r'.repeat(43)) return Response.json({ outcome: 'wrong_ticket' })
      recoveryPending = false
      continuation = randomBytes(32).toString('base64url')
      generation += 1
      return Response.json({
        outcome: 'enrollment',
        successor: {
          continuation,
          purpose: 'initial_setup',
          browser: { contextId: 'context-A', generation },
          expiresAt: status().expiresAt,
        },
      })
    }
    if (path.endsWith('/auth/mfa/enrollment')) {
      if (recoveryPending) return Response.json({ outcome: 'restart_required' })
      expect(enrollment && !bound).toBe(true)
      expect(headers.get('x-mfa-continuation')).toBe(continuation)
      return Response.json({
        outcome: 'seed',
        enrollment: { secret: '<fake-unbound-seed>', otpauthUri: 'otpauth://totp/fake' },
        expiresAt: status().expiresAt,
      })
    }
    if (path.endsWith('/auth/mfa/bind-factor')) {
      expect(enrollment && !bound).toBe(true)
      expect(headers.get('x-mfa-continuation')).toBe(continuation)
      bound = true
      verified = true
      generation += 1
      continuation = randomBytes(32).toString('base64url')
      return Response.json({
        outcome: 'bound',
        successor: {
          continuation,
          purpose: 'initial_setup',
          browser: { contextId: 'context-A', generation },
          expiresAt: status().expiresAt,
          backupCodes: {
            codes: Array.from(
              { length: 10 },
              (_, i) => `0000-0000-0000-0000-0000-0000-0000-${String(i + 1).padStart(4, '0')}`
            ),
            generation: codeGeneration,
          },
        },
      })
    }
    if (path.endsWith('/auth/mfa/acknowledge-codes')) {
      expect(enrollment && bound).toBe(true)
      expect(headers.get('x-mfa-continuation')).toBe(continuation)
      expect(body.generation).toBe(codeGeneration)
      codesSaved = true
      return Response.json({ outcome: 'acknowledged', generation: codeGeneration })
    }
    if (path.endsWith('/auth/mfa/recover-setup-codes')) {
      expect(enrollment && bound && !codesSaved).toBe(true)
      expect(headers.get('x-mfa-continuation')).toBe(continuation)
      codeGeneration += 1
      return Response.json({
        outcome: 'codes',
        backupCodes: {
          codes: Array.from(
            { length: 10 },
            (_, i) => `0000-0000-0000-0000-0000-0000-0000-${String(i + 21).padStart(4, '0')}`
          ),
          generation: codeGeneration,
        },
      })
    }
    if (path.endsWith('/auth/mfa/password')) {
      expect(headers.get('x-mfa-continuation')).toBe(continuation)
      expect(body.purpose).toBe('login')
      expect(body.proof).toBeUndefined()
      if (body.password === '<fake-no-local-password>')
        return Response.json({ outcome: 'password_setup_required' })
      if (body.password !== '<fake-local-password>')
        return Response.json({ outcome: 'wrong_password' })
      needsPassword = false
      return Response.json({ outcome: 'verified', requiredProofs: ['second_factor'] })
    }
    if (path.endsWith('/auth/mfa/status')) return Response.json(status())
    if (path.endsWith('/auth/mfa/verify')) {
      usedRecovery = (body.proof as { method: string }).method === 'recovery_code'
      verified = true
      return Response.json({ outcome: 'verified', requiredProofs: [] })
    }
    if (path.endsWith('/auth/mfa/complete')) {
      expect(enrollment ? codesSaved : true).toBe(true)
      expect(headers.get('x-mfa-continuation')).toBe(continuation)
      const retained = await readBrowserAuthAttempt(browser.source!, context())
      expect(retained?.record.state).toBe('issuing')
      operationId = String(body.operationId)
      phase = 'pending'
      if (loseCredentialResponse) throw new TypeError('fake-lost-credential-response')
      return Response.json(
        {
          user,
          accessToken,
          publication: {
            continuation,
            operationId,
            receipt,
            familyId: 'family-A',
            securityVersion: 1,
            browser: { contextId: 'context-A', generation, audience: 'product' },
          },
        },
        { headers: { 'set-cookie': `refresh_token=${'1'.repeat(64)}; Path=/; HttpOnly` } }
      )
    }
    if (
      path.endsWith('/publication/acknowledge') ||
      path.endsWith('/browser-publications/invitation-confirm')
    ) {
      if (invited && !path.endsWith('/invitation-confirm'))
        return Response.json({ errorCode: 'AUTH_CONTEXT_CHANGED' }, { status: 409 })
      if (invited) expect(body.handoff).toEqual(invited)
      const retained = await readBrowserAuthAttempt(browser.source!, context())
      if (!retained || !('vaultId' in retained.record))
        throw new Error('Expected durable staged journal')
      const entry = await context().store.get(retained.record.vaultId)
      expect(entry?.refreshToken).toBe('1'.repeat(64))
      expect(entry?.browser?.generation).toBe(generation)
      expect(body.receipt).toBe(receipt)
      expect(body.operationId).toBe(operationId)
      acknowledgements += 1
      phase = 'published'
      if (loseAckResponse && acknowledgements === 1)
        throw new TypeError('fake-lost-published-acknowledgement-response')
      return Response.json({ outcome: 'published' })
    }
    if (path.endsWith('/publication/retire')) {
      retirements += 1
      if (phase !== 'published') phase = 'retired'
      return Response.json({ state: phase, familyId: 'family-A' })
    }
    if (path.endsWith('/publication/status'))
      return Response.json({ state: phase === 'empty' ? 'changed' : phase, familyId: 'family-A' })
    if (path.endsWith('/browser-publications/probe'))
      return phase === 'published' &&
        body.familyId === 'family-A' &&
        headers.get(BROWSER_AUTH_HEADERS.generation) === String(generation)
        ? Response.json({
            status: 'current',
            userId: user.id,
            contextId: 'context-A',
            generation,
            audience: 'product',
            familyId: 'family-A',
            securityVersion: 1,
          })
        : Response.json({ errorCode: 'AUTH_CONTEXT_CHANGED' }, { status: 401 })
    if (path.endsWith('/auth/refresh')) {
      refreshes += 1
      throw new Error('Obsolete browser must never refresh')
    }
    if (path.endsWith('/auth/logout')) {
      if (headers.get(BROWSER_AUTH_HEADERS.generation) !== String(generation))
        return Response.json({ errorCode: 'SESSION_CHANGED' }, { status: 409 })
      logouts += 1
      generation += 1
      phase = 'retired'
      return new Response(null, { status: 204 })
    }
    if (path.endsWith('/auth/me')) {
      dataRequests += 1
      return Response.json({ user })
    }
    throw new Error('Unexpected credential route')
  })
  vi.stubGlobal('fetch', send)
  return {
    send,
    requirePassword: () => {
      needsPassword = true
    },
    obsolete: () => {
      generation += 1
    },
    counts: () => ({ dataRequests, acknowledgements, retirements, refreshes }),
    logoutCalls: () => logouts,
  }
}
async function signIn() {
  const bootstrap = await handleBrowserBootstrap(
    request('/api/auth/browser-context', {}),
    context()
  )
  expect(bootstrap.cookies.get('amcore_session')).toBeUndefined()
  acceptCookies(bootstrap)
  const body = (await bootstrap.json()) as { attemptId: string }
  const input = request('/api/auth/login', { email: user.email, password: '<fake-password>' })
  input.headers.set('x-amcore-login-attempt', body.attemptId)
  return handleCredentialAuth(input, {
    context: context(),
    schema: loginSchema,
    backendPath: '/auth/login',
    successStatus: 200,
  })
}

describe('Browser password/MFA publication with actual Redis', () => {
  it('retains a redeemed server ticket successor before opening a new app and never publishes it as a session', async () => {
    const backend = upstream(true, false, false, undefined, 'recovery_ticket')
    const started = await signIn(),
      input = (await started.json()) as { flowBinding: string }
    expect(
      await (await inspectPendingMfa(request('/api/auth/mfa'), context())).json()
    ).toMatchObject({ kind: 'recovery_ticket' })
    const execute = (ticket: string) =>
      commandPendingMfa(
        request('/api/auth/mfa', {
          action: 'redeem_recovery_ticket',
          operationId: randomUUID(),
          flowBinding: input.flowBinding,
          password: '<fake-local-password>',
          ticket,
        }),
        context()
      )
    const rejected = await execute('w'.repeat(43))
    expect(rejected.status).toBe(422)
    expect(await rejected.json()).toMatchObject({ errorCode: 'MFA_RECOVERY_TICKET_INVALID' })
    const redeemed = await execute('r'.repeat(43)),
      view = await redeemed.json()
    expect(view).toMatchObject({
      view: { kind: 'flow', state: 'enrollment_required', flowBinding: input.flowBinding },
    })
    expect(JSON.stringify(view)).not.toContain('continuation')
    expect(redeemed.cookies.get('amcore_session')).toBeUndefined()
    expect(backend.counts().acknowledgements).toBe(0)
    const seed = await commandPendingMfa(
      request('/api/auth/mfa', {
        action: 'start_enrollment',
        operationId: randomUUID(),
        flowBinding: input.flowBinding,
      }),
      context()
    )
    expect(await seed.json()).toHaveProperty('enrollment.secret', '<fake-unbound-seed>')
    expect(browser.cookies.amcore_session).toBeUndefined()
  })
  it.each([false, true])(
    'retains the setup successor before showing codes and recovers a lost browser reply=%s',
    async (lostReply) => {
      const backend = upstream(true, false, false, undefined, true)
      const started = await signIn()
      expect(started.status).toBe(202)
      const start = (await started.json()) as { flowBinding: string }
      let lastCommandId = ''
      const execute = (action: string, extra = {}) => {
        lastCommandId = randomUUID()
        return commandPendingMfa(
          request('/api/auth/mfa', {
            action,
            operationId: lastCommandId,
            flowBinding: start.flowBinding,
            ...extra,
          }),
          context()
        )
      }
      const before = await readBrowserAuthAttempt(request('/').headers, context())
      const seed = await execute('start_enrollment')
      expect(await seed.json()).toMatchObject({
        view: { state: 'enrollment_required' },
        enrollment: { secret: '<fake-unbound-seed>' },
      })
      const bound = await execute('verify', { proof: { method: 'totp', code: '123456' } })
      const binding = (await bound.json()) as {
        view: { flowBinding: string }
        backupCodes: { codes: string[]; generation: number }
      }
      const retained = await readBrowserAuthAttempt(request('/').headers, context())
      expect(retained?.record.browser.generation).toBe(before!.record.browser.generation + 1)
      expect('flow' in retained!.record && retained!.record.flow.continuation).not.toBe(
        'flow' in before!.record && before!.record.flow.continuation
      )
      expect(binding.view.flowBinding).toBe(start.flowBinding)
      expect(JSON.stringify(binding)).not.toContain('continuation')
      expect(bound.cookies.get('amcore_session')).toBeUndefined()
      expect(backend.counts().acknowledgements).toBe(0)
      const redis = await getWebRedisClient()
      const durable = (
        await Promise.all((await redis.keys('*')).map((key) => redis.get(key)))
      ).join('')
      for (const code of binding.backupCodes.codes) expect(durable).not.toContain(code)
      const inspected = await inspectPendingMfa(request('/api/auth/mfa'), context())
      const safe = await inspected.json()
      expect(safe).toMatchObject({ kind: 'flow', state: 'codes_pending' })
      expect(safe).not.toHaveProperty('backupCodes')
      let generation = binding.backupCodes.generation
      if (lostReply) {
        const regenerated = await execute('recover_codes', {
          proof: { method: 'totp', code: '654321' },
        })
        generation = (await regenerated.json()).backupCodes.generation
      }
      const completed = await execute('acknowledge_codes', { generation })
      expect(await completed.json()).toMatchObject({ view: { state: 'completed' } })
      const recovered = await inspectPendingMfa(
        request(`/api/auth/mfa?operationId=${lastCommandId}`),
        context()
      )
      expect(recovered.cookies.get('amcore_session')?.value).toBe(
        completed.cookies.get('amcore_session')?.value
      )
      acceptCookies(completed)
      expect(browser.cookies.amcore_session).toBeDefined()
      expect(backend.counts().acknowledgements).toBe(1)
      const response = await proxyToBackend(request('/api/auth/me'), ['auth', 'me'], [], context())
      expect(response.status).toBe(200)
    }
  )
  it('preserves confirmed creation when real Redis refuses publication after account commit', async () => {
    const redis = await getWebRedisClient()
    const backend = upstream(false, false, false, async () => {
      const used = Number(/used_memory:(\d+)/.exec(await redis.info('memory'))![1])
      await redis.configSet('maxmemory-policy', 'noeviction')
      await redis.configSet('maxmemory', String(used))
    })
    const bootstrap = await handleBrowserBootstrap(
      request('/api/auth/browser-context', {}),
      context()
    )
    const ready = (await bootstrap.json()) as { attemptId: string }
    acceptCookies(bootstrap)
    const input = request('/api/auth/register', {
      email: user.email,
      password: '<fake-register-password-Long123!>',
    })
    input.headers.set('x-amcore-login-attempt', ready.attemptId)
    try {
      const response = await handleCredentialAuth(input, {
        context: context(),
        schema: registerSchema,
        registration: true,
        backendPath: '/auth/register',
        successStatus: 201,
      })
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ errorCode: 'REGISTRATION_SIGN_IN_REQUIRED' })
      expect(response.cookies.get('amcore_session')).toBeUndefined()
      expect(backend.counts().acknowledgements).toBe(0)
    } finally {
      await redis.configSet('maxmemory', '0')
    }
  })
  it.each([false, true])(
    'registration retains authority before creation and preserves created evidence after publication loss=%s',
    async (lostAck) => {
      const backend = upstream(false, false, lostAck)
      const selected = context(),
        now = Date.now()
      const ownerProof = randomBytes(32).toString('base64url'),
        ownerHash = invitationOwnerHash(ownerProof)
      browser.cookies[invitationCookiePolicy(selected.origin).name] = ownerProof
      const admitted = admitInvitationFlow(
        newInvitationOwner(selected.origin, null, now),
        {
          credential: 'c'.repeat(43),
          expiresAt: new Date(now + 900000).toISOString(),
          intent: { expectedInviteId: 'prior-invite', expectedGeneration: 1 },
        },
        'en',
        null,
        now
      )
      await invitationOwnerStore.create(ownerHash, admitted.owner, selected)
      const bootstrap = await handleBrowserBootstrap(
        request('/api/auth/browser-context', {}),
        context()
      )
      const ready = (await bootstrap.json()) as { attemptId: string }
      acceptCookies(bootstrap)
      const input = request('/api/auth/register', {
        email: user.email,
        password: '<fake-register-password-Long123!>',
      })
      input.headers.set('x-amcore-login-attempt', ready.attemptId)
      const response = await handleCredentialAuth(input, {
        context: context(),
        schema: registerSchema,
        registration: true,
        backendPath: '/auth/register',
        successStatus: 201,
      })
      expect(response.status).toBe(lostAck ? 503 : 201)
      const body = await response.json()
      expect(lostAck ? body.errorCode : body.user.id).toBe(
        lostAck ? 'REGISTRATION_SIGN_IN_REQUIRED' : user.id
      )
      expect(Boolean(response.cookies.get('amcore_session'))).toBe(!lostAck)
      const owner = await invitationOwnerStore.get(ownerHash, selected.origin, selected)
      expect(owner?.flows[0]?.state).toBe(lostAck ? 'active' : 'retired')
      expect(
        backend.send.mock.calls.filter(([url]) =>
          new URL(String(url)).pathname.endsWith('/auth/register')
        )
      ).toHaveLength(1)
      expect(
        backend.send.mock.calls.filter(([url]) =>
          new URL(String(url)).pathname.endsWith('/auth/mfa/complete')
        )
      ).toHaveLength(0)
      expect(JSON.stringify(body)).not.toContain('continuation')
    }
  )
  it('confirms primary browser logout and deletes only its own vault without clearing a newer cookie', async () => {
    const backend = upstream()
    const completed = await signIn()
    const result = (await completed.json()) as { contextSession: string }
    acceptCookies(completed)
    const oldId = browser.cookies.amcore_session!
    const input = request('/api/auth/logout', {})
    input.headers.set('x-amcore-context-session', result.contextSession)
    const response = await handleLogout(input, context())
    expect(response.status).toBe(200)
    expect(backend.logoutCalls()).toBe(1)
    expect(await context().store.get(oldId)).toBeNull()
    expect(response.cookies.get('amcore_session')).toBeUndefined()
    expect(response.cookies.get('amcore_browser_context')).toBeUndefined()
  })
  it('cannot use an old page logout intent to revoke a later winning cookie', async () => {
    const backend = upstream()
    const first = await signIn()
    const original = (await first.json()) as { contextSession: string }
    acceptCookies(first)
    const second = await signIn()
    acceptCookies(second)
    const winner = browser.cookies.amcore_session!
    const input = request('/api/auth/logout', {})
    input.headers.set('x-amcore-context-session', original.contextSession)
    const response = await handleLogout(input, context())
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(backend.logoutCalls()).toBe(0)
    expect(await context().store.get(winner)).not.toBeNull()
  })
  it.each([
    [false, false, false, false],
    [true, false, false, false],
    [false, true, false, false],
    [true, true, false, false],
    [false, false, true, false],
    [true, false, true, false],
    [false, false, false, true],
    [false, true, false, true],
  ])(
    'invitation uses real owner/vault journals and combined confirmation (protected=%s, lostAck=%s, oauth=%s, register=%s)',
    async (protectedAccount, lostAck, oauth, registration) => {
      const backend = upstream(protectedAccount, false, lostAck)
      const selected = context(),
        now = Date.now()
      const proof = randomBytes(32).toString('base64url')
      browser.cookies[invitationCookiePolicy(selected.origin).name] = proof
      const ownerHash = invitationOwnerHash(proof)
      const admitted = admitInvitationFlow(
        newInvitationOwner(selected.origin, null, now),
        {
          credential: 'c'.repeat(43),
          expiresAt: new Date(now + 900000).toISOString(),
          intent: { expectedInviteId: 'invite-A', expectedGeneration: 1 },
        },
        'en',
        null,
        now
      )
      await invitationOwnerStore.create(ownerHash, admitted.owner, selected)
      let response: Response
      if (oauth) {
        const reservationInput = request(
          `/api/invitation-flows/${admitted.flow.binding.flowId}/oauth/google`,
          { binding: admitted.flow.binding }
        )
        const reserved = await invitationOAuthReservation(
          reservationInput,
          admitted.flow.binding.flowId,
          'google',
          productContextDeps(reservationInput.headers)
        )
        expect(reserved.status).toBe(200)
        const reservation = (await reserved.json()) as { authorizeHref: string }
        const authorize = await proxyOAuthAuthorize(
          request(reservation.authorizeHref),
          'google',
          context()
        )
        expect(authorize.status).toBe(302)
        acceptCookies(new NextResponse(null, { headers: authorize.headers }))
        response = await handleBrowserOAuth(
          request('/api/auth/oauth/complete', {}),
          context(),
          't'.repeat(43),
          '2'.repeat(64)
        )
      } else {
        const bootstrap = await handleBrowserBootstrap(
          request('/api/auth/browser-context', {}),
          context()
        )
        const ready = (await bootstrap.json()) as { attemptId: string }
        acceptCookies(bootstrap)
        const kind = registration ? 'register' : 'login'
        const input = request(`/api/invitation-flows/${admitted.flow.binding.flowId}/${kind}`, {
          binding: admitted.flow.binding,
          ...(registration ? {} : { email: user.email }),
          password: '<fake-password-Long123!>',
        })
        input.headers.set('x-amcore-login-attempt', ready.attemptId)
        response = await invitationCredentialHandler(
          input,
          admitted.flow.binding.flowId,
          kind,
          productContextDeps(input.headers)
        )
      }
      expect(response.status).toBe(
        protectedAccount ? 202 : lostAck ? 503 : registration ? 201 : 200
      )
      const result = await response.json()
      let completed = new NextResponse(null, { status: response.status, headers: response.headers })
      if (protectedAccount) {
        expect(result).toMatchObject({ kind: 'mfa', flowBinding: expect.any(String) })
        expect(backend.counts().acknowledgements).toBe(0)
        if (oauth) {
          const primary = await commandPendingMfa(
            request('/api/auth/mfa', {
              action: 'confirm_password',
              flowBinding: result.flowBinding,
              operationId: randomUUID(),
              password: '<fake-local-password>',
            }),
            context()
          )
          expect(primary.status).toBe(200)
        }
        const proof = await commandPendingMfa(
          request('/api/auth/mfa', {
            action: 'verify',
            flowBinding: result.flowBinding,
            operationId: randomUUID(),
            proof: { method: 'totp', code: '123456' },
          }),
          context()
        )
        expect(proof.status).toBe(200)
        const completionInput = request('/api/auth/mfa', {
          action: 'complete_login',
          flowBinding: result.flowBinding,
          operationId: randomUUID(),
        })
        const completionResponse = await productWebRoute(completionInput, 'site-auth', (selected) =>
          commandPendingMfa(completionInput, selected)
        )
        completed = new NextResponse(completionResponse.body, {
          status: completionResponse.status,
          headers: completionResponse.headers,
        })
        if (!lostAck)
          expect(await completed.json()).toMatchObject({
            view: { state: 'completed', invitationFlowId: admitted.flow.binding.flowId },
          })
      }
      if (lostAck) {
        expect(registration ? result.errorCode : undefined).toBe(
          registration ? 'REGISTRATION_SIGN_IN_REQUIRED' : undefined
        )
        expect(completed.status).toBe(503)
        expect(completed.cookies.get('amcore_session')).toBeUndefined()
        const retained = await readBrowserAuthAttempt(request('/').headers, context())
        expect(retained?.record.state).toBe('staged')
        const ownerCookie = invitationCookiePolicy(selected.origin).name
        const actualOwner = browser.cookies[ownerCookie]!
        browser.cookies[ownerCookie] = randomBytes(32).toString('base64url')
        await expect(inspectPendingMfa(request('/api/auth/mfa'), context())).rejects.toMatchObject({
          errorCode: 'INVITE_FLOW_CHANGED',
        })
        expect(backend.counts().acknowledgements).toBe(1)
        browser.cookies[ownerCookie] = actualOwner
        completed = protectedAccount
          ? await commandPendingMfa(
              request('/api/auth/mfa', {
                action: 'complete_login',
                flowBinding: retained!.record.id,
                operationId: randomUUID(),
              }),
              context()
            )
          : await inspectPendingMfa(request('/api/auth/mfa'), context())
        expect(completed.status).toBe(200)
        expect(
          backend.send.mock.calls.filter(([url]) =>
            new URL(String(url)).pathname.endsWith('/auth/mfa/complete')
          )
        ).toHaveLength(registration ? 0 : 1)
      }
      acceptCookies(completed)
      expect(browser.cookies.amcore_session).toBeDefined()
      const owner = await invitationOwnerStore.get(ownerHash, selected.origin, selected)
      expect(owner?.flows[0]).toMatchObject({
        state: 'active',
        handoff: { confirmed: true, publication: { familyId: 'family-A' } },
      })
      const flow = owner!.flows[0]!
      const ackInput = request(
        `/api/invitation-flows/${flow.binding.flowId}/auth-handoffs/${flow.handoff!.attemptId}/ack`,
        { binding: flow.binding }
      )
      const ack = await invitationAckHandler(
        ackInput,
        flow.binding.flowId,
        flow.handoff!.attemptId,
        productContextDeps(ackInput.headers)
      )
      expect(ack.status).toBe(200)
      expect(backend.counts().acknowledgements).toBe(2)
      expect(
        backend.send.mock.calls.some(
          ([url]) =>
            new URL(String(url)).pathname.includes('/auth/invites/auth-handoffs/') &&
            new URL(String(url)).pathname.endsWith('/confirm')
        )
      ).toBe(false)
    }
  )

  it('recovers only the same published OAuth cookie after response loss without another exchange or acknowledgement', async () => {
    const backend = upstream()
    acceptCookies(await handleBrowserBootstrap(request('/api/auth/browser-context', {}), context()))
    const ticket = 't'.repeat(43)
    const lost = await handleBrowserOAuth(
      request('/api/auth/oauth/complete', {}),
      context(),
      ticket,
      '2'.repeat(64)
    )
    const publishedId = lost.cookies.get('amcore_session')!.value
    // The completion response never reaches the session cookie, and the transient callback binding is absent.
    delete browser.cookies.refresh_token
    const before = backend.send.mock.calls.filter(([url]) =>
      new URL(String(url)).pathname.endsWith('/auth/oauth/exchange')
    ).length
    const recovered = await handleOAuthExchange(
      request('/api/auth/oauth/complete', {}),
      { ticket, locale: 'en' },
      context()
    )
    expect(recovered.status).toBe(303)
    expect(recovered.cookies.get('amcore_session')?.value).toBe(publishedId)
    const wrong = await handleOAuthExchange(
      request('/api/auth/oauth/complete', {}),
      { ticket: 'u'.repeat(43), locale: 'en' },
      context()
    )
    expect(wrong.cookies.get('amcore_session')).toBeUndefined()
    expect(
      backend.send.mock.calls.filter(([url]) =>
        new URL(String(url)).pathname.endsWith('/auth/oauth/exchange')
      )
    ).toHaveLength(before)
    expect(backend.counts().acknowledgements).toBe(1)
  })

  it('OAuth initiation retains neutral Redis intent and round-trips the anchor before exchange', async () => {
    const backend = upstream()
    const response = await proxyOAuthAuthorize(
      request('/api/auth/oauth/google'),
      'google',
      context()
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://provider.example.test/authorize')
    acceptCookies(new NextResponse(null, { headers: response.headers }))
    expect(browser.cookies.amcore_browser_context).toBeDefined()
    expect(browser.cookies.amcore_auth_pending).toBeDefined()
    expect(browser.cookies.amcore_session).toBeUndefined()
    const retained = await readBrowserAuthAttempt(request('/').headers, context())
    expect(retained?.record.state).toBe('ready')
    const authorize = backend.send.mock.calls.find(([url]) =>
      new URL(String(url)).pathname.endsWith('/auth/oauth/google')
    )!
    expect(new Headers(authorize[1]?.headers).get('x-amcore-oauth-attempt')).toBe(
      retained?.record.id
    )
    expect(backend.counts().acknowledgements).toBe(0)
  })

  it.each([false, true])(
    'OAuth retains the same publication boundary (protected=%s)',
    async (protectedAccount) => {
      const backend = upstream(protectedAccount)
      const bootstrap = await handleBrowserBootstrap(
        request('/api/auth/browser-context', {}),
        context()
      )
      acceptCookies(bootstrap)
      const response = await handleBrowserOAuth(
        request('/api/auth/oauth/complete', {}),
        context(),
        '<fake-ticket>',
        '2'.repeat(64)
      )
      expect(response.status).toBe(protectedAccount ? 202 : 200)
      if (protectedAccount) {
        const result = await response.json()
        expect(result).toMatchObject({ kind: 'mfa', flowBinding: expect.any(String) })
        expect(browser.cookies.amcore_session).toBeUndefined()
        expect(backend.counts().acknowledgements).toBe(0)
        const view = await inspectPendingMfa(request('/api/auth/mfa'), context())
        expect(await view.json()).toMatchObject({
          state: 'password_required',
          requiredProofs: ['password', 'second_factor'],
        })
      } else {
        acceptCookies(response)
        expect(browser.cookies.amcore_session).toBeDefined()
        expect(backend.counts().acknowledgements).toBe(1)
        expect(
          (await proxyToBackend(request('/api/auth/me'), ['auth', 'me'], [], context())).status
        ).toBe(200)
      }
    }
  )

  it('confirms only the selected pending password and still requires the second factor', async () => {
    const backend = upstream(true)
    const { flowBinding } = (await (await signIn()).json()) as { flowBinding: string }
    backend.requirePassword()
    const command = (password: string) =>
      commandPendingMfa(
        request('/api/auth/mfa', {
          action: 'confirm_password',
          flowBinding,
          operationId: randomUUID(),
          password,
        }),
        context()
      )
    const wrong = await command('<fake-wrong-password>')
    expect(wrong.status).toBe(422)
    expect(await wrong.json()).toMatchObject({ errorCode: 'INVALID_CREDENTIALS' })
    const setup = await command('<fake-no-local-password>')
    expect(await setup.json()).toEqual({
      view: { kind: 'password_setup_required', accountLabel: expect.any(String), flowBinding },
    })
    const verified = await command('<fake-local-password>')
    expect(await verified.json()).toMatchObject({
      view: { state: 'verify_required', requiredProofs: ['second_factor'], flowBinding },
    })
    expect(verified.headers.get('set-cookie')).toBeNull()
    expect(browser.cookies.amcore_session).toBeUndefined()
    const record = await readBrowserAuthAttempt(browser.source!, context())
    expect(record?.record.state).toBe('flow')
    expect(JSON.stringify(record?.record)).not.toContain('<fake-local-password>')
    expect(backend.counts().acknowledgements).toBe(0)
  })

  it('cancels only the observed pending MFA generation and preserves the stable anchor', async () => {
    const backend = upstream(true)
    const pending = (await (await signIn()).json()) as { flowBinding: string }
    const response = await commandPendingMfa(
      request('/api/auth/mfa', {
        action: 'cancel',
        flowBinding: pending.flowBinding,
        operationId: randomUUID(),
      }),
      context()
    )
    expect(await response.json()).toMatchObject({
      view: { state: 'cancelled', flowBinding: pending.flowBinding },
    })
    expect(backend.logoutCalls()).toBe(1)
    expect(response.cookies.get('amcore_auth_pending')).toBeUndefined()
    expect(response.cookies.get('amcore_browser_context')).toBeUndefined()
  })
  it('refuses a stale MFA page intent after a newer pending cookie wins, before any proof/status call', async () => {
    const backend = upstream(true)
    const first = (await (await signIn()).json()) as { flowBinding: string }
    await commandPendingMfa(
      request('/api/auth/mfa', {
        action: 'cancel',
        flowBinding: first.flowBinding,
        operationId: randomUUID(),
      }),
      context()
    )
    const second = (await (await signIn()).json()) as { flowBinding: string }
    expect(second.flowBinding).not.toBe(first.flowBinding)
    const calls = backend.send.mock.calls.length
    await expect(
      commandPendingMfa(
        request('/api/auth/mfa', {
          action: 'verify',
          flowBinding: first.flowBinding,
          operationId: randomUUID(),
          proof: { method: 'totp', code: '123456' },
        }),
        context()
      )
    ).rejects.toMatchObject({ status: 401, errorCode: 'AUTH_CONTEXT_CHANGED' })
    const stale = request('/api/auth/mfa')
    stale.headers.set('x-amcore-mfa-flow', first.flowBinding)
    await expect(inspectPendingMfa(stale, context())).rejects.toMatchObject({
      status: 401,
      errorCode: 'AUTH_CONTEXT_CHANGED',
    })
    expect(backend.send).toHaveBeenCalledTimes(calls)
  })
  it('stores vault and journal before acknowledgement, then admits a protected request; stale cookie never refreshes', async () => {
    const backend = upstream()
    const completed = await signIn()
    expect(completed.status).toBe(200)
    expect(await completed.json()).toMatchObject({ user, contextSession: expect.any(String) })
    expect(completed.cookies.get('amcore_browser_context')).toBeUndefined()
    acceptCookies(completed)
    const protectedRequest = await proxyToBackend(
      request('/api/auth/me'),
      ['auth', 'me'],
      [],
      context()
    )
    expect(protectedRequest.status).toBe(200)
    expect(await protectedRequest.json()).toEqual({ user })
    backend.obsolete()
    const stale = await proxyToBackend(request('/api/auth/me'), ['auth', 'me'], [], context())
    expect(stale.status).toBe(401)
    expect((await stale.json()).errorCode).toBe('AUTH_CONTEXT_CHANGED')
    expect(backend.counts()).toEqual({
      dataRequests: 1,
      acknowledgements: 1,
      retirements: 0,
      refreshes: 0,
    })
  })

  it('recovers only the same completed cookie after final-response loss using status/probe, with no new acknowledgement', async () => {
    const backend = upstream()
    const completed = await signIn()
    const original = completed.cookies.get('amcore_session')!.value
    const recovered = await inspectPendingMfa(request('/api/auth/mfa'), context())
    expect(recovered.cookies.get('amcore_session')?.value).toBe(original)
    expect(await recovered.json()).toMatchObject({ kind: 'flow', state: 'completed' })
    expect(backend.counts().acknowledgements).toBe(1)
    browser.cookies.amcore_browser_context = randomBytes(32).toString('base64url')
    await expect(inspectPendingMfa(request('/api/auth/mfa'), context())).rejects.toMatchObject({
      status: 401,
      errorCode: 'AUTH_CONTEXT_CHANGED',
    })
  })

  it('retains exact parent/operation before credential-response loss and compensates without publishing a cookie', async () => {
    const backend = upstream(false, true)
    expect((await signIn()).status).toBe(503)
    expect(browser.cookies.amcore_session).toBeUndefined()
    const record = await readBrowserAuthAttempt(request('/').headers, context())
    expect(record?.record.state).toBe('cleanup_needed')
    expect(backend.counts()).toEqual({
      dataRequests: 0,
      acknowledgements: 0,
      retirements: 1,
      refreshes: 0,
    })
    expect(
      await (await inspectPendingMfa(request('/api/auth/mfa'), context())).json()
    ).toMatchObject({ state: 'restart_required' })
  })

  it.each(['totp', 'recovery_code'] as const)(
    'keeps %s pending login credential-free until the existing UI command completes publication',
    async (method) => {
      upstream(true)
      const pending = await signIn()
      expect(pending.status).toBe(202)
      const { flowBinding } = (await pending.json()) as { kind: 'mfa'; flowBinding: string }
      expect(flowBinding).toEqual(expect.any(String))
      expect(pending.cookies.getAll()).toHaveLength(0)
      const inspect = await inspectPendingMfa(request('/api/auth/mfa'), context())
      expect(await inspect.json()).toMatchObject({ kind: 'flow', state: 'verify_required' })
      const verified = await commandPendingMfa(
        request('/api/auth/mfa', {
          action: 'verify',
          flowBinding,
          operationId: randomUUID(),
          proof: { method, code: method === 'totp' ? '123456' : 'A'.repeat(32) },
        }),
        context()
      )
      expect(await verified.json()).toMatchObject({ view: { state: 'ready' } })
      const completed = await commandPendingMfa(
        request('/api/auth/mfa', {
          action: 'complete_login',
          flowBinding,
          operationId: randomUUID(),
        }),
        context()
      )
      expect(await completed.json()).toMatchObject({
        view: {
          kind: 'flow',
          state: 'completed',
          requiredProofs: [],
          remainingCodes: method === 'recovery_code' ? 0 : 1,
        },
      })
      expect(completed.cookies.get('amcore_session')).toBeDefined()
    }
  )
})

describe('source-session reauthentication transport with real Redis', () => {
  it('binds the private continuation to the exact selected source and recovers completion without replaying a code', async () => {
    const continuation = randomBytes(32).toString('base64url')
    const source = {
      token: '<fake-original-token>',
      bindingHeaders: { 'x-browser-test': 'own' },
      sourceFingerprint: 'a'.repeat(64),
    }
    let verified = false,
      lost = true,
      writes = 0
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname
      const headers = new Headers(init.headers)
      if (path.endsWith('/session-flow')) {
        expect(headers.get('authorization')).toBe('Bearer <fake-original-token>')
        return Response.json({
          kind: 'mfa',
          continuation,
          purpose: 'reauthenticate',
          state: 'verify_required',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          requiredProofs: ['second_factor'],
          remainingCodes: 10,
          generation: 1,
          nextAction: 'verify',
          browser: null,
        })
      }
      expect(headers.get('authorization')).toBeNull()
      expect(headers.get('cookie')).toBeNull()
      expect(headers.get('x-mfa-continuation')).toBe(continuation)
      if (path.endsWith('/verify')) {
        verified = true
        writes++
        return Response.json({ outcome: 'verified', requiredProofs: [] })
      }
      expect(path).toMatch(/reauthenticate$/)
      if (lost) {
        lost = false
        throw new TypeError('lost completion response')
      }
      return Response.json({
        outcome: verified ? 'completed' : 'proof_required',
        requiredProofs: verified ? [] : ['second_factor'],
      })
    })
    vi.stubGlobal('fetch', fetch)
    const pending = await startSourceReauthentication(
      request('/api/console/auth/step-up', {}),
      source
    )
    expect(JSON.stringify(pending)).not.toContain(continuation)
    const command = {
      flowBinding: pending.flowBinding,
      operationId: randomUUID(),
      proof: { method: 'recovery_code' as const, code: 'f'.repeat(32) },
    }
    await expect(
      completeSourceReauthentication(
        request('/api/console/auth/step-up', {}),
        { ...source, sourceFingerprint: 'b'.repeat(64) },
        command
      )
    ).rejects.toMatchObject({ errorCode: 'AUTH_CONTEXT_CHANGED' })
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(
      completeSourceReauthentication(request('/api/console/auth/step-up', {}), source, command)
    ).rejects.toThrow('lost completion response')
    await expect(
      completeSourceReauthentication(request('/api/console/auth/step-up', {}), source, {
        flowBinding: pending.flowBinding,
        operationId: randomUUID(),
      })
    ).resolves.toBeUndefined()
    expect(writes).toBe(1)
    await expect(
      completeSourceReauthentication(request('/api/console/auth/step-up', {}), source, {
        flowBinding: pending.flowBinding,
        operationId: randomUUID(),
      })
    ).resolves.toBeUndefined()
    expect(writes).toBe(1)
  })
  it('preserves upstream start throttling without retaining a continuation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { errorCode: 'RATE_LIMIT_EXCEEDED' },
          { status: 429, headers: { 'retry-after': '90' } }
        )
      )
    )
    await expect(
      startSourceReauthentication(request('/api/console/auth/step-up', {}), {
        token: '<fake-original-token>',
        bindingHeaders: {},
        sourceFingerprint: 'a'.repeat(64),
      })
    ).rejects.toMatchObject({
      status: 429,
      errorCode: 'RATE_LIMIT_EXCEEDED',
      retryAfterSeconds: 90,
    })
    expect(await (await getWebRedisClient()).keys('web:mfa-source-operation:*')).toEqual([])
  })
})

describe('Signed-in settings keep the original published family', () => {
  it.each([false, true])('shows codes once; handles lost response=%s', async (loseReply) => {
    const backend = upstream()
    acceptCookies(await signIn())
    const originalCookie = browser.cookies.amcore_session!
    let generation = 1,
      acknowledged = true
    const operations = new Set<string>()
    const continuation = randomBytes(32).toString('base64url')
    const status = () => ({
      kind: 'mfa',
      purpose: 'rotate_codes',
      state: acknowledged ? 'ready' : 'codes_pending',
      expiresAt: new Date(Date.now() + 240000).toISOString(),
      requiredProofs: [],
      remainingCodes: 10,
      generation,
    })
    const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (path.endsWith('/mfa/settings'))
        return Response.json({
          kind: 'settings',
          accountLabel: user.email,
          protected: true,
          eligible: true,
          remainingCodes: 10,
        })
      if (path.endsWith('/mfa/settings-start')) {
        expect(new Headers(init?.headers).get('authorization')).toBeTruthy()
        return Response.json({
          ...status(),
          continuation,
          nextAction: 'complete',
          browser: { contextId: 'context-A', generation: 1 },
        })
      }
      if (path.endsWith('/mfa/status')) return Response.json(status())
      if (path.endsWith('/mfa/rotate-codes')) {
        expect(new Headers(init?.headers).get('authorization')).toBeNull()
        expect(new Headers(init?.headers).get('x-mfa-continuation')).toBe(continuation)
        if (operations.has(body.operationId))
          return Response.json({ outcome: 'already_generated', generation })
        operations.add(body.operationId)
        generation++
        acknowledged = false
        if (loseReply && generation === 2) throw new TypeError('lost one-time codes')
        return Response.json({
          outcome: 'codes',
          backupCodes: {
            codes: Array.from({ length: 10 }, (_, index) =>
              (generation * 100 + index).toString(16).padStart(32, '0')
            ),
            generation,
          },
        })
      }
      if (path.endsWith('/mfa/acknowledge-codes')) {
        expect(body.generation).toBe(generation)
        acknowledged = true
        return Response.json({ outcome: 'acknowledged', generation })
      }
      return backend.send(url, init)
    })
    vi.stubGlobal('fetch', send)
    expect(
      await (await inspectMfaSettings(request('/api/auth/mfa'), context())).json()
    ).toMatchObject({ kind: 'settings', accountLabel: user.email })
    const started = await commandPendingMfa(
      request('/api/auth/mfa', {
        action: 'start_code_rotation',
        operationId: randomUUID(),
      }),
      context()
    )
    acceptCookies(started)
    const result = await started.json()
    expect(result.view).toMatchObject({ purpose: 'rotate_codes', state: 'ready' })
    expect(JSON.stringify(result)).not.toContain(continuation)
    const flowBinding = result.view.flowBinding,
      operationId = randomUUID()
    const execute = (action: string, extra = {}) =>
      commandPendingMfa(
        request('/api/auth/mfa', {
          action,
          operationId,
          flowBinding,
          ...extra,
        }),
        context()
      )
    if (loseReply) {
      await expect(execute('rotate_codes')).rejects.toThrow()
      const state = await (await inspectPendingMfa(request('/api/auth/mfa'), context())).json()
      expect(state.state).toBe('codes_pending')
      expect(state).not.toHaveProperty('backupCodes')
      expect(await (await execute('rotate_codes')).json()).not.toHaveProperty('backupCodes')
    } else {
      const codes = await (await execute('rotate_codes')).json()
      expect(codes.backupCodes.codes).toHaveLength(10)
      const redis = await getWebRedisClient()
      const durable = JSON.stringify(
        await redis.mGet(await redis.keys('web:session:v1:auth-attempt:*'))
      )
      for (const code of codes.backupCodes.codes) expect(durable).not.toContain(code)
      expect((await (await execute('acknowledge_codes', { generation })).json()).view.state).toBe(
        'completed'
      )
    }
    expect(generation).toBe(2)
    expect(browser.cookies.amcore_session).toBe(originalCookie)
    expect(backend.logoutCalls()).toBe(0)
    const selected = context(),
      entry = await selected.store.get(originalCookie)
    const other = randomBytes(32).toString('base64url')
    await selected.store.create(other, entry!)
    browser.cookies.amcore_session = other
    await expect(execute('rotate_codes')).rejects.toMatchObject({
      errorCode: 'AUTH_CONTEXT_CHANGED',
    })
    expect(generation).toBe(2)
  })
})
