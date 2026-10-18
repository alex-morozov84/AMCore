import { createHash } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'

import { AppException } from '../../../common/exceptions/index.js'
import { type AppRedisClient, REDIS_CLIENT } from '../../../infrastructure/redis/index.js'

import { provisioningAdmissionDeadline } from './provisioning-admission-deadline.js'
import { provisioningError } from './provisioning-error.js'

const ADMIT = `
for i = 1, 3 do
  local count = tonumber(redis.call('GET', KEYS[i]) or '0')
  if count >= tonumber(ARGV[i]) then return 0 end
end
for i = 1, 3 do
  redis.call('INCR', KEYS[i])
  redis.call('PEXPIRE', KEYS[i], 3600000)
end
return 1
`

@Injectable()
export class ProvisioningLimiterService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: AppRedisClient) {}

  async consume(orgId: string, email: string, actorId: string): Promise<void> {
    if (!this.redis.isReady) throw provisioningError('PROVISIONING_ADMISSION_UNAVAILABLE', 503)
    const hash = createHash('sha256').update(email).digest('hex')
    const admitted = await provisioningAdmissionDeadline((signal) =>
      this.redis.withCommandOptions({ abortSignal: signal, timeout: 250 }).eval(ADMIT, {
        keys: [
          `rate:org_invite_pair:${orgId}:${hash}`,
          `rate:org_invite_actor:${actorId}:${orgId}`,
          `rate:provisioning_actor:${actorId}`,
        ],
        arguments: ['3', '30', '30'],
      })
    )
    if (admitted !== 1)
      throw new AppException('Invitation rate limit reached', 429, 'RATE_LIMIT_EXCEEDED', {
        retryAfterSeconds: 3600,
      })
  }
}
