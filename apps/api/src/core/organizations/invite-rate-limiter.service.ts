import { createHash } from 'node:crypto'

import { HttpStatus, Inject, Injectable } from '@nestjs/common'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions'
import { type AppRedisClient, REDIS_CLIENT } from '../../infrastructure/redis'

const WINDOW_MS = 3600000

// One Redis decision admits both budgets or consumes neither. Fixed ceilings are
// inherited:3/hour/org+email and30/hour/actor+org. Successful attempts slide TTL;
// denials do not extend it. Hash email-bearing keys, never serialize provider data.
const ADMIT = `
local pair = tonumber(redis.call('GET', KEYS[1]) or '0')
local actor = tonumber(redis.call('GET', KEYS[2]) or '0')
if pair >= 3 or actor >= 30 then return 0 end
redis.call('INCR', KEYS[1])
redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[2], ARGV[1])
return 1
`

/** Fresh create/reissue attempt budget, after receipt replay and live authority.
 * Includes member no-op creates; replay and rejected stale generations do not
 * consume. A later database rollback does not refund an admitted abuse attempt.
 * Separate HTTP command limits still apply to replay. No secret-bearing queue.
 */
@Injectable()
export class InviteRateLimiterService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: AppRedisClient) {}

  async consume(orgId: string, emailCanonical: string, inviterId: string): Promise<void> {
    const hash = createHash('sha256').update(emailCanonical).digest('hex')
    const admitted = await this.redis.eval(ADMIT, {
      keys: [`rate:org_invite_pair:${orgId}:${hash}`, `rate:org_invite_actor:${inviterId}:${orgId}`],
      arguments: [String(WINDOW_MS)],
    })
    if (admitted !== 1) throw new AppException(
      'Too many invite attempts. Please try again later.', HttpStatus.TOO_MANY_REQUESTS,
      AuthErrorCode.RATE_LIMIT_EXCEEDED, { retryAfterSeconds: 3600 }
    )
  }
}
