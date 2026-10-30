import { AsyncLocalStorage } from 'node:async_hooks'

import { Injectable } from '@nestjs/common'

import { ServiceUnavailableException } from '../../../common/exceptions/index.js'
import { AUTH_UNAVAILABLE_MESSAGE } from '../../../infrastructure/redis/auth-redis/auth-redis.constants.js'
import { isRedisUnavailable } from '../../../infrastructure/redis/redis-failure-classifier.js'

/** Starting values from the T082 plan; the integration measurements decide the final ones. */
export const AUTH_STAGE_MS = 1000
/**
 * Authorization stages one process may hold: active plus abandoned ones. A slot is reserved
 * synchronously at admission and released only when the workflow settles, never when the
 * caller gives up, so late database work stays counted and a burst cannot exceed the cap.
 */
export const AUTH_STAGE_CAP = 256

export { AUTH_UNAVAILABLE_MESSAGE }

const stageStorage = new AsyncLocalStorage<AuthBudget>()

/**
 * Deadline for one nested dependency call: its own cap, shortened to what is left of the
 * enclosing stage. Throws 503 when the stage is already over, so abandoned work cannot start
 * more ordinary calls. Outside a stage (public routes, tests) the cap applies unchanged.
 */
export function nestedDeadlineMs(capMs: number): number {
  const budget = stageStorage.getStore()
  if (!budget) return capMs
  budget.assertAlive()
  return Math.max(1, Math.min(capMs, Math.floor(budget.remainingMs())))
}

/** Throws 503 when the enclosing stage has expired; a no-op outside a stage. */
export function assertStageAlive(): void {
  stageStorage.getStore()?.assertAlive()
}

const unavailable = (): ServiceUnavailableException =>
  new ServiceUnavailableException(AUTH_UNAVAILABLE_MESSAGE)

/** Absolute deadline of one authorization stage, readable by every nested step. */
export class AuthBudget {
  private expired = false

  constructor(
    private readonly startedAt: number,
    readonly totalMs: number,
    private readonly now: () => number
  ) {}

  remainingMs(): number {
    return Math.max(0, this.totalMs - (this.now() - this.startedAt))
  }

  /** Continuations call this before starting more work; it does not interrupt an await. */
  assertAlive(): void {
    if (this.expired || this.remainingMs() <= 0) throw unavailable()
  }

  /** Terminal: an abandoned stage can never be revived. */
  expire(): void {
    this.expired = true
  }
}

/**
 * Owns the one budget around request admission (credential selection through the final
 * authorization guards). The caller gets a typed 503 at expiry and the handler never runs;
 * work that is still in flight settles in the background and is ignored. Redis outage
 * errors map to the same 503; every other error (genuine 401/403/409, programming errors)
 * passes through unchanged.
 */
@Injectable()
export class AuthStageService {
  private held = 0
  private readonly now = (): number => performance.now()

  run<T>(work: (budget: AuthBudget) => Promise<T>, totalMs = AUTH_STAGE_MS): Promise<T> {
    if (this.held >= AUTH_STAGE_CAP) return Promise.reject(unavailable())
    this.held++
    const budget = new AuthBudget(this.now(), totalMs, this.now)
    const issued = stageStorage.run(budget, () => work(budget))
    const release = (): void => {
      this.held--
    }
    issued.then(release, release)

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        budget.expire()
        reject(unavailable())
      }, totalMs)
      issued.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(isRedisUnavailable(error) ? unavailable() : error)
        }
      )
    })
  }

  /** Slots held by active and abandoned stages (diagnostics and tests). */
  heldCount(): number {
    return this.held
  }
}
