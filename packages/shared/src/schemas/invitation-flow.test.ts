import { describe, expect, it } from 'vitest'

import {
  invitationFlowOAuthResponseSchema,
  invitationFlowPendingResponseSchema,
} from './invitation-flow'

const binding = { flowId: 'f'.repeat(22), flowRevision: 3, sessionBinding: 'a'.repeat(64) }
describe('browser invitation handoff projections', () => {
  it('provides only the safe attempt selector needed for explicit ACK recovery', () => {
    const pending = { state: 'completing_signin', binding, handoff: { attemptId: 'b'.repeat(22) } }
    expect(invitationFlowPendingResponseSchema.safeParse(pending).success).toBe(true)
    expect(
      invitationFlowPendingResponseSchema.safeParse({ state: 'completing_signin', binding }).success
    ).toBe(false)
    for (const secret of [
      'cleanupKey',
      'accessToken',
      'refreshToken',
      'credential',
      'newSessionId',
    ]) {
      expect(
        invitationFlowPendingResponseSchema.safeParse({
          ...pending,
          handoff: { ...pending.handoff, [secret]: '<test-secret>' },
        }).success
      ).toBe(false)
    }
  })
  it('keeps authentication-in-progress free of handoff and personal metadata', () => {
    expect(
      invitationFlowPendingResponseSchema.safeParse({ state: 'authenticating', binding }).success
    ).toBe(true)
    expect(
      invitationFlowPendingResponseSchema.safeParse({
        state: 'authenticating',
        binding,
        handoff: { attemptId: 'b'.repeat(22) },
      }).success
    ).toBe(false)
  })
  it('allows only the code-owned OAuth start destination', () => {
    const safe = `/api/auth/oauth/google?invitationAttempt=${'b'.repeat(22)}`
    expect(
      invitationFlowOAuthResponseSchema.safeParse({ binding, authorizeHref: safe }).success
    ).toBe(true)
    for (const href of [
      `https://evil.example.test${safe}`,
      `/${safe}`,
      `${safe}&returnTo=/evil`,
      `/api/auth/oauth/telegram?invitationAttempt=${'b'.repeat(22)}`,
    ]) {
      expect(
        invitationFlowOAuthResponseSchema.safeParse({ binding, authorizeHref: href }).success
      ).toBe(false)
    }
  })
})
