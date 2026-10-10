/** Private frozen request and bounded expiry accounting commit atomically with its job marker. */
export const PREPARED_BODY_LUA = `
local function deny(code) return {'unavailable',code} end
local function integer(value)
  local n = tonumber(value)
  if not n or n < 0 or n > 9007199254740991 or n ~= math.floor(n) then return nil end
  return n
end
local types = {'hash','string','hash','zset','hash','string'}
for i=1,6 do
  local kind = redis.call('TYPE',KEYS[i]).ok
  if kind ~= 'none' and kind ~= types[i] then return deny('CONTENT_UNSUPPORTED') end
end
if redis.call('TYPE',KEYS[1]).ok ~= 'hash' or redis.call('HLEN',KEYS[1]) > 64 then
  return deny('HISTORY_EXPIRED')
end
if redis.call('STRLEN',KEYS[2]) > 128 or redis.call('GET',KEYS[2]) ~= ARGV[2] or
  redis.call('PTTL',KEYS[2]) < 2000 then return deny('STATE_CHANGED') end
if redis.call('HSTRLEN',KEYS[1],'data') > 32768 then return deny('CONTENT_UNSUPPORTED') end
local ok,envelope = pcall(cjson.decode,redis.call('HGET',KEYS[1],'data') or '')
if not ok or type(envelope) ~= 'table' or envelope.protocolVersion ~= 1 or
  envelope.incarnation ~= ARGV[1] then return deny('VERSION_UNSUPPORTED') end
local fields = {'amRequestPrepared','amRequestDigest','amProviderScope','amRequestExpiresAt'}
local limits = {1,64,64,128}
for i,field in ipairs(fields) do
  if redis.call('HSTRLEN',KEYS[1],field) > limits[i] then return deny('CONTENT_UNSUPPORTED') end
end
local prepared = redis.call('HMGET',KEYS[1],unpack(fields))
if redis.call('HLEN',KEYS[3]) > 2 or redis.call('HSTRLEN',KEYS[3],'bytes') > 128 or
  redis.call('HSTRLEN',KEYS[3],'count') > 128 then return deny('CONTENT_UNSUPPORTED') end
local count = integer(redis.call('HGET',KEYS[3],'count') or '0')
local bytes = integer(redis.call('HGET',KEYS[3],'bytes') or '0')
if not count or not bytes or count > 1024 or bytes > 67108864 or
  redis.call('ZCARD',KEYS[4]) ~= count or redis.call('HLEN',KEYS[5]) ~= count then
  return deny('CONTENT_UNSUPPORTED')
end
local time = redis.call('TIME')
local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
if redis.call('HSTRLEN',KEYS[5],ARGV[1]) > 512 then return deny('CONTENT_UNSUPPORTED') end
local reservation = redis.call('HGET',KEYS[5],ARGV[1])
if prepared[1] then
  if prepared[1] ~= '1' or not prepared[2] or not prepared[3] then
    return deny('CONTENT_UNSUPPORTED')
  end
  if prepared[3] ~= ARGV[4] then return deny('PROVIDER_CHANGED') end
  local expires = integer(prepared[4])
  if not expires or expires <= now or not reservation or redis.call('EXISTS',KEYS[6]) == 0 then
    return deny('REQUEST_EXPIRED')
  end
  local decoded,entry = pcall(cjson.decode,reservation)
  if not decoded or type(entry) ~= 'table' or entry.digest ~= prepared[2] or
    entry.scope ~= prepared[3] or entry.jobId ~= ARGV[8] or entry.expires ~= expires or not integer(entry.size) or
    entry.size > 131072 or tonumber(redis.call('ZSCORE',KEYS[4],ARGV[1])) ~= expires or
    redis.call('STRLEN',KEYS[6]) ~= entry.size then return deny('CONTENT_UNSUPPORTED') end
  return {'prepared',redis.call('GET',KEYS[6]),prepared[2],prepared[3],tostring(expires)}
end
if prepared[2] or prepared[3] or prepared[4] or reservation or
  redis.call('ZSCORE',KEYS[4],ARGV[1]) or redis.call('EXISTS',KEYS[6]) == 1 then
  return deny('METADATA_UNAVAILABLE')
end
if ARGV[3] == 'read' then return {'missing'} end
if ARGV[3] ~= 'prepare' or #ARGV[5] < 1 or #ARGV[5] > 131072 or
  #ARGV[4] ~= 64 or #ARGV[6] ~= 64 then return deny('CONTENT_UNSUPPORTED') end
if redis.call('HLEN',KEYS[1]) > 60 then return deny('CONTENT_UNSUPPORTED') end
local expired = redis.call('ZRANGEBYSCORE',KEYS[4],'-inf',now,'LIMIT',0,64,'WITHSCORES')
local reclaim = {}
local reclaimedBytes = 0
for i=1,#expired,2 do
  local id = expired[i]
  local expiry = integer(expired[i+1])
  if #id ~= 36 or not string.match(id,'^[a-f0-9-]+$') or not expiry or
    redis.call('HSTRLEN',KEYS[5],id) > 512 then return deny('CONTENT_UNSUPPORTED') end
  local decoded,entry = pcall(cjson.decode,redis.call('HGET',KEYS[5],id) or '')
  if not decoded or type(entry) ~= 'table' or type(entry.jobId) ~= 'string' or
    #entry.jobId < 1 or #entry.jobId > 128 or not string.match(entry.jobId,'^[%w_-]+$') then
    return deny('CONTENT_UNSUPPORTED')
  end
  local bodyKey = ARGV[7]..entry.jobId..':am-request:'..id
  local kind = redis.call('TYPE',bodyKey).ok
  if kind ~= 'none' and kind ~= 'string' then return deny('CONTENT_UNSUPPORTED') end
  if not decoded or type(entry) ~= 'table' or not integer(entry.size) or entry.size > 131072 or
    entry.expires ~= expiry or redis.call('STRLEN',bodyKey) > 131072 then
    return deny('CONTENT_UNSUPPORTED')
  end
  reclaimedBytes = reclaimedBytes + entry.size
  table.insert(reclaim,{id=id,key=bodyKey})
end
local nextCount = count - #reclaim + 1
local nextBytes = bytes - reclaimedBytes + #ARGV[5]
if count < #reclaim or bytes < reclaimedBytes then return deny('CONTENT_UNSUPPORTED') end
if nextCount > 1024 or nextBytes > 67108864 then return deny('STORAGE_LIMIT') end
local expires = now + 86400000
local encoded = cjson.encode({size=#ARGV[5],expires=expires,digest=ARGV[6],scope=ARGV[4],jobId=ARGV[8]})
if #encoded > 512 then return deny('CONTENT_UNSUPPORTED') end
-- FIRST WRITE: denied admission never hides a partial expiry sweep or a new preparation marker.
for _,entry in ipairs(reclaim) do
  redis.call('ZREM',KEYS[4],entry.id)
  redis.call('HDEL',KEYS[5],entry.id)
  redis.call('UNLINK',entry.key)
end
redis.call('SET',KEYS[6],ARGV[5],'PX',86400000)
redis.call('ZADD',KEYS[4],expires,ARGV[1])
redis.call('HSET',KEYS[5],ARGV[1],encoded)
redis.call('HSET',KEYS[3],'count',nextCount,'bytes',nextBytes)
redis.call('HSET',KEYS[1],'amRequestPrepared','1','amRequestDigest',ARGV[6],
  'amProviderScope',ARGV[4],'amRequestExpiresAt',expires)
return {'prepared',ARGV[5],ARGV[6],ARGV[4],tostring(expires)}
`
