import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { recipientFixture } from '@/test/fixtures/invitation-flow'

import type { ContextExecutorDeps } from './context-executor'
import { invitationRequestAuthority } from './invitation-request-authority'
import {
  assertInvitationReadCurrent,
  captureInvitationRequest,
} from './invitation-request-snapshot'
import { observeInvitationVerification } from './invitation-verification-handler'
import { invitationVerificationReturn } from './invitation-verification-return'
import {
  consumeInvitationVerificationSelector,
  readInvitationVerificationSelector,
} from './invitation-verification-store'

vi.mock('server-only', () => ({}))
vi.mock('./invitation-request-authority', () => ({ invitationRequestAuthority: vi.fn() }))
vi.mock('./invitation-request-snapshot', () => ({
  captureInvitationRequest: vi.fn(),
  assertInvitationReadCurrent: vi.fn(),
}))
vi.mock('./invitation-verification-handler', () => ({ observeInvitationVerification: vi.fn() }))
vi.mock('./invitation-verification-store', () => ({
  consumeInvitationVerificationSelector: vi.fn(),
  readInvitationVerificationSelector: vi.fn(),
  createInvitationVerificationSelector: vi.fn(),
}))
vi.mock('./invitation-owner-lease', () => ({
  withInvitationOwnerLease: (_hash: string, _signal: AbortSignal, work: () => unknown) => work(),
}))
const deps = {} as ContextExecutorDeps
const selector = 'i'.repeat(22)
const request = (binding = 'a'.repeat(64)) =>
  new Request(`https://app.example.test/api/invitation-verification-return/${selector}`, {
    method: 'POST',
    headers: { origin: 'https://app.example.test', 'content-type': 'application/json' },
    body: JSON.stringify({ expectedSessionBinding: binding }),
  })
beforeEach(() => {
  vi.resetAllMocks()
  const { snapshot, user } = recipientFixture(true)
  vi.mocked(captureInvitationRequest).mockResolvedValue(snapshot)
  vi.mocked(invitationRequestAuthority).mockReturnValue({
    ownerHash: snapshot.ownerHash,
    policy: snapshot.policy,
  })
  vi.mocked(readInvitationVerificationSelector).mockResolvedValue({
    ownerHash: snapshot.ownerHash,
    origin: snapshot.owner.origin,
    binding: snapshot.flow.binding,
    ownerEpoch: snapshot.owner.epoch,
    expiresAt: Date.now() + 1800000,
  })
  vi.mocked(consumeInvitationVerificationSelector).mockResolvedValue(true)
  vi.mocked(observeInvitationVerification).mockResolvedValue({
    user: { ...user, emailVerified: true },
    inspection: {
      state: 'already_access',
      inviteId: snapshot.flow.intent.expectedInviteId,
      generation: snapshot.flow.intent.expectedGeneration,
      organization: { id: 'example-org', name: 'Example' },
    },
  })
  vi.mocked(assertInvitationReadCurrent).mockResolvedValue(undefined)
})

describe('explicit verification return BFF', () => {
  it('consumes current selector and returns a safe destination after fresh verified observation', async () => {
    const response = await invitationVerificationReturn(request(), selector, deps)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.destination).toBe(
      new URL(
        localizedFrontendUrl(
          'https://app.example.test',
          DEFAULT_LOCALE,
          `invite/flow/${body.binding.flowId}`
        )
      ).pathname
    )
    expect(Object.keys(body).sort()).toEqual(['binding', 'destination'])
    expect(consumeInvitationVerificationSelector).toHaveBeenCalledOnce()
    expect(observeInvitationVerification).toHaveBeenCalledOnce()
  })

  it('does not consume or inspect for another current session binding', async () => {
    const response = await invitationVerificationReturn(request('b'.repeat(64)), selector, deps)
    expect(response.status).toBe(409)
    expect(consumeInvitationVerificationSelector).not.toHaveBeenCalled()
    expect(observeInvitationVerification).not.toHaveBeenCalled()
  })

  it('does not inspect when selector consumption loses its owner CAS', async () => {
    vi.mocked(consumeInvitationVerificationSelector).mockResolvedValue(false)
    expect((await invitationVerificationReturn(request(), selector, deps)).status).toBe(409)
    expect(observeInvitationVerification).not.toHaveBeenCalled()
  })

  it('does not claim verification or return navigation for an unverified actor', async () => {
    const { user } = recipientFixture(true)
    vi.mocked(observeInvitationVerification).mockResolvedValue({
      user,
      inspection: { state: 'verify_email', email: user.email },
    })
    const response = await invitationVerificationReturn(request(), selector, deps)
    expect(response.status).toBe(409)
    expect(await response.json()).not.toHaveProperty('destination')
  })

  it('contains missing or expired selectors with reopen error and privacy headers', async () => {
    vi.mocked(readInvitationVerificationSelector).mockResolvedValue(null)
    const response = await invitationVerificationReturn(request(), selector, deps)
    expect(response.status).toBe(409)
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(observeInvitationVerification).not.toHaveBeenCalled()
  })
})
