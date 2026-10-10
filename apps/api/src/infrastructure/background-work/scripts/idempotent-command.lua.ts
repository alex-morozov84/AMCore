import { HORIZON_CHECK_OVERHEAD_MS, PROVIDER_WINDOW_CLOCK } from '../provider-window-clock'

import { JOB_MEMBERSHIP_GUARD_LUA } from './job-membership.lua'

/**
 * Standalone narrowed transitions from BullMQ 6.3.11 reprocessJob/removeJob (MIT).
 * Copyright (c) 2018 BullForce Labs AB and contributors; BULLMQ-LICENSE.txt.
 * Relationship/scheduler/dedup helpers are deliberately unreachable for this profile.
 */
function commandLua(providerWindow: boolean): string {
  return (
    JOB_MEMBERSHIP_GUARD_LUA +
    `
local function integer(value)
  local n = tonumber(value)
  if not n or n < 0 or n > 9007199254740991 or n ~= math.floor(n) then return nil end
  return n
end
if fingerprint ~= ARGV[2] then return deny('STATE_CHANGED') end
local operation = ARGV[3]
if operation ~= 'retry' and operation ~= 'cancel' and operation ~= 'cleanup' then
  return deny('ACTION_UNAVAILABLE')
end
${
  providerWindow
    ? `if values[34] then
  return deny(values[34] == '1' and 'EFFECT_UNKNOWN' or 'CONTENT_UNSUPPORTED')
end`
    : ''
}
local decoded, envelope = pcall(cjson.decode, values[2] or '')
local optsDecoded, opts = pcall(cjson.decode, values[3] or '')
if not decoded or type(envelope) ~= 'table' or not optsDecoded or type(opts) ~= 'table' then
  return deny('CONTENT_UNSUPPORTED')
end
if envelope.protocolVersion ~= 1 or envelope.incarnation ~= ARGV[4] or
  envelope.jobVersion ~= integer(ARGV[5]) or
  envelope.executionPolicyVersion ~= integer(ARGV[6]) then return deny('VERSION_UNSUPPORTED') end
local revision = integer(values[6] or '0')
local started = integer(values[7] or '0')
local made = integer(values[8] or '0')
local admittedAt = integer(ARGV[7])
local deadline = integer(ARGV[8])
local createdAt = integer(envelope.createdAt)
local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
if not revision or revision >= 9007199254740991 or not started or not made or
  not admittedAt or not deadline or not createdAt then return deny('CONTENT_UNSUPPORTED') end
if now + 2000 < admittedAt or createdAt > now + 2000 then return deny('CLOCK_UNCERTAIN') end
if now > deadline then return deny('COMMAND_EXPIRED') end
if now - createdAt > 2592000000 then return deny('HISTORY_EXPIRED') end
local allowedOptions = {attempts=true,backoff=true,removeOnComplete=true,removeOnFail=true,
  jobId=true,delay=true,priority=true,lifo=true,timestamp=true}
for field,_ in pairs(opts) do
  if not allowedOptions[field] then return deny('RELATED_JOB') end
end
if opts.lifo ~= nil and type(opts.lifo) ~= 'boolean' then return deny('CONTENT_UNSUPPORTED') end
local automaticLimit = integer(opts.attempts or 3)
local priority = integer(values[13] or '0')
if not automaticLimit or automaticLimit < 1 or automaticLimit > 10 or not priority or
  priority > 2097152 then return deny('CONTENT_UNSUPPORTED') end
for i=19,23 do if values[i] then return deny('RELATED_JOB') end end
for _,count in ipairs(relations) do if count ~= 0 then return deny('RELATED_JOB') end end
if redis.call('ZSCORE',KEYS[19],ARGV[1]) then return deny('RELATED_JOB') end
if state == 'waiting-children' then return deny('RELATED_JOB') end
if locked or state == 'active' then return deny('ACTIVE_JOB') end
local maxEvents = meta[6] and integer(meta[6]) or 10000
local concurrency = meta[5] and integer(meta[5]) or nil
if not maxEvents or maxEvents < 1 or maxEvents > 10000 or
  (meta[5] and (not concurrency or concurrency < 1)) then return deny('CONTENT_UNSUPPORTED') end
if redis.call('XLEN',KEYS[17]) > 20000 then return deny('LIMIT_REACHED') end
local markers = redis.call('ZCARD',KEYS[18])
if markers > 2 then return deny('CONTENT_UNSUPPORTED') end
local recognized = 0
for _,member in ipairs({'0','1'}) do
  local markerScore = redis.call('ZSCORE',KEYS[18],member)
  if markerScore then
    local n = tonumber(markerScore)
    if not n or n < 0 or n > 9007199254740991 or (member == '0' and n ~= 0) then
      return deny('CONTENT_UNSUPPORTED')
    end
    recognized = recognized + 1
  end
end
if recognized ~= markers then return deny('CONTENT_UNSUPPORTED') end
local metadata = nil
if values[4] then
  local ok, value = pcall(cjson.decode,values[4])
  if not ok or type(value) ~= 'table' then return deny('CONTENT_UNSUPPORTED') end
  metadata = value
end
if operation == 'retry' then
  if state ~= 'failed' then return deny('STATE_CHANGED') end
  if priority ~= 0 then return deny('PRIORITY_RETRY_UNSUPPORTED') end
  if values[16] ~= 'none' then return deny('MANUAL_GRANT_SPENT') end
  -- Bull's safe terminal witness survives a lost AM report and participates in fingerprint CAS.
  if values[33] == 'PERMANENT_FAILURE' then return deny('PERMANENT_FAILURE') end
  ${
    providerWindow
      ? `
  local effectRevision, deadline, floor = integer(ARGV[15]),integer(ARGV[18]),integer(ARGV[19])
  if not effectRevision or effectRevision < 1 or not deadline or not floor or
    values[26] ~= '1' or values[27] ~= ARGV[16] or values[28] ~= ARGV[17] then
    return deny('REQUEST_EXPIRED')
  end
  local bodyType = redis.call('TYPE',KEYS[20]).ok
  if bodyType ~= 'string' then return deny('REQUEST_EXPIRED') end
  if redis.call('STRLEN',KEYS[20]) > 131072 then return deny('CONTENT_UNSUPPORTED') end
  local expiry = integer(values[29] or 0)
  if not expiry then return deny('CONTENT_UNSUPPORTED') end
  if redis.call('PTTL',KEYS[20]) <= 0 or expiry <= now then
    return deny('REQUEST_EXPIRED')
  end
  if now-${PROVIDER_WINDOW_CLOCK.timestampErrorBoundMs} < floor then return deny('COOLDOWN') end
  if now+${HORIZON_CHECK_OVERHEAD_MS} >= deadline then return deny('HORIZON_EXPIRED') end
  `
      : `if values[18] ~= ARGV[4] or not metadata or
    (metadata.report ~= 'unrecorded' and
      not (metadata.report == 'failure' and metadata.code == 'TRANSIENT_FAILURE')) then
    return deny('PERMANENT_FAILURE')
  end`
  }
  if redis.call('HSTRLEN',KEYS[1],'failedReason') > 512 then return deny('CONTENT_UNSUPPORTED') end
  local additions = 0
  for _,field in ipairs({'amManualGrant','amMode','amManualCommandId','amManualDispatchId','amRevision'${
    providerWindow ? ",'amEffectRevision','amEvidenceInitialized'" : ''
  }}) do
    if redis.call('HEXISTS',KEYS[1],field) == 0 then additions = additions + 1 end
  end
  -- Check the resulting hash before removing membership or clearing failure fields.
  if redis.call('HLEN',KEYS[1]) + additions > 64 then return deny('LIMIT_REACHED') end
elseif operation == 'cancel' then
  if state ~= 'waiting' and state ~= 'delayed' and state ~= 'prioritized' then
    return deny('STATE_CHANGED')
  end
  if started ~= 0 or made ~= 0 or values[10] or values[11] or values[4] or values[15] or
    values[18] then return deny('ACTIVE_JOB') end
else
  local cutoff = integer(ARGV[11])
  local minAge = integer(ARGV[12])
  local finished = integer(values[11])
  if state ~= 'failed' and state ~= 'completed' then return deny('STATE_CHANGED') end
  if state ~= ARGV[13] or not cutoff or not minAge or minAge < 1 or
    minAge > 2592000000 or not finished or finished > cutoff or cutoff > now - minAge then
    return deny('STATE_CHANGED')
  end
end
${
  providerWindow
    ? `
local releasedSize = nil
local preparedCount = nil
local preparedBytes = nil
if operation == 'cleanup' then
  local kinds = {'string','hash','zset','hash'}
  for i=20,23 do
    local kind = redis.call('TYPE',KEYS[i]).ok
    if kind ~= 'none' and kind ~= kinds[i-19] then return deny('CONTENT_UNSUPPORTED') end
  end
  if redis.call('STRLEN',KEYS[20]) > 131072 or redis.call('HLEN',KEYS[21]) > 2 or
    redis.call('HSTRLEN',KEYS[21],'count') > 128 or
    redis.call('HSTRLEN',KEYS[21],'bytes') > 128 or
    redis.call('HSTRLEN',KEYS[23],ARGV[4]) > 512 then return deny('CONTENT_UNSUPPORTED') end
  preparedCount = integer(redis.call('HGET',KEYS[21],'count') or '0')
  preparedBytes = integer(redis.call('HGET',KEYS[21],'bytes') or '0')
  if not preparedCount or not preparedBytes or preparedCount > 1024 or preparedBytes > 67108864 or
    redis.call('ZCARD',KEYS[22]) ~= preparedCount or redis.call('HLEN',KEYS[23]) ~= preparedCount then
    return deny('CONTENT_UNSUPPORTED')
  end
  local raw = redis.call('HGET',KEYS[23],ARGV[4])
  local expiry = redis.call('ZSCORE',KEYS[22],ARGV[4])
  local bodySize = redis.call('STRLEN',KEYS[20])
  if raw then
    local ok,entry = pcall(cjson.decode,raw)
    if not ok or type(entry) ~= 'table' or entry.jobId ~= ARGV[1] or
      values[26] ~= '1' or type(entry.digest) ~= 'string' or #entry.digest ~= 64 or
      not string.match(entry.digest,'^[a-f0-9]+$') or type(entry.scope) ~= 'string' or
      #entry.scope ~= 64 or not string.match(entry.scope,'^[a-f0-9]+$') or
      entry.digest ~= values[27] or entry.scope ~= values[28] or
      not integer(entry.expires) or entry.expires ~= integer(values[29]) or
      tonumber(expiry) ~= entry.expires or not integer(entry.size) or entry.size < 1 or
      entry.size > 131072 or (bodySize ~= 0 and bodySize ~= entry.size) or
      (bodySize == 0 and entry.expires > now) or preparedCount < 1 or preparedBytes < entry.size then
      return deny('CONTENT_UNSUPPORTED')
    end
    releasedSize = entry.size
  elseif expiry or bodySize ~= 0 or
    (values[26] and (values[26] ~= '1' or not integer(values[29]) or integer(values[29]) > now)) then
    return deny('CONTENT_UNSUPPORTED')
  end
end
`
    : ''
}
-- The read-only eligibility path shares ALL predicates; it cannot create a grant.
if ARGV[14] == 'check' then return {'applied'} end
-- FIRST WRITE: every type, size, identity, membership and borrowed-helper input is checked above.
if operation == 'retry' then
  redis.call('ZREM',KEYS[6],ARGV[1])
  redis.call('HDEL',KEYS[1],'finishedOn','processedOn','failedReason')
  redis.call('HSET',KEYS[1],'amManualGrant','reserved','amMode','manual','amManualCommandId',ARGV[9],
    'amManualDispatchId',ARGV[10],'amRevision',tostring(revision+1))
  ${providerWindow ? "redis.call('HSET',KEYS[1],'amEffectRevision',ARGV[15],'amEvidenceInitialized','1')" : ''}
  redis.call(opts.lifo and 'RPUSH' or 'LPUSH',legacy and KEYS[4] or KEYS[3],ARGV[1])
  if not meta[4] and (not concurrency or listSizes[5] < concurrency) then
    redis.call('ZADD',KEYS[18],0,'0')
  end
  redis.call('XADD',KEYS[17],'MAXLEN','~',maxEvents,'*','event','waiting',
    'jobId',ARGV[1],'prev','failed')
else
  if state == 'waiting' then
    redis.call('LREM',legacy and KEYS[4] or KEYS[3],1,ARGV[1])
  else
    local stateKeys = {failed=KEYS[6],completed=KEYS[7],delayed=KEYS[8],prioritized=KEYS[9]}
    redis.call('ZREM',stateKeys[state],ARGV[1])
  end
  ${
    providerWindow
      ? `if operation == 'cleanup' and releasedSize then
    redis.call('UNLINK',KEYS[20])
    redis.call('ZREM',KEYS[22],ARGV[4])
    redis.call('HDEL',KEYS[23],ARGV[4])
    redis.call('HSET',KEYS[21],'count',preparedCount-1,'bytes',preparedBytes-releasedSize)
  end`
      : ''
  }
  redis.call('UNLINK',KEYS[1],KEYS[11],KEYS[12],KEYS[13],KEYS[14],KEYS[15],KEYS[16])
  redis.call('XADD',KEYS[17],'MAXLEN','~',maxEvents,'*','event','removed',
    'jobId',ARGV[1],'prev',state)
end
return {'applied'}
`
  )
}

export const IDEMPOTENT_COMMAND_LUA = commandLua(false)
/** Same membership/no-write guard; independent PG evidence must precede this provider transition. */
export const PROVIDER_COMMAND_LUA = commandLua(true)
