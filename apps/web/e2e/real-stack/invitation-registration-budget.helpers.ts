import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

import { guardedExec } from '../support/managed-target.mjs'

/** Reset only the shared IP fixture budget on the leased, isolated serial E2E stand.
 * Both registration IP ceilings reset; per-email and unrelated budgets remain intact. Production limits are unchanged.
 */
export function resetInvitationRegistrationIpBudget() {
  const removed = guardedExec(
    'redis',
    'redis-cli',
    '--raw',
    'EVAL',
    `local cursor = '0'
local removed = {}
repeat
  local batch = redis.call('SCAN', cursor, 'MATCH', 'ratelimit:v1:invite-register-ip:*', 'COUNT', 100)
  cursor = batch[1]
  for _, key in ipairs(batch[2]) do
    redis.call('UNLINK', key)
    table.insert(removed, key)
  end
until cursor == '0'
return removed`,
    '0'
  )
  for (const key of removed.trim().split('\n').filter(Boolean)) {
    const ip = key.replace(/^ratelimit:v1:invite-register-ip:/, '')
    if (!isIP(ip)) throw new Error('Unexpected invitation IP budget key')
    const globalKey = createHash('sha256')
      .update(`InvitationPublicController-register-${ip}`)
      .digest('hex')
    guardedExec('redis', 'redis-cli', 'UNLINK', `ratelimit:v1:${globalKey}`)
  }
}
