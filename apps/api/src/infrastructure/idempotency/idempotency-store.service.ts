import { randomBytes } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { IDEMPOTENCY_KEY_PREFIX } from './idempotency.constants'
import type { CompletedIdempotencyRecord, IdempotencyReserveResult } from './idempotency.types'

import { REDIS_CLIENT } from '@/infrastructure/redis/redis.constants'
import type { AppRedisClient } from '@/infrastructure/redis/redis-connection.service'

const RESERVE_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then
  redis.call("SET", KEYS[1], cjson.encode({state="in_flight",ownerToken=ARGV[1],fingerprint=ARGV[2],startedAt=ARGV[3]}), "PX", ARGV[4], "NX")
  return {"started", ARGV[1]}
end
local decoded = cjson.decode(current)
if decoded.state == "completed" then
  if decoded.fingerprint == ARGV[2] then
    return {"replay", tostring(decoded.status), decoded.body, cjson.encode(decoded.headers)}
  end
  return {"mismatch"}
end
return {"conflict"}
`

const COMPLETE_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if decoded.state ~= "in_flight" then return 0 end
if decoded.ownerToken ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], cjson.encode({state="completed",fingerprint=ARGV[2],status=tonumber(ARGV[3]),body=ARGV[4],headers=cjson.decode(ARGV[5]),completedAt=ARGV[6]}), "EX", ARGV[7])
return 1
`

@Injectable()
export class IdempotencyStoreService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(IdempotencyStoreService.name)
  }

  async reserve(
    scope: string,
    key: string,
    fingerprint: string,
    lockTtlMs: number
  ): Promise<IdempotencyReserveResult> {
    const storageKey = `${IDEMPOTENCY_KEY_PREFIX}${scope}:${key}`
    const ownerToken = randomBytes(16).toString('base64url')
    const reply = (await this.redis.eval(RESERVE_SCRIPT, {
      keys: [storageKey],
      arguments: [ownerToken, fingerprint, String(Date.now()), String(lockTtlMs)],
    })) as [string, string?, string?, string?]

    return mapReserveReply(reply, storageKey)
  }

  async complete(
    storageKey: string,
    ownerToken: string,
    fingerprint: string,
    response: CompletedIdempotencyRecord,
    retentionSeconds: number
  ): Promise<boolean> {
    const reply = (await this.redis.eval(COMPLETE_SCRIPT, {
      keys: [storageKey],
      arguments: [
        ownerToken,
        fingerprint,
        String(response.status),
        response.body,
        JSON.stringify(response.headers),
        String(Date.now()),
        String(retentionSeconds),
      ],
    })) as number

    return reply === 1
  }

  async reset(): Promise<void> {
    for await (const keys of this.redis.scanIterator({
      MATCH: `${IDEMPOTENCY_KEY_PREFIX}*`,
      COUNT: 100,
    })) {
      if (keys.length > 0) await this.redis.unlink(keys)
    }
  }
}

function mapReserveReply(
  reply: [string, string?, string?, string?],
  storageKey: string
): IdempotencyReserveResult {
  const [kind, first, second, third] = reply
  if (kind === 'started' && first) return { kind, storageKey, ownerToken: first }
  if (kind === 'replay' && first && second && third) {
    return { kind, response: { status: Number(first), body: second, headers: JSON.parse(third) } }
  }
  return kind === 'mismatch' ? { kind } : { kind: 'conflict' }
}
