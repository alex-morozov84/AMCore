/** Size checks and reads share one Redis execution; no payload crosses the public boundary. */
export const JOB_READ_GUARD_LUA = `
local kind = redis.call('TYPE', KEYS[1]).ok
if kind == 'none' then return {'unavailable','HISTORY_EXPIRED'} end
if kind ~= 'hash' then return {'unavailable','CONTENT_UNSUPPORTED'} end
if redis.call('HLEN', KEYS[1]) > 64 then
  return {'unavailable','CONTENT_UNSUPPORTED'}
end
local fields = {'name','data','opts','amMetadata','amHistory','amRevision',
  'ats','atm','timestamp','processedOn','finishedOn','delay','priority','progress',
  'amAutoStartsUsed','amManualGrant','amMode','amIncarnation',
  'parentKey','parent','deid','repeatJobKey','rjk','amManualCommandId','amManualDispatchId',
  'amRequestPrepared','amRequestDigest','amProviderScope','amRequestExpiresAt',
  'amEffectAttempt','amEffectRevision','amEvidenceInitialized','failedReason','amLegacyRequestUnknown','amInvocationId'}
local limits = {64,32768,16384,2048,8192,128,
  128,128,128,128,128,128,128,128,128,128,128,128,128,128,128,128,128,128,128,1,64,64,128,128,128,1,512,1,128}
local total = 0
local scalarTotal = 0
for i,field in ipairs(fields) do
  local size = redis.call('HSTRLEN', KEYS[1], field)
  if size > limits[i] then return {'unavailable','CONTENT_UNSUPPORTED'} end
  total = total + size
  if i >= 6 then scalarTotal = scalarTotal + size end
end
if scalarTotal > 1024 then return {'unavailable','CONTENT_UNSUPPORTED'} end
-- Reserve fixed response framing and membership/queue witness overhead as part of
-- the same 64KiB observation unit. Page accounting must not count field bytes only.
total = total + 1536
if total > 65536 then return {'unavailable','READ_LIMIT'} end
`
export const JOB_READ_LUA =
  JOB_READ_GUARD_LUA +
  `
return {'observed',redis.call('HMGET', KEYS[1], unpack(fields)),total}
`

export const JOB_READ_FIELDS = [
  'name',
  'data',
  'opts',
  'amMetadata',
  'amHistory',
  'amRevision',
  'ats',
  'atm',
  'timestamp',
  'processedOn',
  'finishedOn',
  'delay',
  'priority',
  'progress',
  'amAutoStartsUsed',
  'amManualGrant',
  'amMode',
  'amIncarnation',
  'parentKey',
  'parent',
  'deid',
  'repeatJobKey',
  'rjk',
  'amManualCommandId',
  'amManualDispatchId',
  'amRequestPrepared',
  'amRequestDigest',
  'amProviderScope',
  'amRequestExpiresAt',
  'amEffectAttempt',
  'amEffectRevision',
  'amEvidenceInitialized',
  'failedReason',
  'amLegacyRequestUnknown',
  'amInvocationId',
] as const
