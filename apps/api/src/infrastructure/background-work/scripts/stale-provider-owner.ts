import type { Redis } from 'ioredis'

/** Read-only proof: current claim differs from the retained provider invocation. */
export async function proveStaleProviderOwner(
  client: Redis,
  jobKey: string,
  token: string,
  incarnation: string,
  attempt: string
): Promise<boolean> {
  const result = await client.eval(
    `
    if redis.call('TYPE',KEYS[1]).ok ~= 'hash' or
      redis.call('GET',KEYS[2]) ~= ARGV[1] or redis.call('PTTL',KEYS[2]) < 2000 then return 0 end
    if redis.call('HGET',KEYS[1],'amIncarnation') ~= ARGV[2] or
      redis.call('HGET',KEYS[1],'amEffectAttempt') ~= ARGV[3] then return 0 end
    local metadata = redis.call('HGET',KEYS[1],'amMetadata')
    if not metadata or #metadata > 2048 then return 0 end
    local ok,m = pcall(cjson.decode,metadata)
    if not ok or m.invocationId ~= ARGV[3] then return 0 end
    return 1`,
    2,
    jobKey,
    `${jobKey}:lock`,
    token,
    incarnation,
    attempt
  )
  return result === 1
}
