/** Shared validation text also drives the deterministic expiry harness. */
export const LOGIN_LIMIT_VALIDATION = `
local MAX = 9007199254740991
local ttls = {86400000, 3600000, 900000}
local function integer(n)
  return type(n) == 'number' and n >= 0 and n <= MAX and n == math.floor(n)
end
local function read(key, ttl, block, now)
  local kind = redis.call('TYPE', key).ok
  local remaining = redis.call('PTTL', key)
  if remaining == -2 then return 0 end
  if kind ~= 'string' or remaining < 0 or remaining > ttl then return nil end
  local raw = redis.call('GET', key)
  if not raw or string.len(raw) > 1024 then return nil end
  local ok, item = pcall(cjson.decode, raw)
  if not ok or type(item) ~= 'table' or not integer(item.value) or not integer(item.expires) then return nil end
  local fields = 0
  for k, v in pairs(item) do
    if k ~= 'value' and k ~= 'expires' then return nil end
    fields = fields + 1
  end
  if fields ~= 2 or (block and item.value ~= 1) then return nil end
  if now > item.expires then return 0 end
  return item.value
end
local function envelope(value, expires)
  return '{"value":' .. string.format('%.0f', value) .. ',"expires":' .. string.format('%.0f', expires) .. '}'
end
`

/** Closed operations, bounded reads, full validation and serialization before writes. */
export const LOGIN_LIMIT_SCRIPT =
  LOGIN_LIMIT_VALIDATION +
  `
local mode = ARGV[1]
local now = tonumber(ARGV[2])
if #KEYS ~= 3 or #ARGV ~= 2 or not integer(now) then return {-1, 0} end
if mode ~= 'check' and mode ~= 'consume' and mode ~= 'reset' then return {-1, 0} end
local counts = {}
for i = 1, 3 do
  if not integer(now + ttls[i]) then return {-1, 0} end
  counts[i] = read(KEYS[i], ttls[i], i == 3, now)
  if counts[i] == nil then return {-1, 0} end
end
if mode == 'check' then
  if counts[3] == 1 then return {0, 900} end
  if counts[1] >= 100 then return {0, 86400} end
  return {1, 0}
end
if mode == 'reset' then
  redis.call('DEL', KEYS[2], KEYS[3])
  return {1, 0}
end
local ip = counts[1] + 1
local pair = counts[2] + 1
if not integer(ip) or not integer(pair) then return {-1, 0} end
local a = envelope(ip, now + ttls[1])
local b = envelope(pair, now + ttls[2])
local c = envelope(1, now + ttls[3])
redis.call('SET', KEYS[1], a, 'PX', ttls[1])
redis.call('SET', KEYS[2], b, 'PX', ttls[2])
if pair >= 5 then redis.call('SET', KEYS[3], c, 'PX', ttls[3]) end
return {1, 0}
`
