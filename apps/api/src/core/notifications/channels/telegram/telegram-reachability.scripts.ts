/**
 * Redis keys and scripts of the Telegram reachability check (Redis 7). Every key arrives through
 * `KEYS`, every value through `ARGV`; no script builds a key name. The shared hash tag keeps both
 * keys on one slot. It is a naming rule, not a claim of Redis Cluster support.
 */
const TAG = 'integrations:{telegram_check}'

export const telegramCheckKeys = {
  /** HASH: field = worker instance id, value = observation JSON. At most `maxWorkers` fields. */
  observations: `${TAG}:obs`,
  /** STRING `since:lastRefusedAt`: a worker's result could not be stored because the hash was full. */
  overflow: `${TAG}:overflow`,
} as const

const NOW = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
`

/**
 * KEYS: observations, overflow. ARGV: instanceId, value, observedAt, seq, retentionMs, maxWorkers,
 * maxWriteDelayMs. Returns `stored`, `late` or `overflow`.
 * Drops expired fields and fields without a readable time first (another damaged value stays
 * until its time passes retention; the reader reports it); refuses a write that arrives too late,
 * lies more than the allowed delay in the future or is older than this worker's stored one;
 * never evicts a stored worker to make room.
 */
export const WRITE_SCRIPT = `${NOW}
local retention = tonumber(ARGV[5])
local observedAt = tonumber(ARGV[3])
local maxDelay = tonumber(ARGV[7])
if now - observedAt > maxDelay or observedAt - now > maxDelay then return 'late' end
local fields = redis.call('HGETALL', KEYS[1])
local count = 0
local present = false
for i = 1, #fields, 2 do
  local ok, stored = pcall(cjson.decode, fields[i + 1])
  local at = ok and type(stored) == 'table' and tonumber(stored.observedAt) or nil
  if at == nil or at < now - retention then
    redis.call('HDEL', KEYS[1], fields[i])
  else
    count = count + 1
    if fields[i] == ARGV[1] then
      present = true
      local seq = tonumber(stored.seq)
      if seq == nil or seq >= tonumber(ARGV[4]) then return 'late' end
    end
  end
end
if not present and count >= tonumber(ARGV[6]) then
  local since = now
  local marker = redis.call('GET', KEYS[2])
  if marker then
    local first = tonumber(string.match(marker, '^(%d+):'))
    if first then since = first end
  end
  redis.call('SET', KEYS[2], since .. ':' .. now, 'PX', retention)
  return 'overflow'
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('PEXPIRE', KEYS[1], retention)
return 'stored'
`

/** KEYS: observations. ARGV: instanceId. A graceful stop removes the worker's own result. */
export const DELETE_SCRIPT = `
return redis.call('HDEL', KEYS[1], ARGV[1])
`

/**
 * KEYS: observations, overflow. Read-only. One atomic snapshot: `{ now, marker, field, value, … }`
 * (`marker` is an empty string when absent). The reader judges age against this `now`.
 */
export const READ_SCRIPT = `${NOW}
local reply = { tostring(now), redis.call('GET', KEYS[2]) or '' }
local fields = redis.call('HGETALL', KEYS[1])
for i = 1, #fields do reply[#reply + 1] = fields[i] end
return reply
`
