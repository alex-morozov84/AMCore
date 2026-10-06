import type { UserResponse } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ContextRequestError } from './context-errors'
import type { ContextExecutorDeps } from './context-executor'
import { freshContextSession } from './context-session'
import { invitationCookiePolicy } from './invitation-cookie'
import { admitInvitationFlow, newInvitationOwner } from './invitation-flow-authority'
import { invitationReadHandler } from './invitation-read-handler'
import { assertInvitationReadCurrent, captureInvitationRequest } from './invitation-request-snapshot'
import type * as InvitationUpstream from './invitation-upstream'
import { invitationBackend } from './invitation-upstream'

vi.mock('server-only', () => ({}))
vi.mock('./invitation-request-snapshot', () => ({ captureInvitationRequest: vi.fn(), assertInvitationReadCurrent: vi.fn() }))
vi.mock('./context-session', () => ({ freshContextSession: vi.fn() }))
vi.mock('./invitation-upstream', async importOriginal => ({
  ...await importOriginal<typeof InvitationUpstream>(), invitationBackend: vi.fn(),
}))
const request = () => new Request('https://app.example.test/api/invitation-flows/example/context')
function snapshot(): Awaited<ReturnType<typeof captureInvitationRequest>> {
  const now = Date.now()
  const admitted = admitInvitationFlow(newInvitationOwner('https://app.example.test', null, now), {
    credential: 'c'.repeat(43), expiresAt: new Date(now + 1800000).toISOString(),
    intent: { expectedInviteId: 'example-invitation', expectedGeneration: 1 },
  }, 'en', null, now)
  return { ...admitted, session: null, ownerHash: 'a'.repeat(64), policy: invitationCookiePolicy(request().url) }
}
const deps = {} as ContextExecutorDeps
beforeEach(() => vi.resetAllMocks())

describe('read-only recipient BFF state projection', () => {
  it('does not refresh, confirm or inspect a pending authentication', async () => {
    const current = snapshot()
    current.flow.state = 'authenticating'
    vi.mocked(captureInvitationRequest).mockResolvedValue(current)
    const response = await invitationReadHandler(request(), current.flow.binding.flowId, 'inspect', deps)
    expect(await response.json()).toEqual({ state: 'authenticating', binding: current.flow.binding })
    expect(freshContextSession).not.toHaveBeenCalled()
    expect(invitationBackend).not.toHaveBeenCalled()
  })

  it('shows only the safe ACK selector while sign-in is completing', async () => {
    const current = snapshot()
    current.flow.state = 'completing_signin'
    current.flow.handoff = { attemptId: 'b'.repeat(22), cleanupKey: 'c'.repeat(43),
      newSessionId: 'private-vault-id', backendSessionId: 'private-backend-id', deadline: Date.now() + 60000, confirmed: false }
    vi.mocked(captureInvitationRequest).mockResolvedValue(current)
    const response = await invitationReadHandler(request(), current.flow.binding.flowId, 'context', deps)
    expect(await response.json()).toEqual({ state: 'completing_signin', binding: current.flow.binding,
      handoff: { attemptId: 'b'.repeat(22) } })
    expect(invitationBackend).not.toHaveBeenCalled()
    expect(freshContextSession).not.toHaveBeenCalled()
  })

  it('reads neutral signup context through the server-only continuation and checks retirement before returning', async () => {
    const current = snapshot()
    vi.mocked(captureInvitationRequest).mockResolvedValue(current)
    const data = { email: 'invited@example.test', expiresAt: new Date(Date.now() + 60000).toISOString() }
    vi.mocked(invitationBackend).mockResolvedValue({ data, refreshToken: null })
    const response = await invitationReadHandler(request(), current.flow.binding.flowId, 'context', deps)
    expect(await response.json()).toEqual({ binding: current.flow.binding, data })
    expect(invitationBackend).toHaveBeenCalledWith('/auth/invites/continuations/context', expect.anything(),
      expect.objectContaining({ method: 'POST', credential: current.flow.credential }))
    expect(vi.mocked(invitationBackend).mock.calls[0]![2]).not.toHaveProperty('body')
    expect(assertInvitationReadCurrent).toHaveBeenCalledWith(current)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('requires the personal session before inspection and drops an old result after retirement', async () => {
    const current = snapshot()
    vi.mocked(captureInvitationRequest).mockResolvedValue(current)
    let response = await invitationReadHandler(request(), current.flow.binding.flowId, 'inspect', deps)
    expect(response.status).toBe(401)
    expect(invitationBackend).not.toHaveBeenCalled()
    const entry = { version: 1, accessToken: '<test-access>', refreshToken: '<test-refresh>',
      accessTokenExpiresAt: Date.now() + 900000, userSnapshot: { id: 'example-user' } as UserResponse }
    current.session = { sessionId: 's'.repeat(43), binding: 'a'.repeat(64), entry }
    vi.mocked(freshContextSession).mockResolvedValue(entry)
    vi.mocked(invitationBackend).mockResolvedValue({ data: { state: 'verify_email', email: 'invited@example.test' }, refreshToken: null })
    vi.mocked(assertInvitationReadCurrent).mockRejectedValue(new ContextRequestError(409, 'INVITE_FLOW_CHANGED'))
    response = await invitationReadHandler(request(), current.flow.binding.flowId, 'inspect', deps)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ errorCode: 'INVITE_FLOW_CHANGED' })
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
  })
})
