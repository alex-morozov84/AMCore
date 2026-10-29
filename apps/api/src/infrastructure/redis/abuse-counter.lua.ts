/**
 * Shared validator for both scripts. A counter is a canonical decimal integer string
 * that expires: any other shape, a wrong Redis type or a live key without expiry is
 * refused (nil), never read as zero. Lua patterns have no alternation, hence two checks.
 *
 * The ceiling is 10^15, far above any limit, and deliberately below 2^53 - 1: a probe of
 * node-redis 5.12.1 decoded the integer reply 9007199254740991 as 9007199254740992, so
 * the top of the double range does not round-trip through the client exactly.
 */
const COUNTER_VALIDATION = `
local MAX = 1000000000000000
local function counter(key)
  local kind = redis.call('TYPE', key).ok
  if kind == 'none' then return 0 end
  if kind ~= 'string' then return nil end
  if redis.call('PTTL', key) < 0 then return nil end
  local raw = redis.call('GET', key)
  if not raw or string.len(raw) > 16 then return nil end
  if raw ~= '0' and not string.match(raw, '^[1-9]%d*$') then return nil end
  local value = tonumber(raw)
  if not value or value > MAX then return nil end
  return value
end
if #KEYS ~= 2 or KEYS[1] == KEYS[2] then return {-1, -1} end
local first = counter(KEYS[1])
local second = counter(KEYS[2])
if first == nil or second == nil then return {-1, -1} end
`

/** Read-only: returns both counts, or {-1, -1}. Never writes and never renews an expiry. */
export const ABUSE_COUNTER_READ_SCRIPT = `${COUNTER_VALIDATION}
return {first, second}
`

/**
 * ARGV[1] is the expiry in milliseconds. Both keys are validated, and the results
 * checked for overflow, before the first write, so a bad second key never leaves a
 * half-applied first key. The two writes are adjacent; Redis scripts are isolated but
 * not rolled back, so a failure between them (for example memory pressure) can still
 * leave one write applied.
 */
export const ABUSE_COUNTER_INCREMENT_SCRIPT = `${COUNTER_VALIDATION}
local ttl = tonumber(ARGV[1])
if #ARGV ~= 1 or not ttl or ttl < 1 or ttl > 86400000 or ttl ~= math.floor(ttl) then return {-1, -1} end
if first >= MAX or second >= MAX then return {-1, -1} end
first = first + 1
second = second + 1
local px = string.format('%.0f', ttl)
redis.call('SET', KEYS[1], string.format('%.0f', first), 'PX', px)
redis.call('SET', KEYS[2], string.format('%.0f', second), 'PX', px)
return {first, second}
`
