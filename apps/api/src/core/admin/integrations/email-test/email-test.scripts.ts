/**
 * Atomic transitions of the operator email test (Redis 7). Every key arrives through `KEYS`,
 * every value through `ARGV`; no script builds a key name. `now` is Redis `TIME`, the single time
 * authority of the feature. The lifecycle is documented in the integrations guide.
 */
const NOW = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
`

/** KEYS: actor. ARGV: newId, recipientToken, scopeWitness, issueTtlMs, actorTtlMs. Replaces any earlier issue. */
export const PREPARE_SCRIPT = `${NOW}
local issuedId = redis.call('HGET', KEYS[1], 'issuedId')
local issuedAt = tonumber(redis.call('HGET', KEYS[1], 'issuedAt') or '0')
local ttl = tonumber(ARGV[4])
if issuedId and (now - issuedAt) < ttl
  and redis.call('HGET', KEYS[1], 'issuedToken') == ARGV[2]
  and redis.call('HGET', KEYS[1], 'issuedWitness') == ARGV[3] then
  return { issuedId, issuedAt + ttl }
end
redis.call('HSET', KEYS[1], 'issuedId', ARGV[1], 'issuedToken', ARGV[2],
  'issuedWitness', ARGV[3], 'issuedAt', now)
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return { ARGV[1], now + ttl }
`

/**
 * KEYS: attempt, actor, last, cooldown, quota, lease.
 * ARGV: id, actorId, recipientToken, scopeWitness, leaseToken, provider, cooldownMs, hourlyCap,
 *       leaseMs, issueTtlMs, deadlineMs, attemptTtlMs, lastTtlMs, actorTtlMs.
 * Replay, issue check, admission and reservation are one script: a stalled caller cannot hold an
 * older lease and then replace the latest observation.
 */
export const RESERVE_SCRIPT = `${NOW}
if redis.call('EXISTS', KEYS[1]) == 1 then
  if redis.call('HGET', KEYS[1], 'actorId') ~= ARGV[2] then return { 'MISMATCH' } end
  local stored = redis.call('HGETALL', KEYS[1])
  table.insert(stored, 1, 'REPLAY')
  return stored
end
local issuedId = redis.call('HGET', KEYS[2], 'issuedId')
local issuedAt = tonumber(redis.call('HGET', KEYS[2], 'issuedAt') or '0')
if issuedId ~= ARGV[1] or (now - issuedAt) > tonumber(ARGV[10]) then return { 'EXPIRED' } end
if redis.call('HGET', KEYS[2], 'issuedToken') ~= ARGV[3] then return { 'RECIPIENT_CHANGED' } end
if redis.call('HGET', KEYS[2], 'issuedWitness') ~= ARGV[4] then return { 'CONFIG_CHANGED' } end
local bucket = math.floor(now / 3600000)
local quotaBucket = tonumber(redis.call('HGET', KEYS[5], 'bucket') or '-1')
local count = 0
if quotaBucket == bucket then count = tonumber(redis.call('HGET', KEYS[5], 'count') or '0') end
if count >= tonumber(ARGV[8]) then return { 'LIMIT' } end
local cooldown = redis.call('PTTL', KEYS[4])
if cooldown > 0 then return { 'COOLDOWN', cooldown } end
if redis.call('EXISTS', KEYS[6]) == 1 then return { 'BUSY' } end
redis.call('HDEL', KEYS[2], 'issuedId', 'issuedToken', 'issuedWitness', 'issuedAt')
redis.call('SET', KEYS[4], '1', 'PX', ARGV[7])
redis.call('HSET', KEYS[5], 'bucket', bucket, 'count', count + 1)
redis.call('PEXPIRE', KEYS[5], 7200000)
redis.call('SET', KEYS[6], ARGV[5], 'PX', ARGV[9])
redis.call('HSET', KEYS[1], 'actorId', ARGV[2], 'recipientToken', ARGV[3], 'scopeWitness', ARGV[4],
  'provider', ARGV[6], 'state', 'reserved', 'outcome', '', 'class', '', 'reservedAt', now,
  'sentAt', 0, 'deadlineMs', ARGV[11], 'deadlineAt', 0, 'settledAt', 0)
redis.call('PEXPIRE', KEYS[1], ARGV[12])
redis.call('DEL', KEYS[3])
redis.call('HSET', KEYS[3], 'attemptId', ARGV[1], 'state', 'reserved', 'outcome', '', 'class', '',
  'provider', ARGV[6], 'reservedAt', now, 'sentAt', 0, 'deadlineAt', 0, 'settledAt', 0,
  'scopeWitness', ARGV[4])
redis.call('PEXPIRE', KEYS[3], ARGV[13])
redis.call('HSET', KEYS[2], 'attempt', ARGV[1])
redis.call('PEXPIRE', KEYS[2], ARGV[14])
return { 'RESERVED', now }
`

/** KEYS: attempt, last, lease. ARGV: id, leaseToken. Starts the single deadline budget. */
export const MARK_SENDING_SCRIPT = `${NOW}
if redis.call('HGET', KEYS[1], 'state') ~= 'reserved' then return { 'BAD_STATE' } end
if redis.call('GET', KEYS[3]) ~= ARGV[2] then return { 'LEASE_LOST' } end
local deadlineAt = now + tonumber(redis.call('HGET', KEYS[1], 'deadlineMs'))
redis.call('HSET', KEYS[1], 'state', 'sending', 'sentAt', now, 'deadlineAt', deadlineAt)
if redis.call('HGET', KEYS[2], 'attemptId') == ARGV[1] then
  redis.call('HSET', KEYS[2], 'state', 'sending', 'sentAt', now, 'deadlineAt', deadlineAt)
end
return { 'OK', deadlineAt }
`

/**
 * KEYS: attempt, last, lease. ARGV: id, leaseToken, class.
 * Only for an attempt that provably did not call the transport.
 */
export const FAIL_BEFORE_SEND_SCRIPT = `${NOW}
local state = redis.call('HGET', KEYS[1], 'state')
if redis.call('GET', KEYS[3]) == ARGV[2] then redis.call('DEL', KEYS[3]) end
if state ~= 'reserved' and state ~= 'sending' then return { 'NOOP' } end
redis.call('HSET', KEYS[1], 'state', 'settled', 'outcome', 'not_started', 'class', ARGV[3],
  'settledAt', now)
if redis.call('HGET', KEYS[2], 'attemptId') == ARGV[1] then
  redis.call('HSET', KEYS[2], 'state', 'settled', 'outcome', 'not_started', 'class', ARGV[3],
    'settledAt', now)
end
return { 'OK' }
`

/**
 * KEYS: attempt, last, lease. ARGV: id, leaseToken, outcome, class.
 * One terminal transition, only from sending. A result that arrives after the stored deadline is
 * kept as unknown even when the caller's own timer has not fired. The latest observation is
 * touched only for the same attempt and is never recreated.
 */
export const SETTLE_SCRIPT = `${NOW}
local state = redis.call('HGET', KEYS[1], 'state')
if redis.call('GET', KEYS[3]) == ARGV[2] then redis.call('DEL', KEYS[3]) end
if state ~= 'sending' then return { 'NOOP' } end
local outcome = ARGV[3]
local class = ARGV[4]
local deadlineAt = tonumber(redis.call('HGET', KEYS[1], 'deadlineAt') or '0')
if now > deadlineAt and outcome ~= 'unknown' then
  outcome = 'unknown'
  class = 'deadline'
end
redis.call('HSET', KEYS[1], 'state', 'settled', 'outcome', outcome, 'class', class, 'settledAt', now)
if redis.call('HGET', KEYS[2], 'attemptId') == ARGV[1] then
  redis.call('HSET', KEYS[2], 'state', 'settled', 'outcome', outcome, 'class', class,
    'settledAt', now)
end
return { 'OK', outcome, class }
`

export const EMAIL_TEST_SCRIPTS = {
  prepare: PREPARE_SCRIPT,
  reserve: RESERVE_SCRIPT,
  markSending: MARK_SENDING_SCRIPT,
  failBeforeSend: FAIL_BEFORE_SEND_SCRIPT,
  settle: SETTLE_SCRIPT,
} as const
