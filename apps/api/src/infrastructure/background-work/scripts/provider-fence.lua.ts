import { HORIZON_CHECK_OVERHEAD_MS, PROVIDER_WINDOW_CLOCK } from '../provider-window-clock'

import { JOB_READ_GUARD_LUA } from './job-read.lua'

/** A PG reservation is not permission to send: current broker identity and time must agree. */
export const PROVIDER_FENCE_LUA =
  JOB_READ_GUARD_LUA +
  `
local function reject(code) return {'rejected',code} end
local function integer(value)
  local n = tonumber(value)
  if not n or n < 0 or n > 9007199254740991 or n ~= math.floor(n) then return nil end
  return n
end
if redis.call('TYPE',KEYS[2]).ok ~= 'string' or
  redis.call('TYPE',KEYS[3]).ok ~= 'string' or
  redis.call('TYPE',KEYS[4]).ok ~= 'hash' then return reject('STATE_CHANGED') end
if redis.call('STRLEN',KEYS[2]) > 128 or redis.call('STRLEN',KEYS[3]) > 131072 or
  redis.call('HLEN',KEYS[4]) > 64 or redis.call('HSTRLEN',KEYS[4],'amQueueEpoch') > 128 then
  return reject('CONTENT_UNSUPPORTED')
end
if redis.call('HSTRLEN',KEYS[1],'amInvocationId') > 128 then return reject('CONTENT_UNSUPPORTED') end
local values = redis.call('HMGET',KEYS[1],unpack(fields))
local ok,envelope = pcall(cjson.decode,values[2] or '')
if not ok or type(envelope) ~= 'table' or envelope.protocolVersion ~= 1 or
  envelope.incarnation ~= ARGV[1] or envelope.jobVersion ~= tonumber(ARGV[2]) or
  envelope.executionPolicyVersion ~= tonumber(ARGV[3]) then return reject('STATE_CHANGED') end
local optsOk,opts = pcall(cjson.decode,values[3] or '')
if not optsOk or type(opts) ~= 'table' or integer(opts.attempts or 3) ~= tonumber(ARGV[18]) then
  return reject('CONTENT_UNSUPPORTED')
end
local ats,atm,createdAt = integer(values[7]),integer(values[8] or 0),integer(envelope.createdAt)
if not ats or ats < 1 or not atm or not createdAt then return reject('CONTENT_UNSUPPORTED') end
local revision = integer(values[6] or 0)
if not revision or revision >= 9007199254740991 then return reject('CONTENT_UNSUPPORTED') end
if tostring(revision) ~= ARGV[4] or redis.call('GET',KEYS[2]) ~= ARGV[5] or
  redis.call('PTTL',KEYS[2]) < 2000 or
  redis.call('HGET',KEYS[4],'amQueueEpoch') ~= ARGV[6] then return reject('STATE_CHANGED') end
if values[26] ~= '1' or values[27] ~= ARGV[7] or values[28] ~= ARGV[8] then
  return reject('REQUEST_EXPIRED')
end
local expiry = integer(values[29])
local pgTime,deadline,floor = integer(ARGV[9]),integer(ARGV[10]),integer(ARGV[11])
local effectRevision,used = integer(ARGV[13]),integer(ARGV[14])
if not expiry or not pgTime or not deadline or not floor or not effectRevision or
  effectRevision < 1 or not used or used > 10 or
  (ARGV[15] ~= 'none' and ARGV[15] ~= 'spent') or
  (ARGV[16] ~= 'automatic' and ARGV[16] ~= 'manual') then return reject('CONTENT_UNSUPPORTED') end
if used > tonumber(ARGV[18]) or (ARGV[16] == 'manual' and
  (ARGV[15] ~= 'spent' or ARGV[19] == '' or values[24] ~= ARGV[19])) then
  return reject('COMMAND_CONFLICT')
end
local refence = ARGV[17] == '1'
if refence then
  if values[30] ~= ARGV[12] or values[31] ~= ARGV[13] or values[32] ~= '1' then
    return reject('OUTCOME_UNRECORDED')
  end
elseif values[30] == ARGV[12] then return reject('OUTCOME_UNRECORDED') end
local oldStartedAt = 0
if values[4] then
  local metadataOk,metadata = pcall(cjson.decode,values[4])
  if not metadataOk or type(metadata) ~= 'table' then return reject('CONTENT_UNSUPPORTED') end
  oldStartedAt = integer(metadata.startedAt)
  if not oldStartedAt then return reject('CONTENT_UNSUPPORTED') end
  if refence and (metadata.report ~= 'unrecorded' or metadata.invocationId ~= ARGV[12]) then
    return reject('OUTCOME_UNRECORDED')
  end
end
local time = redis.call('TIME')
local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
if now < oldStartedAt or math.abs(now-pgTime) > ${PROVIDER_WINDOW_CLOCK.timestampErrorBoundMs} then
  return reject('CLOCK_UNCERTAIN')
end
if now+2000 < createdAt or now-createdAt > 2592000000 then return reject('HISTORY_EXPIRED') end
if expiry <= now then return reject('REQUEST_EXPIRED') end
if now-${PROVIDER_WINDOW_CLOCK.timestampErrorBoundMs} < floor then return reject('COOLDOWN') end
if now+${HORIZON_CHECK_OVERHEAD_MS} >= deadline then return reject('HORIZON_EXPIRED') end
local metadata = cjson.encode({version=1,report='unrecorded',invocationId=ARGV[12],startedAt=now})
-- Check creation of every borrowed field before HSET; refencing adds no history entry.
local additions = {'amAutoStartsUsed','amManualGrant','amMode','amIncarnation','amRevision',
  'amInvocationId','amMetadata','amHistory','amEffectAttempt','amEffectRevision','amEvidenceInitialized'}
local missing = 0
for _,field in ipairs(additions) do
  if redis.call('HEXISTS',KEYS[1],field) == 0 then missing = missing+1 end
end
if redis.call('HLEN',KEYS[1])+missing > 64 then return reject('CONTENT_UNSUPPORTED') end
-- FIRST WRITE: only this exact live reservation may reach the synchronous transport seam.
redis.call('HSET',KEYS[1],'amAutoStartsUsed',used,'amManualGrant',ARGV[15],
  'amMode',ARGV[16],'amIncarnation',ARGV[1],'amRevision',revision+1,
  'amInvocationId',ARGV[12],'amMetadata',metadata,'amEffectAttempt',ARGV[12],
  'amEffectRevision',ARGV[13],'amEvidenceInitialized','1','amHistory',values[5] or '[]')
return {'fenced',tostring(revision+1),tostring(now)}
`
