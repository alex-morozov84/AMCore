import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

import { activeTarget, guardedExec, guardedSql } from './managed-target.mjs'

/** Domain success fixtures have independent source budgets; limiter tests do not use this setup. */
export function resetMfaDomainSourceBudgets(target = activeTarget(), execute = guardedExec) {
  if (target.purpose !== 'e2e' || target.mocked || !target.runToken)
    throw new Error('MFA domain budget reset requires an admitted disposable Docker E2E')
  const keys = execute('redis', 'redis-cli', '--scan', '--pattern', 'rate:mfa_source:v1:*')
    .trim()
    .split('\n')
    .filter(Boolean)
  if (keys.some((key) => !/^rate:mfa_source:v1:(start|verify):[a-f0-9]{64}$/.test(key)))
    throw new Error('Unexpected MFA source budget key')
  if (keys.length) execute('redis', 'redis-cli', 'UNLINK', ...keys)
}

/** A domain scenario starts with an idle probe budget, not the preceding scenario's traffic.
 * This is fixture isolation only, not evidence of production throughput or capacity.
 */
export function resetBrowserProbeDomainBudget(
  target = activeTarget(),
  execute = guardedExec,
  query = guardedSql
) {
  if (target.purpose !== 'e2e' || target.mocked || !target.runToken)
    throw new Error('Browser probe budget reset requires an admitted disposable Docker E2E')
  const ips = query('SELECT DISTINCT "ipAddress" FROM core.sessions WHERE "ipAddress" IS NOT NULL;')
    .trim()
    .split('\n')
    .filter(Boolean)
  if (ips.some((ip) => !isIP(ip))) throw new Error('Unexpected browser probe tracker')
  const keys = ips.map(
    (ip) =>
      `ratelimit:v1:${createHash('sha256')
        .update(`BrowserPublicationsController-probe-${ip}`)
        .digest('hex')}`
  )
  if (keys.length) execute('redis', 'redis-cli', 'UNLINK', ...keys)
}
