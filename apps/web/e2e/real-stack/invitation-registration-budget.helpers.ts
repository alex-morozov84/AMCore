import { guardedExec } from '../support/managed-target.mjs'

/** Reset only the shared IP fixture budget on the leased, isolated serial E2E stand.
 * Per-email budgets and all other limiters remain intact. Production limits are unchanged.
 */
export function resetInvitationRegistrationIpBudget() {
  guardedExec(
    'redis',
    'redis-cli',
    'EVAL',
    `local cursor = '0'
repeat
  local batch = redis.call('SCAN', cursor, 'MATCH', 'ratelimit:v1:invite-register-ip:*', 'COUNT', 100)
  cursor = batch[1]
  for _, key in ipairs(batch[2]) do redis.call('UNLINK', key) end
until cursor == '0'
return 1`,
    '0'
  )
}
