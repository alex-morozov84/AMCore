import { DEFAULT_LOCALE, type UserResponse } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContextExecutorDeps } from './context-executor'
import { invitationAckHandler } from './invitation-ack-handler'
import { publishInvitationAuth, reserveInvitationAuth } from './invitation-auth-transition'
import { invitationCookiePolicy } from './invitation-cookie'
import { admitInvitationFlow, newInvitationOwner, retireInvitationFlows } from './invitation-flow-authority'
import { invitationOwnerStore } from './invitation-owner-store'
import { captureInvitationRequest } from './invitation-request-snapshot'
import type * as InvitationUpstream from './invitation-upstream'
import { invitationBackend } from './invitation-upstream'

vi.mock('server-only', () => ({}))
vi.mock('./invitation-request-snapshot', () => ({ captureInvitationRequest: vi.fn() }))
vi.mock('./invitation-owner-store', () => ({ invitationOwnerStore: { get: vi.fn(), compareAndSet: vi.fn() } }))
vi.mock('./invitation-owner-lease', () => ({ withInvitationOwnerLease: vi.fn(async (_hash, _signal, work) => work()) }))
vi.mock('./invitation-upstream', async original => ({ ...await original<typeof InvitationUpstream>(), invitationBackend: vi.fn() }))
const deps = {} as ContextExecutorDeps
function fixture() {
  const now = Date.now()
  const admitted = admitInvitationFlow(newInvitationOwner('https://app.example.test', null, now), {
    credential: 'c'.repeat(43), expiresAt: new Date(now + 1800000).toISOString(),
    intent: { expectedInviteId: 'invitation-example', expectedGeneration: 1 },
  }, DEFAULT_LOCALE, null, now)
  const reserved = reserveInvitationAuth(admitted.owner, admitted.flow.binding, null, 'login', null, now)
  const owner = publishInvitationAuth(reserved.owner, admitted.flow.binding.flowId, reserved.attempt.id,
    reserved.attempt.fence, null, { binding: 'a'.repeat(64), vaultId: 's'.repeat(43), backendId: 'backend-example', deadline: now + 60000 }, now)
  const flow = owner.flows[0]!
  const user = { id: 'user-example', email: 'invited@example.test', name: 'Example', avatarUrl: null,
    phone: null, locale: DEFAULT_LOCALE, timezone: 'UTC', lastLoginAt: null, emailVerified: true, createdAt: new Date(now).toISOString() } as UserResponse
  const snapshot = { owner, flow, ownerHash: 'b'.repeat(64), policy: invitationCookiePolicy(owner.origin),
    session: { sessionId: 's'.repeat(43), binding: 'a'.repeat(64), entry: { version: 1, accessToken: '<test-access>',
      refreshToken: '<test-refresh>', accessTokenExpiresAt: now + 900000, userSnapshot: user } } }
  const request = () => new Request(`${owner.origin}/api/invitation-flows/${flow.binding.flowId}/auth-handoffs/${reserved.attempt.id}/ack`, {
    method: 'POST', headers: { origin: owner.origin }, body: JSON.stringify({ binding: flow.binding }),
  })
  return { snapshot, request, attemptId: reserved.attempt.id }
}
beforeEach(() => vi.resetAllMocks())
function prepare(current: ReturnType<typeof fixture>) {
  vi.mocked(captureInvitationRequest).mockResolvedValue(current.snapshot)
  vi.mocked(invitationOwnerStore.get).mockResolvedValue(current.snapshot.owner)
  vi.mocked(invitationOwnerStore.compareAndSet).mockResolvedValue(true)
  vi.mocked(invitationBackend).mockResolvedValue({ data: { status: 'confirmed' }, refreshToken: null })
}

describe('explicit invited sign-in acknowledgment', () => {
  it('confirms with the current issued token and secret proof, then publishes only safe browser data', async () => {
    const current = fixture(); prepare(current)
    const response = await invitationAckHandler(current.request(), current.snapshot.flow.binding.flowId, current.attemptId, deps)
    expect(response.status).toBe(200)
    expect(invitationBackend).toHaveBeenCalledWith(expect.stringContaining('/confirm'), expect.anything(),
      expect.objectContaining({ accessToken: '<test-access>', handoff: { attemptId: current.attemptId, cleanupKey: current.snapshot.flow.handoff!.cleanupKey } }))
    expect(vi.mocked(invitationBackend).mock.calls[0]![2]).not.toHaveProperty('body')
    expect(invitationOwnerStore.compareAndSet).toHaveBeenCalledWith(current.snapshot.ownerHash, current.snapshot.owner.version,
      expect.objectContaining({ flows: [expect.objectContaining({ state: 'active', handoff: expect.objectContaining({ confirmed: true }) })] }))
    const body = await response.json()
    expect(body).toEqual({ binding: current.snapshot.flow.binding, data: { user: current.snapshot.session.entry.userSnapshot }, handoff: { attemptId: current.attemptId } })
    expect(JSON.stringify(body)).not.toContain(current.snapshot.flow.handoff!.cleanupKey)
  })

  it('keeps the journal pending when API confirmation is unknown and permits an ACK-only retry', async () => {
    const current = fixture(); prepare(current)
    vi.mocked(invitationBackend).mockRejectedValueOnce(new Error('transport unavailable'))
    expect((await invitationAckHandler(current.request(), current.snapshot.flow.binding.flowId, current.attemptId, deps)).status).toBe(503)
    expect(invitationOwnerStore.compareAndSet).not.toHaveBeenCalled()
    expect((await invitationAckHandler(current.request(), current.snapshot.flow.binding.flowId, current.attemptId, deps)).status).toBe(200)
    expect(invitationBackend).toHaveBeenCalledTimes(2)
  })

  it('does not reactivate a flow retired by another account after API confirmation', async () => {
    const current = fixture(); prepare(current)
    vi.mocked(invitationOwnerStore.get).mockResolvedValue(retireInvitationFlows(current.snapshot.owner, 'd'.repeat(64)))
    expect((await invitationAckHandler(current.request(), current.snapshot.flow.binding.flowId, current.attemptId, deps)).status).toBe(409)
    expect(invitationOwnerStore.compareAndSet).not.toHaveBeenCalled()
  })

  it('rejects a different cookie or attempt before contacting the API', async () => {
    const current = fixture(); prepare(current)
    current.snapshot.session.sessionId = 'z'.repeat(43)
    expect((await invitationAckHandler(current.request(), current.snapshot.flow.binding.flowId, current.attemptId, deps)).status).toBe(409)
    expect(invitationBackend).not.toHaveBeenCalled()
  })

  it('retries confirmation after an owner CAS failure without aborting an already confirmed API session', async () => {
    const current = fixture(); prepare(current)
    vi.mocked(invitationOwnerStore.compareAndSet).mockResolvedValueOnce(false)
    expect((await invitationAckHandler(current.request(), current.snapshot.flow.binding.flowId, current.attemptId, deps)).status).toBe(409)
    expect((await invitationAckHandler(current.request(), current.snapshot.flow.binding.flowId, current.attemptId, deps)).status).toBe(200)
    expect(vi.mocked(invitationBackend).mock.calls.every(([path]) => path.endsWith('/confirm'))).toBe(true)
  })

  it('rejects a body selector belonging to another flow before any auth effect', async () => {
    const current = fixture(); prepare(current)
    const request = new Request(current.request().url, { method: 'POST', body: JSON.stringify({
      binding: { ...current.snapshot.flow.binding, flowId: 'x'.repeat(22) },
    }) })
    expect((await invitationAckHandler(request, current.snapshot.flow.binding.flowId, current.attemptId, deps)).status).toBe(409)
    expect(invitationBackend).not.toHaveBeenCalled()
  })

  it('replays an acknowledged handoff without changing the flow revision or creating a new session', async () => {
    const current = fixture()
    current.snapshot.flow.state = 'active'
    current.snapshot.flow.handoff!.confirmed = true
    prepare(current)
    const response = await invitationAckHandler(current.request(), current.snapshot.flow.binding.flowId, current.attemptId, deps)
    expect(response.status).toBe(200)
    expect((await response.json()).binding).toEqual(current.snapshot.flow.binding)
    expect(invitationOwnerStore.compareAndSet).not.toHaveBeenCalled()
    expect(invitationBackend).toHaveBeenCalledTimes(1)
  })
})
