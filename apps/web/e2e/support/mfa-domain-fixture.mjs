import { activeTarget, guardedExec } from './managed-target.mjs'

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
