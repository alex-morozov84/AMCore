import { describe, expect, it, vi } from 'vitest'

import { publishInvitationAuth, reserveInvitationAuth } from './invitation-auth-transition'
import {
  admitInvitationFlow,
  currentInvitationFlow,
  expectedInvitationFlow,
  newInvitationOwner,
  retireInvitationFlows,
} from './invitation-flow-authority'

vi.mock('server-only', () => ({}))
const now = 1000000
const admission = {
  credential: 'c'.repeat(43),
  expiresAt: new Date(now + 1800000).toISOString(),
  intent: { expectedInviteId: 'invitation-example', expectedGeneration: 1 },
}

describe('invitation flow authority', () => {
  it('caps simultaneous flows and hourly admissions independently', () => {
    let owner = newInvitationOwner('https://app.example.test', null, now)
    for (let i = 0; i < 5; i++) owner = admitInvitationFlow(owner, admission, 'en', null, now).owner
    expect(() => admitInvitationFlow(owner, admission, 'en', null, now)).toThrow()
    owner = { ...owner, flows: [], admissions: 20 }
    expect(() => admitInvitationFlow(owner, admission, 'en', null, now)).toThrow()
    expect(
      admitInvitationFlow(
        owner,
        { ...admission, expiresAt: new Date(now + 4000000).toISOString() },
        'en',
        null,
        now + 3600001
      ).owner.admissions
    ).toBe(1)
  })

  it('compares current session, submitted revision and submitted session before writes', () => {
    const first = admitInvitationFlow(
      newInvitationOwner('https://app.example.test', null, now),
      admission,
      'en',
      null,
      now
    )
    expect(expectedInvitationFlow(first.owner, first.flow.binding, null, now)).toEqual(first.flow)
    expect(() =>
      expectedInvitationFlow(first.owner, { ...first.flow.binding, flowRevision: 2 }, null, now)
    ).toThrow()
    expect(() =>
      expectedInvitationFlow(
        first.owner,
        { ...first.flow.binding, sessionBinding: 'a'.repeat(64) },
        null,
        now
      )
    ).toThrow()
    expect(() =>
      currentInvitationFlow(first.owner, first.flow.binding.flowId, 'a'.repeat(64), now)
    ).toThrow()
  })

  it('retires all summaries after ordinary login and never silently rebinds on GET', () => {
    const first = admitInvitationFlow(
      newInvitationOwner('https://app.example.test', null, now),
      admission,
      'en',
      null,
      now
    )
    const owner = retireInvitationFlows(first.owner, 'a'.repeat(64))
    expect(owner.epoch).toBe(1)
    expect(owner.flows[0]!.binding.flowRevision).toBe(2)
    expect(() => currentInvitationFlow(owner, first.flow.binding.flowId, null, now)).toThrow()
    expect(() =>
      currentInvitationFlow(owner, first.flow.binding.flowId, 'a'.repeat(64), now)
    ).toThrow()
    expect(
      admitInvitationFlow(owner, admission, 'en', 'a'.repeat(64), now).flow.binding.flowRevision
    ).toBe(1)
  })

  it('caps admission expiry by backend credential, flow lifetime and absolute owner expiry', () => {
    const owner = {
      ...newInvitationOwner('https://app.example.test', null, now),
      expiresAt: now + 10000,
    }
    const result = admitInvitationFlow(owner, admission, 'en', null, now)
    expect(result.flow.expiresAt).toBe(now + 10000)
    expect(() =>
      currentInvitationFlow(result.owner, result.flow.binding.flowId, null, now + 10001)
    ).toThrow()
  })
  it('expires an abandoned authentication reservation without silently resetting it', () => {
    const first = admitInvitationFlow(
      newInvitationOwner('https://app.example.test', null, now),
      admission,
      'en',
      null,
      now
    )
    const reservation = reserveInvitationAuth(
      first.owner,
      first.flow.binding,
      null,
      'login',
      null,
      now
    )
    expect(
      currentInvitationFlow(reservation.owner, first.flow.binding.flowId, null, now + 59999).state
    ).toBe('authenticating')
    expect(() =>
      currentInvitationFlow(reservation.owner, first.flow.binding.flowId, null, now + 60000)
    ).toThrow()
    expect(reservation.owner.flows[0]!.state).toBe('authenticating')
    const reopened = admitInvitationFlow(reservation.owner, admission, 'en', null, now + 60000)
    expect(reopened.owner.flows).toHaveLength(1)
    expect(reopened.flow.binding.flowId).not.toBe(first.flow.binding.flowId)
  })

  it('keeps a published handoff addressable after its local deadline for authoritative ACK recovery', () => {
    const first = admitInvitationFlow(
      newInvitationOwner('https://app.example.test', null, now),
      admission,
      'en',
      null,
      now
    )
    const reservation = reserveInvitationAuth(
      first.owner,
      first.flow.binding,
      null,
      'login',
      null,
      now
    )
    const owner = publishInvitationAuth(
      reservation.owner,
      first.flow.binding.flowId,
      reservation.attempt.id,
      reservation.attempt.fence,
      null,
      { binding: 'a'.repeat(64), vaultId: 'vault', backendId: 'backend', deadline: now + 60000 },
      now
    )
    expect(
      currentInvitationFlow(owner, first.flow.binding.flowId, 'a'.repeat(64), now + 60001).state
    ).toBe('completing_signin')
  })
})
