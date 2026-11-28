import type { sharedRedis } from '@/shared/api/bff/shared-redis'

import 'server-only'

const WINDOW_SECONDS = 10
const MAX_REPORTS_PER_WINDOW = 20
const REDIS_KEY_PREFIX = 'csp-report-rate-limit:'

const INCREMENT_WINDOW = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`

/** Increment and initialize the window together, even if the caller loses the response. */
export async function isCspReportRateLimited(
  redis: Pick<ReturnType<typeof sharedRedis>, 'eval'>,
  key: string
): Promise<boolean> {
  const count = await redis.eval(INCREMENT_WINDOW, {
    keys: [`${REDIS_KEY_PREFIX}${key}`],
    arguments: [String(WINDOW_SECONDS)],
  })
  return Number(count) > MAX_REPORTS_PER_WINDOW
}
