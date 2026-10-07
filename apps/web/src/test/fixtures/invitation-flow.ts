import { DEFAULT_LOCALE, type UserResponse } from '@amcore/shared'

import {
  publishInvitationAuth,
  reserveInvitationAuth,
} from '@/shared/api/bff/invitation-auth-transition'
import { invitationCookiePolicy } from '@/shared/api/bff/invitation-cookie'
import { admitInvitationFlow, newInvitationOwner } from '@/shared/api/bff/invitation-flow-authority'
import type { captureInvitationRequest } from '@/shared/api/bff/invitation-request-snapshot'

/** Deliberately fake server data; no fixture credentials are usable outside mocked transport. */
export function recipientFixture(signedIn = false, pending = false) {
  const now = Date.now()
  const origin = 'https://app.example.test'
  const user: UserResponse = {
    id: 'example-user',
    email: 'invited@example.test',
    name: 'Example',
    phone: null,
    avatarUrl: null,
    locale: DEFAULT_LOCALE,
    timezone: 'UTC',
    emailVerified: false,
    createdAt: new Date(now).toISOString(),
    lastLoginAt: null,
  }
  const personalBinding = signedIn && !pending ? 'a'.repeat(64) : null
  const admission = {
    credential: 'c'.repeat(43),
    expiresAt: new Date(now + 1800000).toISOString(),
    intent: { expectedInviteId: 'invitation-example', expectedGeneration: 1 },
  }
  const admitted = admitInvitationFlow(
    newInvitationOwner(origin, personalBinding, now),
    admission,
    DEFAULT_LOCALE,
    personalBinding,
    now
  )
  let owner = admitted.owner
  let attempt
  if (pending) {
    const reserved = reserveInvitationAuth(owner, admitted.flow.binding, null, 'login', null, now)
    attempt = reserved.attempt
    owner = publishInvitationAuth(
      reserved.owner,
      admitted.flow.binding.flowId,
      attempt.id,
      attempt.fence,
      null,
      {
        binding: 'a'.repeat(64),
        vaultId: 's'.repeat(43),
        backendId: 'example-backend-session',
        deadline: now + 60000,
      },
      now
    )
  }
  const snapshot: Awaited<ReturnType<typeof captureInvitationRequest>> = {
    owner,
    flow: owner.flows[0]!,
    ownerHash: 'b'.repeat(64),
    policy: invitationCookiePolicy(origin),
    session:
      signedIn || pending
        ? {
            sessionId: 's'.repeat(43),
            binding: 'a'.repeat(64),
            entry: {
              version: 1,
              userSnapshot: user,
              accessToken: '<test-access>',
              refreshToken: '<test-refresh>',
              accessTokenExpiresAt: now + 900000,
            },
          }
        : null,
  }
  return { now, origin, user, admission, snapshot, attempt }
}
