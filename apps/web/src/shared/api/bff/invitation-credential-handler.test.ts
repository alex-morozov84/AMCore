import { DEFAULT_LOCALE, type UserResponse } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContextExecutorDeps } from './context-executor'
import { recoverFailedInvitationAuth } from './invitation-auth-failure'
import { publishInvitedCredentials } from './invitation-auth-publication'
import { invitationCookiePolicy } from './invitation-cookie'
import { invitationCredentialHandler } from './invitation-credential-handler'
import { admitInvitationFlow, newInvitationOwner } from './invitation-flow-authority'
import { invitationOwnerStore } from './invitation-owner-store'
import { captureInvitationRequest } from './invitation-request-snapshot'
import type * as InvitationUpstream from './invitation-upstream'
import { invitationBackend, InvitationBackendError } from './invitation-upstream'

vi.mock('server-only', () => ({}))
vi.mock('./invitation-request-snapshot', () => ({ captureInvitationRequest: vi.fn() }))
vi.mock('./invitation-owner-store', () => ({ invitationOwnerStore: { compareAndSet: vi.fn() } }))
vi.mock('./invitation-owner-lease', () => ({
  withInvitationOwnerLease: vi.fn(async (_hash, _signal, work) => work()),
}))
vi.mock('./invitation-auth-publication', () => ({ publishInvitedCredentials: vi.fn() }))
vi.mock('./invitation-auth-failure', () => ({ recoverFailedInvitationAuth: vi.fn() }))
vi.mock('./invitation-upstream', async (original) => ({
  ...(await original<typeof InvitationUpstream>()),
  invitationBackend: vi.fn(),
}))
const deps = { store: {} } as ContextExecutorDeps
function fixture() {
  const now = Date.now()
  const admitted = admitInvitationFlow(
    newInvitationOwner('https://app.example.test', null, now),
    {
      credential: 'c'.repeat(43),
      expiresAt: new Date(now + 1800000).toISOString(),
      intent: { expectedInviteId: 'invitation-example', expectedGeneration: 1 },
    },
    DEFAULT_LOCALE,
    null,
    now
  )
  const snapshot = {
    ...admitted,
    ownerHash: 'a'.repeat(64),
    session: null,
    policy: invitationCookiePolicy(admitted.owner.origin),
  }
  const user: UserResponse = {
    id: 'example-user',
    name: 'Example',
    email: 'invited@example.test',
    emailVerified: false,
    phone: null,
    avatarUrl: null,
    locale: DEFAULT_LOCALE,
    timezone: 'UTC',
    createdAt: new Date(now).toISOString(),
    lastLoginAt: null,
  }
  const request = (kind: 'login' | 'register') =>
    new Request(
      `${admitted.owner.origin}/api/invitation-flows/${admitted.flow.binding.flowId}/${kind}`,
      {
        method: 'POST',
        headers: { origin: admitted.owner.origin },
        body: JSON.stringify({
          binding: admitted.flow.binding,
          password: 'Test-password-123!',
          ...(kind === 'login'
            ? { email: user.email }
            : { name: user.name, locale: DEFAULT_LOCALE }),
        }),
      }
    )
  return { snapshot, user, request }
}
beforeEach(() => vi.resetAllMocks())
function prepare(current: ReturnType<typeof fixture>) {
  vi.mocked(captureInvitationRequest).mockResolvedValue(current.snapshot)
  vi.mocked(invitationOwnerStore.compareAndSet).mockResolvedValue(true)
  vi.mocked(invitationBackend).mockResolvedValue({
    data: { user: current.user, accessToken: '<test-access>' },
    refreshToken: '<test-refresh>',
  })
  vi.mocked(publishInvitedCredentials).mockResolvedValue({
    sessionId: 's'.repeat(43),
    binding: { ...current.snapshot.flow.binding, flowRevision: 3, sessionBinding: 'b'.repeat(64) },
    user: current.user,
    attemptId: 'i'.repeat(22),
  })
}
describe('dedicated invited credential commands', () => {
  it('reserves before login issuance and emits only the opaque session cookie and safe ACK projection', async () => {
    const current = fixture()
    prepare(current)
    const response = await invitationCredentialHandler(
      current.request('login'),
      current.snapshot.flow.binding.flowId,
      'login',
      deps
    )
    expect(response.status).toBe(200)
    expect(invitationOwnerStore.compareAndSet).toHaveBeenCalledWith(
      current.snapshot.ownerHash,
      1,
      expect.objectContaining({
        flows: [
          expect.objectContaining({
            state: 'authenticating',
            binding: expect.objectContaining({ flowRevision: 2 }),
          }),
        ],
      })
    )
    expect(invitationBackend).toHaveBeenCalledWith(
      '/auth/login',
      expect.anything(),
      expect.objectContaining({
        expectedStatus: 200,
        body: { email: current.user.email, password: 'Test-password-123!' },
        credential: 'c'.repeat(43),
        handoff: { attemptId: expect.any(String), cleanupKey: expect.any(String) },
      })
    )
    expect(response.headers.get('set-cookie')).toContain(`amcore_session=${'s'.repeat(43)}`)
    const body = await response.json()
    expect(body.handoff).toEqual({ attemptId: 'i'.repeat(22) })
    expect(JSON.stringify(body)).not.toContain('<test-access>')
    expect(JSON.stringify(body)).not.toContain('<test-refresh>')
    expect(recoverFailedInvitationAuth).not.toHaveBeenCalled()
  })
  it('registers without a client-selected email and preserves the created status', async () => {
    const current = fixture()
    prepare(current)
    const response = await invitationCredentialHandler(
      current.request('register'),
      current.snapshot.flow.binding.flowId,
      'register',
      deps
    )
    expect(response.status).toBe(201)
    expect(invitationBackend).toHaveBeenCalledWith(
      '/auth/invites/register',
      expect.anything(),
      expect.objectContaining({
        expectedStatus: 201,
        body: { name: 'Example', password: 'Test-password-123!', locale: DEFAULT_LOCALE },
      })
    )
  })
  it('does not issue authentication after a failed reservation CAS', async () => {
    const current = fixture()
    prepare(current)
    vi.mocked(invitationOwnerStore.compareAndSet).mockResolvedValue(false)
    expect(
      (
        await invitationCredentialHandler(
          current.request('login'),
          current.snapshot.flow.binding.flowId,
          'login',
          deps
        )
      ).status
    ).toBe(409)
    expect(invitationBackend).not.toHaveBeenCalled()
    expect(publishInvitedCredentials).not.toHaveBeenCalled()
  })
  it('recovers an unknown issuance independently and never sets a session cookie on an error', async () => {
    const current = fixture()
    prepare(current)
    vi.mocked(invitationBackend).mockRejectedValue(new InvitationBackendError(503, false))
    const response = await invitationCredentialHandler(
      current.request('login'),
      current.snapshot.flow.binding.flowId,
      'login',
      deps
    )
    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(recoverFailedInvitationAuth).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: current.snapshot, store: deps.store })
    )
    expect(publishInvitedCredentials).not.toHaveBeenCalled()
  })
})
