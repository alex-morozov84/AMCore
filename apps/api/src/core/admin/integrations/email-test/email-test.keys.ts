/**
 * The only place that builds the Redis key names of the operator email test. Scripts receive
 * every key through `KEYS`; none is built inside Lua. The shared hash tag keeps the keys of one
 * script on one hash slot. It is a naming rule, not a claim of Redis Cluster support.
 */
const TAG = 'integrations:{email_test}'

export const emailTestKeys = {
  attempt: (attemptId: string): string => `${TAG}:attempt:${attemptId}`,
  actor: (actorId: string): string => `${TAG}:actor:${actorId}`,
  cooldown: (actorId: string): string => `${TAG}:cooldown:${actorId}`,
  last: `${TAG}:last`,
  quota: `${TAG}:quota`,
  lease: `${TAG}:lease`,
} as const
