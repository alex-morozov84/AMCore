/**
 * Adapted from BullMQ 6.3.11 pause-7.lua and its marker helpers (MIT).
 * Copyright (c) 2018 BullForce Labs AB and contributors. See script-provenance.ts for pinned sources and BULLMQ-LICENSE.txt for the license.
 * All validation, including borrowed helper inputs, precedes the first write.
 */
export const QUEUE_CONTROL_LUA = `
local function reject(code) return {'rejected', code} end
local function integer(value)
  local n = tonumber(value)
  if not n or n < 0 or n > 9007199254740991 or n ~= math.floor(n) then return nil end
  return n
end
local expectedTypes = {'hash','list','list','list','zset','zset','zset','stream'}
local types = {}
for i=1,8 do
  types[i] = redis.call('TYPE', KEYS[i]).ok
  if types[i] ~= 'none' and types[i] ~= expectedTypes[i] then
    return reject('CONTENT_UNSUPPORTED')
  end
end
if types[1] ~= 'hash' or redis.call('HLEN', KEYS[1]) > 64 then
  return reject('METADATA_UNAVAILABLE')
end
local fields = {'amQueueEpoch','amControlRevision','amProtocol','paused',
  'concurrency','opts.maxLenEvents'}
for _,field in ipairs(fields) do
  if redis.call('HSTRLEN', KEYS[1], field) > 128 then
    return reject('CONTENT_UNSUPPORTED')
  end
end
local meta = redis.call('HMGET', KEYS[1], unpack(fields))
local revision = integer(meta[2])
local nextRevision = integer(ARGV[3])
local deadline = integer(ARGV[6])
local admittedAt = integer(ARGV[7])
if not revision or not nextRevision or not deadline or not admittedAt then
  return reject('CONTENT_UNSUPPORTED')
end
if meta[3] ~= '1' or (meta[4] and meta[4] ~= '1') then
  return reject('CONTENT_UNSUPPORTED')
end
if meta[5] and (not integer(meta[5]) or tonumber(meta[5]) < 1) then
  return reject('CONTENT_UNSUPPORTED')
end
local maxEvents = meta[6] and integer(meta[6]) or 10000
if not maxEvents or maxEvents < 1 or maxEvents > 10000 then
  return reject('CONTENT_UNSUPPORTED')
end
if redis.call('XLEN', KEYS[8]) > 20000 then return reject('LIMIT_REACHED') end
local markers = redis.call('ZCARD', KEYS[7])
if markers > 2 then return reject('CONTENT_UNSUPPORTED') end
local recognized = 0
for _,member in ipairs({'0','1'}) do
  local score = redis.call('ZSCORE', KEYS[7], member)
  if score then
    local number = tonumber(score)
    if not number or number < 0 or number > 9007199254740991 or
      (member == '0' and number ~= 0) then
      return reject('CONTENT_UNSUPPORTED')
    end
    recognized = recognized + 1
  end
end
if recognized ~= markers then return reject('CONTENT_UNSUPPORTED') end
local paused = meta[4] and '1' or '0'
local legacy = types[3] == 'list'
if legacy and (types[2] ~= 'none' or paused ~= '1') then
  return reject('LEGACY_MIGRATION_REQUIRED')
end
if meta[1] ~= ARGV[1] or tostring(revision) ~= ARGV[2] or
  paused ~= ARGV[4] or nextRevision <= revision then
  return reject('STATE_CHANGED')
end
local operation = ARGV[5]
if operation ~= 'pause' and operation ~= 'resume' then
  return reject('CONTENT_UNSUPPORTED')
end
if (operation == 'pause' and paused == '1') or
  (operation == 'resume' and paused == '0') then
  return reject('ALREADY_IN_STATE')
end
if operation == 'pause' and not meta[4] and redis.call('HLEN',KEYS[1]) >= 64 then
  return reject('CONTENT_UNSUPPORTED')
end
local time = redis.call('TIME')
local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
if now + 2000 < admittedAt then return reject('CLOCK_UNCERTAIN') end
if now > deadline then return reject('COMMAND_EXPIRED') end
local pending = redis.call('LLEN', legacy and KEYS[3] or KEYS[2])
local prioritized = redis.call('ZCARD', KEYS[5])
local delayedAt = nil
if operation == 'resume' and pending + prioritized == 0 then
  local first = redis.call('ZRANGE', KEYS[6], 0, 0, 'WITHSCORES')
  if #first > 0 then
    if #first[1] > 128 or not string.match(first[1], '^[%w_-]+$') then
      return reject('CONTENT_UNSUPPORTED')
    end
    local score = integer(first[2])
    if not score then return reject('CONTENT_UNSUPPORTED') end
    delayedAt = score / 4096
  end
end
-- FIRST WRITE: no helper above mutates a key or initializes defaults.
if operation == 'pause' then
  redis.call('HSET', KEYS[1], 'paused', '1')
  redis.call('DEL', KEYS[7])
else
  if legacy then redis.call('RENAME', KEYS[3], KEYS[2]) end
  redis.call('HDEL', KEYS[1], 'paused')
  if pending + prioritized > 0 then
    redis.call('ZADD', KEYS[7], 0, '0')
  elseif delayedAt then
    redis.call('ZADD', KEYS[7], delayedAt, '1')
  end
end
redis.call('HSET', KEYS[1], 'amControlRevision', ARGV[3])
redis.call('XADD', KEYS[8], 'MAXLEN', '~', maxEvents, '*',
  'event', operation == 'pause' and 'paused' or 'resumed')
return {'applied', ARGV[3], operation == 'pause' and '1' or '0'}
`
