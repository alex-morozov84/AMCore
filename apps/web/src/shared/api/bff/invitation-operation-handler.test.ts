import type { UserResponse } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContextExecutorDeps } from './context-executor'
import { freshContextSession } from './context-session'
import { invitationOperationHandler } from './invitation-operation-handler'
import { invitationIncomingSession } from './invitation-request-snapshot'
import { invitationBackend } from './invitation-upstream'

vi.mock('server-only', () => ({}))
vi.mock('./context-session', () => ({ freshContextSession: vi.fn() }))
vi.mock('./invitation-request-snapshot', () => ({ invitationIncomingSession: vi.fn() }))
vi.mock('./invitation-upstream', async original => ({ ...await original<typeof InvitationUpstream>(), invitationBackend: vi.fn() }))
import type * as InvitationUpstream from './invitation-upstream'
const id = '019f4cd3-4567-789a-8123-456789abcdef'
const request = () => new Request(`https://app.example.test/api/invitation-operations/${id}`)
const deps = {} as ContextExecutorDeps
beforeEach(() => vi.resetAllMocks())
describe('flow-independent invitation operation recovery', () => {
  it('requires a current personal session before looking up a receipt', async () => {
    vi.mocked(invitationIncomingSession).mockResolvedValue(null)
    expect((await invitationOperationHandler(request(), id, deps)).status).toBe(401)
    expect(invitationBackend).not.toHaveBeenCalled()
  })
  it('reads a durable result without an owner cookie, flow selector, continuation or mutation', async () => {
    const entry = { version: 1, accessToken: '<test-access>', refreshToken: '<test-refresh>',
      accessTokenExpiresAt: Date.now() + 900000, userSnapshot: { id: 'example-user' } as UserResponse }
    vi.mocked(invitationIncomingSession).mockResolvedValue({ sessionId: 's'.repeat(43), binding: 'a'.repeat(64), entry })
    vi.mocked(freshContextSession).mockResolvedValue(entry)
    vi.mocked(invitationBackend).mockResolvedValue({ data: { state: 'unknown' }, refreshToken: null })
    const response = await invitationOperationHandler(request(), id, deps)
    expect(await response.json()).toEqual({ state: 'unknown' })
    const [path, , options] = vi.mocked(invitationBackend).mock.calls[0]!
    expect(path).toBe(`/auth/invites/operations/${id}`)
    expect(options).toMatchObject({ method: 'GET', accessToken: '<test-access>' })
    expect(options).not.toHaveProperty('credential')
    expect(options).not.toHaveProperty('body')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('rejects invalid operation selectors before session or API access', async () => {
    expect((await invitationOperationHandler(request(), '../accept', deps)).status).toBe(400)
    expect(invitationIncomingSession).not.toHaveBeenCalled()
    expect(invitationBackend).not.toHaveBeenCalled()
  })
})
