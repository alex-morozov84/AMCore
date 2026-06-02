/** Versioned namespace (ADR-027/ADR-039); old keys expire by TTL without FLUSHDB. */
export const KEY_PREFIX = 'throttle:v1:'

/**
 * Hot-path Redis budget. A slower reply (degraded, not down, Redis) degrades to
 * local in-memory limits rather than stalling every guarded request.
 */
export const REDIS_CALL_TIMEOUT_MS = 100

/** Debounce window for the "degraded" error log during a sustained outage. */
export const DEGRADE_LOG_INTERVAL_MS = 5_000

/**
 * Atomic fixed-window counter with a separate block key.
 *
 * KEYS[1]=counter, KEYS[2]=block. ARGV[1]=ttlMs, ARGV[2]=limit, ARGV[3]=blockMs.
 * Returns `{ totalHits, counterPttlMs, isBlocked(0|1), blockPttlMs }`.
 *
 * While a block is active it returns blocked WITHOUT incrementing the counter
 * and WITHOUT extending any expiry, matching @nestjs/throttler v6 in-memory
 * semantics (a sustained flood must not keep extending the block).
 *
 * When the limit is crossed it clamps the counter's expiry to
 * `min(remainingWindow, blockMs)` — shortened to the block when the block is
 * shorter (so `blockDuration < ttl` starts a fresh window once the block elapses,
 * matching v6's `totalHits` reset), but never extended past the original
 * fixed window when `blockDuration > ttl`. Fixed-window is an accepted
 * limitation; sliding-window-counter is the documented upgrade path (ADR-039).
 */
export const INCREMENT_SCRIPT = `
local blockPttl = redis.call('PTTL', KEYS[2])
if blockPttl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return {hits, redis.call('PTTL', KEYS[1]), 1, blockPttl}
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
end
if hits > tonumber(ARGV[2]) then
  local blockMs = tonumber(ARGV[3])
  redis.call('SET', KEYS[2], '1', 'PX', blockMs)
  local counterPttl = redis.call('PTTL', KEYS[1])
  if counterPttl < 0 or blockMs < counterPttl then
    redis.call('PEXPIRE', KEYS[1], blockMs)
    counterPttl = blockMs
  end
  return {hits, counterPttl, 1, blockMs}
end
return {hits, redis.call('PTTL', KEYS[1]), 0, 0}
`.trim()
