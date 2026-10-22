import { failed, partial, skippedFor, succeeded } from './scheduled-job'
import { errorCode, SAFE_ERROR_CODES, ScheduledJobExecutor } from './scheduled-job.executor'
import type { ScheduledJobRecorder } from './scheduled-job-recorder'
import { CLEANUP_JOB, NOTIFICATION_RECOVERY_JOB } from './scheduled-jobs.catalogue'
import type { SingletonCronRunner, SingletonRun } from './singleton-cron.runner'

describe('ScheduledJobExecutor', () => {
  const run = { runId: 'run-1' }
  let recorder: { begin: jest.Mock; finish: jest.Mock; skip: jest.Mock }
  let singleton: { run: jest.Mock }
  let executor: ScheduledJobExecutor

  beforeEach(() => {
    recorder = { begin: jest.fn().mockReturnValue(run), finish: jest.fn(), skip: jest.fn() }
    // Behave like the lock was won: run the task and report it as ran.
    singleton = {
      run: jest.fn(
        async (_options, task: () => Promise<unknown>): Promise<SingletonRun<unknown>> => {
          try {
            return { status: 'ran', value: await task() }
          } catch (error) {
            return { status: 'failed', error }
          }
        }
      ),
    }
    executor = new ScheduledJobExecutor(
      recorder as unknown as ScheduledJobRecorder,
      singleton as unknown as SingletonCronRunner
    )
  })

  it('records what the task reports for a singleton job, under the job’s lock', async () => {
    await executor.run(CLEANUP_JOB, async () => partial('bucket_failed'))

    expect(singleton.run).toHaveBeenCalledWith(
      { name: 'schedule.cleanup', lockKey: 'amcore:schedule:cleanup:lock', ttlMs: 1_800_000 },
      expect.any(Function)
    )
    expect(recorder.begin).toHaveBeenCalledWith(CLEANUP_JOB)
    expect(recorder.finish).toHaveBeenCalledWith(CLEANUP_JOB, run, {
      outcome: 'partial',
      code: 'bucket_failed',
    })
  })

  it('does not begin or record anything when another replica holds the lock', async () => {
    singleton.run.mockResolvedValue({ status: 'contended' })
    await executor.run(CLEANUP_JOB, async () => succeeded())
    expect(recorder.begin).not.toHaveBeenCalled()
    expect(recorder.skip).not.toHaveBeenCalled()
  })

  it('records lock_unavailable as a skip, never as a success', async () => {
    singleton.run.mockResolvedValue({ status: 'lock_unavailable' })
    await executor.run(CLEANUP_JOB, async () => succeeded())
    expect(recorder.skip).toHaveBeenCalledWith(CLEANUP_JOB, 'lock_unavailable')
  })

  it('records a thrown task as failed with a safe code, and rethrows for the runner to log', async () => {
    class DatabaseError extends Error {
      override name = 'DatabaseError'
    }
    let rethrown: unknown
    singleton.run.mockImplementation(async (_o: unknown, task: () => Promise<unknown>) => {
      try {
        await task()
      } catch (error) {
        rethrown = error
      }
      return { status: 'failed', error: rethrown }
    })
    await executor.run(CLEANUP_JOB, async () => {
      throw new DatabaseError('db')
    })
    expect(rethrown).toBeInstanceOf(DatabaseError)
    expect(recorder.finish).toHaveBeenCalledWith(CLEANUP_JOB, run, {
      outcome: 'failed',
      code: 'DatabaseError',
    })
  })

  it('runs a per-replica job without the Redis lock', async () => {
    await executor.run(NOTIFICATION_RECOVERY_JOB, async () => skippedFor('busy'))
    expect(singleton.run).not.toHaveBeenCalled()
    expect(recorder.finish).toHaveBeenCalledWith(NOTIFICATION_RECOVERY_JOB, run, {
      skipped: 'busy',
    })
  })

  it('turns a skip returned by a daily job into a failed invalid_result', async () => {
    await executor.run(CLEANUP_JOB, async () => skippedFor('busy'))
    expect(recorder.finish).toHaveBeenCalledWith(CLEANUP_JOB, run, failed('invalid_result'))
  })
})

describe('errorCode', () => {
  const named = (name: string): Error => Object.assign(new Error('secret message'), { name })

  it('reports only an error class from the closed list, and never a message', () => {
    expect(errorCode(named('PrismaClientKnownRequestError'))).toBe('PrismaClientKnownRequestError')
    expect(errorCode(named('TypeError'))).toBe('TypeError')
    expect(errorCode(new Error('secret'))).toBe('unexpected')
    expect(errorCode('text')).toBe('unexpected')
  })

  it('does not carry a name that was chosen by a library or by user input into the evidence', () => {
    for (const name of [
      'reader@example.invalid',
      '3rd party! error',
      "Robert'); DROP TABLE users;--",
      'UnknownDomainError',
      '',
    ])
      expect(errorCode(named(name))).toBe('unexpected')
    expect(SAFE_ERROR_CODES.has('reader@example.invalid')).toBe(false)
  })

  it('keeps every allowed code a safe, bounded identifier', () => {
    for (const code of SAFE_ERROR_CODES) expect(code).toMatch(/^[A-Za-z][A-Za-z0-9]{0,47}$/)
  })
})
