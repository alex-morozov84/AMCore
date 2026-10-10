import type { Redis } from 'ioredis'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'

const INITIALIZE_QUEUE_LUA = `
local kind = redis.call('TYPE', KEYS[1]).ok
if kind ~= 'none' and kind ~= 'hash' then return {'rejected','CONTENT_UNSUPPORTED'} end
local fieldsCount = redis.call('HLEN', KEYS[1])
if fieldsCount > 64 then return {'rejected','CONTENT_UNSUPPORTED'} end
local fields = {'amQueueEpoch','amControlRevision','amProtocol'}
for _,field in ipairs(fields) do
  if redis.call('HSTRLEN', KEYS[1], field) > 128 then
    return {'rejected','CONTENT_UNSUPPORTED'}
  end
end
local values = redis.call('HMGET', KEYS[1], unpack(fields))
if values[1] then
  local revision = tonumber(values[2])
  if values[3] ~= '1' or not revision or revision < 0 or
    revision > 9007199254740991 or revision ~= math.floor(revision) then
    return {'rejected','CONTENT_UNSUPPORTED'}
  end
  return {'initialized',values[1]}
end
if values[2] or values[3] then return {'rejected','CONTENT_UNSUPPORTED'} end
if fieldsCount > 61 then return {'rejected','CONTENT_UNSUPPORTED'} end
redis.call('HSET', KEYS[1], 'amQueueEpoch', ARGV[1],
  'amControlRevision', '0', 'amProtocol', '1')
return {'initialized',ARGV[1]}
`

/** Producers/startup initialize identity; observation never repairs or changes queue state. */
export async function initializeManagedQueue(client: Redis, metaKey: string): Promise<string> {
  const reply = await client.eval(INITIALIZE_QUEUE_LUA, 1, metaKey, uuidv7())
  if (!Array.isArray(reply) || reply[0] !== 'initialized' || typeof reply[1] !== 'string')
    throw new Error('QUEUE_METADATA_UNAVAILABLE')
  return z.uuidv7().parse(reply[1])
}
