import { createHash, randomBytes } from 'node:crypto'

import { createInvitationOperationId } from '@amcore/shared'
import { expect } from '@playwright/test'

import { activeTarget, guardedExec, guardedSql } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { TEST_PASSWORD, uniqueEmail } from './helpers'

// Explicit legacy-site fixture: simulate a pre-placement row/link in owned test data.
// Current admin-bound rendered-mail delivery is proved by the separate staff fixture.
export async function inviteRecipient(email: string, existingOwnerEmail?: string) {
  const target = activeTarget()
  const ownerEmail = existingOwnerEmail ?? uniqueEmail('invitation-owner')
  if (!existingOwnerEmail)
    await directApi('auth/register', { email: ownerEmail, password: TEST_PASSWORD })
  const login = await directApi('auth/login', { email: ownerEmail, password: TEST_PASSWORD })
  const org = await directApi(
    'organizations',
    { name: 'Invitation browser proof' },
    login.accessToken
  )
  const response = await fetch(
    `http://127.0.0.1:${target.ports.api}/api/v1/organizations/${org.id}/invites`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${login.accessToken}`,
        'content-type': 'application/json',
        'x-invitation-operation-id': createInvitationOperationId(),
      },
      body: JSON.stringify({ email }),
    }
  )
  expect(response.status).toBe(202)
  expect(await response.json()).toEqual({ status: 'invited' })
  const token = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(token).digest('hex')
  const updated = guardedSql(
    `UPDATE core.org_invites SET "tokenHash"=:'hash', "frontendDestination"='site', "placementFingerprint"=NULL WHERE "organizationId"=:'org' AND "emailCanonical"=:'email' AND "acceptedAt" IS NULL RETURNING id;`,
    { hash, org: org.id, email }
  )
  expect(updated).toContain('UPDATE 1')
  return { org, token }
}
export function membershipCount(email: string, org: string) {
  return guardedSql(
    `SELECT count(*) FROM core.org_members m JOIN core.users u ON u.id=m."userId" WHERE u."emailCanonical"=:'email' AND m."organizationId"=:'org';`,
    { email, org }
  ).trim()
}

const STAGED_SESSION_PREFIX = 'web:invitation:staged-session:'

/**
 * Test-owned fault at the publication boundary: Redis refuses writes to the invitation staging
 * namespace and nothing else (glob classes allow every key that does not start with the prefix;
 * reads of the namespace stay allowed). The reservation and the API call succeed, the new session
 * cannot be staged. Always pair with `restoreRedisAccess` in a `finally`.
 */
export function refuseInvitationStaging(): void {
  const allowed = [...STAGED_SESSION_PREFIX].map(
    (char, index) => `~${STAGED_SESSION_PREFIX.slice(0, index)}[^${char}]*`
  )
  guardedExec(
    'redis',
    'redis-cli',
    'ACL',
    'SETUSER',
    'default',
    'resetkeys',
    ...allowed,
    `%R~${STAGED_SESSION_PREFIX}*`
  )
}

export function restoreRedisAccess(): void {
  guardedExec('redis', 'redis-cli', 'ACL', 'SETUSER', 'default', 'resetkeys', '~*')
}

export function accountCount(email: string): string {
  return guardedSql(`SELECT count(*) FROM core.users WHERE "emailCanonical"=:'email';`, {
    email,
  }).trim()
}
