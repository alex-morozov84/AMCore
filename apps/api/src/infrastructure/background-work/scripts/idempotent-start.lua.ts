/** The Bull lock fences metadata; business idempotency fences business effects. */
export const IDEMPOTENT_START_LUA = `
local function reject(code) return {'rejected',code} end
local function integer(value)
  local n = tonumber(value)
  if not n or n < 0 or n > 9007199254740991 or n ~= math.floor(n) then return nil end
  return n
end
if redis.call('TYPE', KEYS[1]).ok ~= 'hash' or
   redis.call('TYPE', KEYS[2]).ok ~= 'string' then return reject('STATE_CHANGED') end
if redis.call('HLEN', KEYS[1]) > 64 then return reject('CONTENT_UNSUPPORTED') end
local fields = {'data','opts','ats','atm','amRevision','amAutoStartsUsed',
  'amManualGrant','amMode','amIncarnation','amMetadata','amHistory','amInvocationId',
  'amManualCommandId','amManualDispatchId'}
local limits = {32768,16384,128,128,128,128,128,128,128,2048,8192,128,128,128}
for i,field in ipairs(fields) do
  if redis.call('HSTRLEN', KEYS[1], field) > limits[i] then
    return reject('CONTENT_UNSUPPORTED')
  end
end
local values = redis.call('HMGET', KEYS[1], unpack(fields))
if redis.sha1hex(values[1] or '') ~= ARGV[9] or redis.sha1hex(values[2] or '') ~= ARGV[10] then
  return reject('STATE_CHANGED')
end
local ok,envelope = pcall(cjson.decode, values[1] or '')
if not ok or type(envelope) ~= 'table' or envelope.protocolVersion ~= 1 or
  envelope.incarnation ~= ARGV[1] or envelope.executionPolicyVersion ~= tonumber(ARGV[2]) or
  envelope.jobVersion ~= tonumber(ARGV[3]) then return reject('STATE_CHANGED') end
local optsOk,opts = pcall(cjson.decode, values[2] or '')
if not optsOk or type(opts) ~= 'table' then return reject('CONTENT_UNSUPPORTED') end
local maximum = integer(opts.attempts or 3)
local ats = integer(values[3])
local atm = integer(values[4] or 0)
local revision = integer(values[5] or 0)
local createdAt = integer(envelope.createdAt)
if not maximum or maximum < 1 or maximum > 10 or not ats or not atm or
  not revision or not createdAt then return reject('CONTENT_UNSUPPORTED') end
if tostring(revision) ~= ARGV[4] then return reject('STATE_CHANGED') end
if redis.call('GET', KEYS[2]) ~= ARGV[5] or redis.call('PTTL', KEYS[2]) < 2000 then
  return reject('STATE_CHANGED')
end
local time = redis.call('TIME')
local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
if now + 2000 < createdAt or now - createdAt > 2592000000 then
  return reject('HISTORY_EXPIRED')
end
local used,grant,mode
if not values[6] then
  if ats ~= 1 or atm ~= 0 or values[5] or values[7] or values[8] or values[9] or
    values[10] or values[11] or values[12] or values[13] or values[14] then
    return reject('METADATA_UNAVAILABLE')
  end
  used,grant,mode = 0,'none','automatic'
else
  used = integer(values[6])
  grant,mode = values[7],values[8]
  if not used or used > maximum or values[9] ~= ARGV[1] or
    (grant ~= 'none' and grant ~= 'reserved' and grant ~= 'spent') or
    (mode ~= 'automatic' and mode ~= 'manual') then return reject('METADATA_UNAVAILABLE') end
end
if mode == 'manual' then
  if grant ~= 'reserved' then return reject('MANUAL_GRANT_SPENT') end
  if not values[13] or not values[14] or values[13] ~= ARGV[7] or values[14] ~= ARGV[8] then
    return reject('STATE_CHANGED')
  end
  grant = 'spent'
else
  if grant ~= 'none' then return reject('METADATA_UNAVAILABLE') end
  if used >= maximum then return reject('AUTOMATIC_BUDGET_SPENT') end
  used = used + 1
end
if revision >= 9007199254740991 then return reject('CONTENT_UNSUPPORTED') end
local additions = 0
for _,field in ipairs({'amAutoStartsUsed','amManualGrant','amMode','amIncarnation','amRevision',
  'amInvocationId','amMetadata','amHistory'}) do
  if redis.call('HEXISTS',KEYS[1],field) == 0 then additions = additions+1 end
end
if redis.call('HLEN',KEYS[1])+additions > 64 then return reject('CONTENT_UNSUPPORTED') end
local metadata = cjson.encode({version=1,report='unrecorded',invocationId=ARGV[6],startedAt=now})
-- FIRST WRITE: a stall cannot replenish this lifetime budget.
redis.call('HSET', KEYS[1], 'amAutoStartsUsed', used,'amManualGrant',grant,
  'amMode',mode,'amIncarnation',ARGV[1],'amRevision',revision+1,
  'amInvocationId',ARGV[6],'amMetadata',metadata,'amHistory',values[11] or '[]')
return {'started',tostring(revision+1),tostring(now),mode}
`
