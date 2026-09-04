/**
 * Versioned namespace (ADR-027/ADR-039), distinct from the deleted
 * `throttle:v1:*` fixed-window keyspace — old keys expire by TTL on their
 * own, no migration/flush needed.
 */
export const KEY_PREFIX = 'ratelimit:v1:'

/**
 * Hot-path Redis budget. A slower reply (degraded, not down, Redis) degrades
 * to the local in-memory limiter rather than stalling every guarded request.
 */
export const REDIS_CALL_TIMEOUT_MS = 100

/** Debounce window for the "degraded" error log during a sustained outage. */
export const DEGRADE_LOG_INTERVAL_MS = 5_000

/**
 * GCRA (Generic Cell Rate Algorithm) admission check, adapted from
 * `rwz/redis-gcra`/Brandur Leach's `throttled`. One stored value per key — a
 * "theoretical arrival time" (TAT), not a tokens-float + timestamp pair — so
 * there's no rounding-error accumulation, `Retry-After`/reset fall out of
 * the math directly, and the key's own PTTL equals its reset time (idle
 * visitors' keys self-delete, no sweep needed).
 *
 * KEYS[1] = bucket key.
 * ARGV[1] = rate (requests per period), ARGV[2] = period (ms),
 * ARGV[3] = burst (max instantly admitted from idle, >= 1),
 * ARGV[4] = cost (default 1; reserved for future weighted requests).
 *
 * Returns `{ allowed(0|1), remaining, retryAfterMs, resetAfterMs }`.
 * A refused request (`diff < 0`) never writes to Redis — the stored TAT is
 * untouched, so N consecutive refusals return a monotonically *decreasing*
 * `retryAfterMs`, never a growing one (a refusal must never look like
 * penalty stacking — the exact mechanism that turns a burst into a
 * lockout).
 */
export const GCRA_SCRIPT = `
local rate, period, burst, cost = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local emission  = period / rate           -- ms per request at the sustained rate
local increment = emission * cost
local t   = redis.call('TIME')            -- ONE clock shared by every replica —
local now = t[1] * 1000 + math.floor(t[2] / 1000)  -- NEVER Date.now() from the
                                                      -- caller: N replicas have N
                                                      -- clocks, and a skew between
                                                      -- pods is a direct error in
                                                      -- the admission decision.
local tat = tonumber(redis.call('GET', KEYS[1])) or now
local newTat  = math.max(tat, now) + increment
local allowAt = newTat - emission * burst
local diff    = now - allowAt             -- >= 0  -> admit
if diff < 0 then
  local retryAfter = (increment <= emission * burst) and -diff or -1  -- -1: cost can never fit
  return {0, 0, math.ceil(retryAfter), math.ceil(math.max(0, tat - now))}
end
local resetAfter = newTat - now           -- time until the bucket is idle-full again
redis.call('SET', KEYS[1], newTat, 'PX', math.ceil(resetAfter))
return {1, math.floor(diff / emission), -1, math.ceil(resetAfter)}
`.trim()
