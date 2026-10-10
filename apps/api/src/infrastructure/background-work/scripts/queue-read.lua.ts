/** Fixed-size observation; queue lengths are counts, never a job-membership traversal. */
export const QUEUE_READ_LUA = `
local function deny(code) return {'unavailable', code} end
local expected = {'hash','list','list','list','zset','zset','zset','stream'}
local kinds = {}
for i=1,8 do
  kinds[i] = redis.call('TYPE', KEYS[i]).ok
  if kinds[i] ~= 'none' and kinds[i] ~= expected[i] then
    return deny('CONTENT_UNSUPPORTED')
  end
end
if kinds[1] ~= 'hash' or redis.call('HLEN', KEYS[1]) > 64 then
  return deny('METADATA_UNAVAILABLE')
end
local fields = {'amQueueEpoch','amControlRevision','amProtocol','paused'}
for _,field in ipairs(fields) do
  if redis.call('HSTRLEN', KEYS[1], field) > 128 then
    return deny('CONTENT_UNSUPPORTED')
  end
end
local meta = redis.call('HMGET', KEYS[1], unpack(fields))
local revision = tonumber(meta[2])
if not meta[1] or meta[3] ~= '1' or not revision or revision < 0 or
  revision > 9007199254740991 or revision ~= math.floor(revision) or
  (meta[4] and meta[4] ~= '1') then return deny('CONTENT_UNSUPPORTED') end
local paused = meta[4] and '1' or '0'
local layout = 'modern'
if kinds[3] == 'list' then
  layout = kinds[2] == 'none' and paused == '1' and 'legacy-paused-only' or 'legacy-mixed'
end
local time = redis.call('TIME')
return {'observed',meta[1],meta[2],paused,layout,time,
  redis.call('LLEN',KEYS[2]),redis.call('LLEN',KEYS[3]),redis.call('LLEN',KEYS[4]),
  redis.call('ZCARD',KEYS[5]),redis.call('ZCARD',KEYS[6])}
`
