import { PROVIDER_WINDOW_CLOCK } from '../provider-window-clock'

import { JOB_MEMBERSHIP_GUARD_LUA } from './job-membership.lua'

/**
 * Narrowed BullMQ 6.3.11 moveToDelayed/getDelayedScore/marker transitions (MIT).
 * Copyright (c) 2018 BullForce Labs AB and contributors; BULLMQ-LICENSE.txt.
 * Stock removeLock writes too early for this contract; all predicates precede lock removal.
 */
export const PROVIDER_DEFER_LUA =
  JOB_MEMBERSHIP_GUARD_LUA +
  `
local function reject(code) return {'rejected',code} end
local function integer(value)
  local n = tonumber(value)
  if not n or n < 0 or n > 9007199254740991 or n ~= math.floor(n) then return nil end
  return n
end
if state ~= 'active' or not locked or redis.call('GET',KEYS[11]) ~= ARGV[2] or
  redis.call('PTTL',KEYS[11]) < 2000 then return reject('STATE_CHANGED') end
local ok,envelope = pcall(cjson.decode,values[2] or '')
if not ok or type(envelope) ~= 'table' or envelope.protocolVersion ~= 1 or
  envelope.incarnation ~= ARGV[3] then return reject('STATE_CHANGED') end
local revision = integer(values[6] or 0)
if not revision or revision >= 9007199254740991 then return reject('CONTENT_UNSUPPORTED') end
if tostring(revision) ~= ARGV[4] then return reject('STATE_CHANGED') end
for i=19,23 do
  if values[i] then return reject('RELATED_JOB') end
end
for _,count in ipairs(relations) do
  if count ~= 0 then return reject('RELATED_JOB') end
end
local floor,deadline = integer(ARGV[5]),integer(ARGV[6])
if not floor or not deadline then return reject('CLOCK_UNCERTAIN') end
local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
-- An unresolved ADMIN retry is a harmless claim, never another provider attempt.
-- Reuse this bounded transition while retaining the exact mirrored command and deadline.
if ARGV[7] ~= '' then
  if values[24] ~= ARGV[7] then return reject('COMMAND_CONFLICT') end
  floor = math.max(floor,now+1000-${PROVIDER_WINDOW_CLOCK.timestampErrorBoundMs})
end
local allowance = ${PROVIDER_WINDOW_CLOCK.maxSchedulingAfterCheckMs + PROVIDER_WINDOW_CLOCK.maxTransportLifetimeMs + PROVIDER_WINDOW_CLOCK.reservedSafetyMarginMs}
if floor+allowance >= deadline-${PROVIDER_WINDOW_CLOCK.timestampErrorBoundMs} then
  return reject('HORIZON_EXPIRED')
end
local due = floor+${PROVIDER_WINDOW_CLOCK.timestampErrorBoundMs}
if due <= now then return {'eligible'} end
if due > 2199023255551 then return reject('CLOCK_UNCERTAIN') end
if redis.call('TYPE',KEYS[20]).ok ~= 'none' and redis.call('TYPE',KEYS[20]).ok ~= 'set' then
  return reject('CONTENT_UNSUPPORTED')
end
local maxEvents = integer(meta[6] or '10000')
if not maxEvents or maxEvents < 1 or maxEvents > 10000 or redis.call('XLEN',KEYS[17]) > 20000 or
  redis.call('ZCARD',KEYS[18]) > 2 then return reject('CONTENT_UNSUPPORTED') end
local markers = redis.call('ZRANGE',KEYS[18],0,1,'WITHSCORES')
for i=1,#markers,2 do
  local score = tonumber(markers[i+1])
  if not score or score < 0 or score > 9007199254740991 or
    (markers[i] ~= '0' and markers[i] ~= '1') or
    (markers[i] == '0' and score ~= 0) then return reject('CONTENT_UNSUPPORTED') end
end
local concurrency = meta[5] and integer(meta[5]) or nil
if meta[5] and (not concurrency or concurrency < 1) then return reject('CONTENT_UNSUPPORTED') end
local restoreBase = not meta[4] and (listSizes[3] > 0 or redis.call('ZCARD',KEYS[9]) > 0) and
  (not concurrency or listSizes[5]-1 < concurrency)
local minScore,maxScore = due*4096,(due+1)*4096-1
local existing = redis.call('ZREVRANGEBYSCORE',KEYS[8],maxScore,minScore,'WITHSCORES','LIMIT',0,1)
local score = minScore
if #existing > 0 then
  if #existing[1] > 128 then return reject('CONTENT_UNSUPPORTED') end
  local last = integer(existing[2])
  if not last then return reject('CONTENT_UNSUPPORTED') end
  score = math.min(last+1,maxScore)
end
local first = redis.call('ZRANGE',KEYS[8],0,0,'WITHSCORES')
local nextDue = due
if #first > 0 then
  if #first[1] > 128 then return reject('CONTENT_UNSUPPORTED') end
  local firstScore = integer(first[2])
  if not firstScore then return reject('CONTENT_UNSUPPORTED') end
  nextDue = math.min(due,firstScore/4096)
end
local additions = 0
for _,field in ipairs({'delay','amRevision'}) do
  if redis.call('HEXISTS',KEYS[1],field) == 0 then additions = additions+1 end
end
if redis.call('HLEN',KEYS[1])+additions > 64 then return reject('CONTENT_UNSUPPORTED') end
-- FIRST WRITE. No fetch-next, attempt reset/increment, provider reservation or manual grant spend.
redis.call('DEL',KEYS[11])
redis.call('SREM',KEYS[20],ARGV[1])
redis.call('LREM',KEYS[5],-1,ARGV[1])
redis.call('HSET',KEYS[1],'delay',due-now,'amRevision',revision+1)
redis.call('ZADD',KEYS[8],score,ARGV[1])
redis.call('XADD',KEYS[17],'MAXLEN','~',maxEvents,'*','event','delayed','jobId',ARGV[1],
  'delay',due)
redis.call('ZADD',KEYS[18],nextDue,'1')
if restoreBase then redis.call('ZADD',KEYS[18],0,'0') end
return {'deferred',tostring(due)}
`
