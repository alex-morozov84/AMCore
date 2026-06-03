import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { RedisLockService } from '@/infrastructure/redis'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown'
}

/**
 * Singleton-cron runner (EQS-05, generalized for ADR-041).
 *
 * Runs `task` on exactly one replica using a Redis lock: every replica fires its
 * `@Cron`, but only the lock-winner runs the task; the rest skip. Fail-closed —
 * a lock-acquire failure skips the run. Neither a task error nor a lock-release
 * failure ever escapes (the next scheduled run retries; the lock TTL expires a
 * stuck key, so a crashed holder never blocks future runs).
 *
 * Emits stable log events prefixed with `name`:
 * `${name}_lock_failed`, `${name}_skipped`, `${name}_failed`,
 * `${name}_lock_release_failed`. Reuse this for any future scheduled job instead
 * of re-implementing the lock dance.
 */
@Injectable()
export class SingletonCronRunner {
  constructor(
    private readonly lock: RedisLockService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(SingletonCronRunner.name)
  }

  async run(
    options: { name: string; lockKey: string; ttlMs: number },
    task: () => Promise<void>
  ): Promise<void> {
    const { name, lockKey, ttlMs } = options

    let token: string | null
    try {
      token = await this.lock.acquire(lockKey, ttlMs)
    } catch (error) {
      this.logger.error(
        { event: `${name}_lock_failed`, error: errorMessage(error) },
        `${name} skipped — lock acquisition failed`
      )
      return
    }

    if (token === null) {
      this.logger.info(
        { event: `${name}_skipped` },
        `${name} skipped — lock held by another instance`
      )
      return
    }

    try {
      await task()
    } catch (error) {
      this.logger.error({ event: `${name}_failed`, error: errorMessage(error) }, `${name} failed`)
    } finally {
      try {
        await this.lock.release(lockKey, token)
      } catch (error) {
        this.logger.error(
          { event: `${name}_lock_release_failed`, error: errorMessage(error) },
          `${name} lock release failed (TTL will expire it)`
        )
      }
    }
  }
}
