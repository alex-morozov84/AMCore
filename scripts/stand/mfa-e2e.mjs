import { createHmac } from 'node:crypto'

/** Disposable Docker test credentials only; previews and normal deployments stay unchanged. */
export function mfaE2EEnvironment(m) {
  if (m.purpose !== 'e2e' || m.mocked) return {}
  if (typeof m.jwtSecret !== 'string' || m.jwtSecret.length < 32)
    throw new Error('MFA test key requires the owned stand secret')
  return {
    MFA_ACTIVE_KEY_ID: 'managed-e2e',
    MFA_ENCRYPTION_KEYS: JSON.stringify({
      'managed-e2e': createHmac('sha256', m.jwtSecret).update('mfa-e2e-key-v1').digest('base64'),
    }),
  }
}

/** Explicit seeded protocol state, not deployment activation/preflight evidence. */
export async function prepareMfaE2E(m, execute) {
  if (m.purpose !== 'e2e' || m.mocked) throw new Error('MFA fixture requires Docker E2E')
  if (!m.runToken || m.snapshot === m.worktree)
    throw new Error('MFA fixture requires its own admitted invocation and source snapshot')
  const sql = execute ?? (await import('./ownership.mjs')).sql
  // invocationSql validates the live lease, database marker and complete owned generation.
  const output = await sql(
    m,
    `INSERT INTO core.mfa_protocol (id, state, version, "updatedAt")
      SELECT 'platform', 'active', 1, NOW()
      WHERE NOT EXISTS (SELECT 1 FROM core.mfa_protocol WHERE id = 'platform');
      UPDATE core.mfa_protocol SET state = 'active', "updatedAt" = NOW()
      WHERE id = 'platform' AND version = 1 AND state IN ('prepared', 'active')
      RETURNING state || ':' || version;`
  )
  if (!output.split('\n').includes('active:1')) throw new Error('Unsupported MFA test protocol')
}
