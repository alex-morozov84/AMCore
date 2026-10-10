import { JOB_READ_GUARD_LUA } from './job-read.lua'

/** Full membership proof, never a prefix-negative claim. Shared by snapshots and mutation predicates. */
export const JOB_MEMBERSHIP_GUARD_LUA =
  JOB_READ_GUARD_LUA +
  `
local function deny(code) return {'unavailable', code} end
local types = {'hash','hash','list','list','list','zset','zset','zset','zset','zset',
  'string','set','hash','hash','zset','list','stream','zset','zset'}
for i=2,19 do
  local kind = redis.call('TYPE',KEYS[i]).ok
  if kind ~= 'none' and kind ~= types[i] then return deny('CONTENT_UNSUPPORTED') end
end
if redis.call('HLEN',KEYS[2]) > 64 then return deny('METADATA_UNAVAILABLE') end
local metaFields = {'amQueueEpoch','amControlRevision','amProtocol','paused','concurrency','opts.maxLenEvents'}
for _,field in ipairs(metaFields) do
  if redis.call('HSTRLEN',KEYS[2],field) > 128 then return deny('CONTENT_UNSUPPORTED') end
end
local meta = redis.call('HMGET',KEYS[2],unpack(metaFields))
if not meta[1] or meta[3] ~= '1' or (meta[4] and meta[4] ~= '1') then
  return deny('METADATA_UNAVAILABLE')
end
local listSizes = {}
for i=3,5 do
  listSizes[i] = redis.call('LLEN',KEYS[i])
  if listSizes[i] > 4096 then return deny('LIMIT_REACHED') end
end
local legacy = listSizes[4] > 0
if legacy and (listSizes[3] > 0 or meta[4] ~= '1') then
  return deny('LEGACY_MIGRATION_REQUIRED')
end
local membership = {}
local found = 0
local state = nil
local score = false
local names = {'waiting','waiting','active','failed','completed','delayed','prioritized','waiting-children'}
for i=3,10 do
  if i <= 5 then
    local positions = redis.call('LPOS',KEYS[i],ARGV[1],'COUNT',2,'MAXLEN',4096)
    if #positions > 1 then return deny('INCONSISTENT_STATE') end
    membership[i-2] = #positions == 1 and positions[1] or false
    if #positions == 1 then
      found = found + 1
      state = names[i-2]
    end
  else
    local memberScore = redis.call('ZSCORE',KEYS[i],ARGV[1])
    membership[i-2] = memberScore
    if memberScore then
      local number = tonumber(memberScore)
      if not number or number < 0 or number > 9007199254740991 then
        return deny('CONTENT_UNSUPPORTED')
      end
      found = found + 1
      state = names[i-2]
      score = memberScore
    end
  end
end
if found ~= 1 then return deny('INCONSISTENT_STATE') end
if redis.call('STRLEN',KEYS[11]) > 128 then return deny('CONTENT_UNSUPPORTED') end
local locked = redis.call('EXISTS',KEYS[11]) == 1
local relations = {redis.call('SCARD',KEYS[12]),redis.call('HLEN',KEYS[13]),
  redis.call('HLEN',KEYS[14]),redis.call('ZCARD',KEYS[15])}
local values = redis.call('HMGET',KEYS[1],unpack(fields))
local time = redis.call('TIME')
local fingerprint = redis.sha1hex(cjson.encode({values,membership,meta,locked,relations}))
`

export const JOB_MEMBERSHIP_READ_LUA =
  JOB_MEMBERSHIP_GUARD_LUA +
  `
return {'observed',values,total,state,score,fingerprint,meta,locked and '1' or '0',relations,time}
`
