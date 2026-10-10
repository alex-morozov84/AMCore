import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { z } from 'zod'

import {
  workJobIdSchema,
  type WorkListQuery,
  type WorkReason,
  workReasonSchema,
} from '@amcore/shared'

const WINDOW_LUA = `
local function deny(code) return {'unavailable',code} end
local kind = redis.call('TYPE',KEYS[1]).ok
local list = ARGV[1] == 'list'
if kind ~= 'none' and kind ~= (list and 'list' or 'zset') then return deny('CONTENT_UNSUPPORTED') end
local count = list and redis.call('LLEN',KEYS[1]) or redis.call('ZCARD',KEYS[1])
local ids = list and redis.call('LRANGE',KEYS[1],0,511) or redis.call('ZRANGE',KEYS[1],0,511)
for _,id in ipairs(ids) do
  if #id < 1 or #id > 128 or not string.match(id,'^[%w_-]+$') then return deny('CONTENT_UNSUPPORTED') end
end
return {'observed',ids,tostring(count > 512 and 1 or 0)}
`

/** One fixed first window; pagination never extends observation beyond512 IDs. */
export async function readJobWindow(
  client: Redis,
  queue: Queue,
  query: Omit<WorkListQuery, 'state'> & { state: WorkListQuery['state'] | 'waiting-children' },
  legacyPaused: boolean
): Promise<{ ids: string[]; truncated: boolean } | { reason: WorkReason }> {
  const suffix = query.state === 'waiting' ? (legacyPaused ? 'paused' : 'wait') : query.state
  const list = query.state === 'waiting' || query.state === 'active'
  const result = await client.eval(WINDOW_LUA, 1, queue.toKey(suffix), list ? 'list' : 'zset')
  if (!Array.isArray(result)) throw new Error('INVALID_BROKER_REPLY')
  if (result[0] === 'unavailable') return { reason: workReasonSchema.parse(result[1]) }
  if (result[0] !== 'observed' || !['0', '1'].includes(result[2] as string))
    throw new Error('INVALID_BROKER_REPLY')
  const ids = z.array(workJobIdSchema).max(512).parse(result[1])
  const offset = (query.page - 1) * query.limit
  return { ids: ids.slice(offset, offset + query.limit), truncated: result[2] === '1' }
}
