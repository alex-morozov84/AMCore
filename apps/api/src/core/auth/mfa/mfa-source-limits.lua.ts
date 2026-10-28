/** Bounded sliding window; Redis time and one atomic decision shared across replicas. */
export const MFA_SOURCE_LIMIT_SCRIPT = `
local kind, member = string.match(ARGV[1], '^(%a+):([%x%-]+)$')
local limit, window
if kind == 'verify' then limit = 30; window = 900000
elseif kind == 'start' then limit = 20; window = 600000
else return {-1, 0} end
if not member or string.len(member) ~= 36 then return {-1, 0} end
local clock = redis.call('TIME')
local actual = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local now = actual
local stored = redis.call('TYPE', KEYS[1]).ok
if stored ~= 'none' and stored ~= 'zset' then return {-1, 0} end
if stored == 'zset' then
  if redis.call('PTTL', KEYS[1]) < 0 or redis.call('ZCARD', KEYS[1]) > limit then return {-1, 0} end
  local rows = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
  for i = 2, #rows, 2 do
    local score = tonumber(rows[i])
    if not score or score < 0 or score > 9007199254740991 or score ~= math.floor(score) then return {-1, 0} end
    now = math.max(now, score)
  end
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
if redis.call('ZCARD', KEYS[1]) >= limit then
  local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, math.max(1, math.ceil((tonumber(first[2]) + window - actual) / 1000))}
end
redis.call('ZADD', KEYS[1], now, member)
redis.call('PEXPIRE', KEYS[1], window + now - actual)
return {1, 0}
`
