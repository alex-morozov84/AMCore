import { describe, expect, it, vi } from 'vitest'

import {
  confirmInvitationAuth,
  publishInvitationAuth,
  publishInvitationSignout,
  rejectInvitationAuth,
  reserveInvitationAuth,
} from './invitation-auth-transition'
import {
  admitInvitationFlow,
  newInvitationOwner,
  retireInvitationFlows,
} from './invitation-flow-authority'

vi.mock('server-only', () => ({}))
const now = 1000000
const session = {
  binding: 'a'.repeat(64),
  vaultId: 'new-vault',
  backendId: 'new-backend',
  deadline: now + 60000,
}
function neutral() {
  return admitInvitationFlow(
    newInvitationOwner('https://app.example.test', null, now),
    {
      credential: 'c'.repeat(43),
      expiresAt: new Date(now + 1800000).toISOString(),
      intent: { expectedInviteId: 'invitation-example', expectedGeneration: 1 },
    },
    'en',
    null,
    now
  )
}
function reserved() {
  const initial = neutral()
  return reserveInvitationAuth(initial.owner, initial.flow.binding, null, 'login', null, now)
}

describe('invited authentication fences', () => {
  it('uses two monotonically increasing revisions and leaves publication awaiting explicit API confirmation', () => {
    const reservation = reserved()
    expect(reservation.flow.binding.flowRevision).toBe(2)
    const owner = publishInvitationAuth(
      reservation.owner,
      reservation.flow.binding.flowId,
      reservation.attempt.id,
      reservation.attempt.fence,
      null,
      session,
      now
    )
    expect(owner.flows[0]).toMatchObject({
      state: 'completing_signin',
      binding: { flowRevision: 3 },
      handoff: { confirmed: false },
    })
    const confirmed = confirmInvitationAuth(
      owner,
      owner.flows[0]!.binding,
      session.binding,
      reservation.attempt.id,
      now
    )
    expect(confirmed.flows[0]!.state).toBe('active')
    expect(
      confirmInvitationAuth(
        confirmed,
        confirmed.flows[0]!.binding,
        session.binding,
        reservation.attempt.id,
        now
      )
    ).toEqual(confirmed)
  })

  it('blocks a late publication after ordinary login or changed incoming cookie', () => {
    const reservation = reserved()
    for (const [owner, incoming] of [
      [retireInvitationFlows(reservation.owner, session.binding), session.binding],
      [reservation.owner, session.binding],
    ] as const) {
      expect(() =>
        publishInvitationAuth(
          owner,
          reservation.flow.binding.flowId,
          reservation.attempt.id,
          reservation.attempt.fence,
          incoming,
          session,
          now
        )
      ).toThrow()
    }
  })

  it('keeps rejected attempt revisions consumed and prevents an old fence from publishing a replacement', () => {
    const first = reserved()
    const released = rejectInvitationAuth(
      first.owner,
      first.flow.binding.flowId,
      first.attempt.id,
      first.attempt.fence
    )
    expect(released.flows[0]!.binding.flowRevision).toBe(3)
    const second = reserveInvitationAuth(
      released,
      released.flows[0]!.binding,
      null,
      'login',
      null,
      now
    )
    expect(() =>
      publishInvitationAuth(
        second.owner,
        first.flow.binding.flowId,
        first.attempt.id,
        first.attempt.fence,
        null,
        session,
        now
      )
    ).toThrow()
  })

  it('serializes invited OAuth starts across independent flows in one owner', () => {
    const first = neutral()
    const oauth = reserveInvitationAuth(
      first.owner,
      first.flow.binding,
      null,
      'oauth',
      'google',
      now
    )
    const second = admitInvitationFlow(
      oauth.owner,
      {
        credential: 'd'.repeat(43),
        expiresAt: new Date(now + 1800000).toISOString(),
        intent: { expectedInviteId: 'second-example', expectedGeneration: 1 },
      },
      'en',
      null,
      now
    )
    expect(() =>
      reserveInvitationAuth(second.owner, second.flow.binding, null, 'oauth', 'github', now)
    ).toThrow()
  })

  it('preserves only the chosen neutral admission on explicit account switching', () => {
    const initial = neutral()
    const signed = {
      ...initial.owner,
      sessionBinding: session.binding,
      flows: initial.owner.flows.map((flow) => ({
        ...flow,
        binding: { ...flow.binding, sessionBinding: session.binding },
      })),
    }
    const switching = reserveInvitationAuth(
      signed,
      signed.flows[0]!.binding,
      session.binding,
      'switch',
      null,
      now
    )
    const result = publishInvitationSignout(
      switching.owner,
      switching.flow.binding.flowId,
      switching.attempt.id,
      switching.attempt.fence,
      session.binding,
      now
    )
    expect(result.flows[0]).toMatchObject({
      state: 'active',
      binding: { flowRevision: 3, sessionBinding: null },
      handoff: null,
    })
    expect(result.sessionBinding).toBeNull()
  })
})
