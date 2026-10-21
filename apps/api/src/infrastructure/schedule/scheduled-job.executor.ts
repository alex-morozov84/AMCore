import { Injectable } from '@nestjs/common'

import {
  cadenceOf,
  failed,
  type ScheduledJobDefinition,
  type ScheduledJobResult,
} from './scheduled-job.js'
import { ScheduledJobRecorder } from './scheduled-job-recorder.js'
import { SingletonCronRunner } from './singleton-cron.runner.js'

/**
 * Runs a scheduled job's task and records what it reports. Scheduling, locking and DB claims keep
 * their existing behavior: the executor adds a start and a finish record around the task and
 * nothing else. The task must return its outcome explicitly; a resolved promise is not success.
 */
@Injectable()
export class ScheduledJobExecutor {
  constructor(
    private readonly recorder: ScheduledJobRecorder,
    private readonly singleton: SingletonCronRunner
  ) {}

  async run(
    definition: ScheduledJobDefinition,
    task: () => Promise<ScheduledJobResult>
  ): Promise<void> {
    const { lock } = definition
    if (definition.family === 'per-replica' || !lock) {
      await this.execute(definition, task)
      return
    }
    const outcome = await this.singleton.run(
      { name: lock.logName, lockKey: lock.key, ttlMs: lock.ttlMs },
      () => this.execute(definition, task)
    )
    // Losing the lock race ('contended') is normal and is not recorded.
    if (outcome.status === 'lock_unavailable') this.recorder.skip(definition, 'lock_unavailable')
  }

  private async execute(
    definition: ScheduledJobDefinition,
    task: () => Promise<ScheduledJobResult>
  ): Promise<void> {
    const run = this.recorder.begin(definition)
    let result: ScheduledJobResult
    try {
      result = await task()
    } catch (error) {
      this.recorder.finish(definition, run, failed(errorCode(error)))
      throw error
    }
    // Daily jobs keep a run row open until it finishes; a skip would leave it unexplained.
    if ('skipped' in result && cadenceOf(definition) === 'daily') result = failed('invalid_result')
    this.recorder.finish(definition, run, result)
  }
}

/**
 * The error classes a job may report by name. The list is closed on purpose: a name outside it is
 * reported as `unexpected`, because a class name chosen by a library or by user input could carry
 * content. A job that needs a domain code returns `failed('its_code')` itself.
 */
export const SAFE_ERROR_CODES: ReadonlySet<string> = new Set([
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientInitializationError',
  'PrismaClientValidationError',
  'PrismaClientRustPanicError',
  'DatabaseError',
  'TimeoutError',
  'AbortError',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'AppException',
  'HttpException',
])

/** A code from a closed list: never a message and never an arbitrary name. */
export function errorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  return SAFE_ERROR_CODES.has(name) ? name : 'unexpected'
}
