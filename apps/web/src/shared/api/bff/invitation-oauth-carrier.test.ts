import { describe, expect, it, vi } from 'vitest'

import { reserveInvitationAuth } from './invitation-auth-transition'
import { admitInvitationFlow, newInvitationOwner } from './invitation-flow-authority'
import { type InvitationOAuthCarrier, invitationOAuthFlow } from './invitation-oauth-carrier'

vi.mock('server-only', () => ({}))
const now = 1000000
const ownerHash = 'a'.repeat(64)

function fixture() {
  const admitted = admitInvitationFlow(
    newInvitationOwner('https://app.example.test', null, now),
    {
      credential: 'c'.repeat(43),
      expiresAt: new Date(now + 1800000).toISOString(),
      intent: { expectedInviteId: 'example-invitation', expectedGeneration: 2 },
    },
    'en',
    null,
    now
  )
  const reservation = reserveInvitationAuth(
    admitted.owner,
    admitted.flow.binding,
    null,
    'oauth',
    'google',
    now
  )
  const { attempt, flow, owner } = reservation
  const carrier: InvitationOAuthCarrier = {
    attemptId: attempt.id,
    ownerHash,
    origin: owner.origin,
    flowId: flow.binding.flowId,
    reservedRevision: attempt.reservedRevision,
    expectedSessionBinding: null,
    ownerEpoch: owner.epoch,
    provider: 'google',
    ...flow.intent,
    fence: attempt.fence,
    createdAt: attempt.createdAt,
    expiresAt: attempt.expiresAt,
    status: 'reserved',
    ticketHash: null,
    backendSessionId: null,
  }
  return { owner, carrier, flow }
}

describe('invited OAuth exact carrier authority', () => {
  it('resolves the exact reserved flow', () => {
    const { owner, carrier, flow } = fixture()
    expect(invitationOAuthFlow(owner, carrier, ownerHash, null, now)).toEqual(flow)
  })

  it.each([
    { ownerHash: 'b'.repeat(64) },
    { origin: 'https://other.example.test' },
    { flowId: 'x'.repeat(22) },
    { attemptId: 'x'.repeat(22) },
    { fence: 'x'.repeat(22) },
    { provider: 'github' as const },
    { expectedGeneration: 3 },
    { expectedInviteId: 'other' },
    { reservedRevision: 3 },
    { ownerEpoch: 1 },
    { createdAt: now - 1 },
    { expiresAt: now + 1 },
    { status: 'started' as const },
    { status: 'used' as const },
    { expectedSessionBinding: 'b'.repeat(64) },
  ])('rejects a changed carrier field: %j', (patch) => {
    const { owner, carrier } = fixture()
    expect(() =>
      invitationOAuthFlow(owner, { ...carrier, ...patch }, ownerHash, null, now)
    ).toThrow()
  })

  it('rejects changed incoming session, expired carrier and replaced owner epoch', () => {
    const { owner, carrier } = fixture()
    expect(() => invitationOAuthFlow(owner, carrier, ownerHash, 'b'.repeat(64), now)).toThrow()
    expect(() => invitationOAuthFlow(owner, carrier, ownerHash, null, carrier.expiresAt)).toThrow()
    expect(() =>
      invitationOAuthFlow({ ...owner, epoch: owner.epoch + 1 }, carrier, ownerHash, null, now)
    ).toThrow()
  })

  it('requires the start transition on both carrier and stored attempt', () => {
    const { owner, carrier } = fixture()
    const started = {
      ...owner,
      flows: owner.flows.map((flow) => ({
        ...flow,
        attempt: flow.attempt ? { ...flow.attempt, started: true } : null,
      })),
    }
    expect(
      invitationOAuthFlow(started, { ...carrier, status: 'started' }, ownerHash, null, now).attempt
        ?.started
    ).toBe(true)
    expect(() => invitationOAuthFlow(started, carrier, ownerHash, null, now)).toThrow()
  })
})
