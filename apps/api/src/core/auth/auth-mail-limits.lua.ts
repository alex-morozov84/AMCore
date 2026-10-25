/** Single execution: no interleaving across the recipient, actor and cooldown budgets. */
export const AUTH_MAIL_RESERVE = `
local function counter(key, maximum)
  local t = redis.call('TYPE', key).ok
  if t == 'none' then return 0, 0 end
  if t ~= 'string' or redis.call('STRLEN', key) > 16 then return nil end
  local n = tonumber(redis.call('GET', key))
  local ttl = redis.call('PTTL', key)
  if not n or n < 0 or n > maximum or n % 1 ~= 0 or ttl <= 0 or ttl > 3600000 then return nil end
  return n, ttl
end
local count, ttl = counter(KEYS[1], 3)
if not count then return {-1, 0} end
local legacyCount, legacyTtl = 0, 0
if redis.call('EXISTS', KEYS[1]) == 0 and redis.call('EXISTS', KEYS[4]) == 1 then
  if redis.call('TYPE', KEYS[4]).ok ~= 'string' or redis.call('STRLEN', KEYS[4]) > 1024 then return {-1, 0} end
  local ok, v = pcall(cjson.decode, redis.call('GET', KEYS[4]))
  legacyTtl = redis.call('PTTL', KEYS[4])
  if not ok or type(v) ~= 'table' or type(v.value) ~= 'number' or type(v.expires) ~= 'number' or v.expires ~= v.expires or v.expires <= 0 or v.expires > 9007199254740991 or v.value < 0 or v.value > 3 or v.value % 1 ~= 0 or legacyTtl <= 0 or legacyTtl > 3600000 then return {-1, 0} end
  legacyCount = v.value
  count, ttl = legacyCount, legacyTtl
end
local actor, actorTtl, cooldown = 0, 0, 0
if ARGV[1] ~= 'public' then
  actor, actorTtl = counter(KEYS[2], 20)
  if not actor then return {-1, 0} end
  local t = redis.call('TYPE', KEYS[3]).ok
  if t ~= 'none' and t ~= 'string' then return {-1, 0} end
  if t ~= 'none' then
    if redis.call('STRLEN', KEYS[3]) > 1 or redis.call('GET', KEYS[3]) ~= '1' then return {-1, 0} end
    cooldown = redis.call('PTTL', KEYS[3])
    if cooldown <= 0 or cooldown > 60000 then return {-1, 0} end
  end
end
local delay = 0
if count >= 3 then delay = math.max(delay, ttl) end
if actor >= 20 then delay = math.max(delay, actorTtl) end
if cooldown > 0 then delay = math.max(delay, cooldown) end
if ARGV[1] == 'status' then
  if count >= 3 or actor >= 20 then return {0, math.max(1, math.ceil(delay/1000))} end
  if cooldown > 0 then return {2, math.max(1, math.ceil(cooldown/1000))} end
  return {1,0}
end
if legacyTtl > 0 then redis.call('SET', KEYS[1], tostring(legacyCount), 'PX', legacyTtl) end
if delay > 0 then return {0, math.max(1, math.ceil(delay/1000))} end
redis.call('SET', KEYS[1], tostring(count+1), 'PX', 3600000)
if ARGV[1] ~= 'public' then
  redis.call('SET', KEYS[2], tostring(actor+1), 'PX', 3600000)
  redis.call('SET', KEYS[3], '1', 'PX', 60000)
end
return {1, 0}
`

export const AUTH_MAIL_PREPARE = `
local t = redis.call('TYPE', KEYS[1]).ok
if t ~= 'none' and t ~= 'string' then return {-1,0} end
local raw = redis.call('GET',KEYS[1])
local n = tonumber(raw or '0')
if raw and (#raw > 16 or not n or n < 0 or n > 20 or n % 1 ~= 0) then return {-1,0} end
local ttl = redis.call('PTTL',KEYS[1])
if raw and (ttl <= 0 or ttl > 60000) then return {-1,0} end
if n >= 20 then return {0,math.max(1,math.ceil(ttl/1000))} end
if not raw then redis.call('SET',KEYS[1],'1','PX',60000)
else redis.call('INCR',KEYS[1]) end
return {1,0}
`
