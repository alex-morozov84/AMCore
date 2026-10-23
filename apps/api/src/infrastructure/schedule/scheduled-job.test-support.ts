import type { ScheduledJobExecutor } from './scheduled-job.executor.js'
import type { ScheduledJobDefinition, ScheduledJobResult } from './scheduled-job.js'

/**
 * Stand-in for `ScheduledJobExecutor` in service unit tests: it runs the task at once, as if the
 * lock had been won, and keeps what the task reported so a test can assert the recorded outcome.
 */
export function fakeJobs(): {
  jobs: ScheduledJobExecutor
  run: jest.Mock<Promise<void>, [ScheduledJobDefinition, () => Promise<ScheduledJobResult>]>
  results: ScheduledJobResult[]
} {
  const results: ScheduledJobResult[] = []
  const run = jest.fn(
    async (_definition: ScheduledJobDefinition, task: () => Promise<ScheduledJobResult>) => {
      results.push(await task())
    }
  )
  return { jobs: { run } as unknown as ScheduledJobExecutor, run, results }
}
