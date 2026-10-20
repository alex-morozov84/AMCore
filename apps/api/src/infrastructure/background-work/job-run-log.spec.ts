import { DelayedError, UnrecoverableError } from 'bullmq'

import { jobRunEvent, jobRunOutcome } from './job-run-log'

describe('job run log', () => {
  it('classifies how a run ended', () => {
    expect(jobRunOutcome(undefined)).toBe('completed')
    expect(jobRunOutcome(new DelayedError())).toBe('delayed')
    expect(jobRunOutcome(new UnrecoverableError('VERSION_UNSUPPORTED'))).toBe('permanent_failure')
    expect(jobRunOutcome(new Error('TRANSIENT_FAILURE'))).toBe('transient_failure')
  })

  it('carries only the queue, job name, outcome, duration and a safe reason code', () => {
    expect(jobRunEvent('email', 'send-email', undefined, 12)).toEqual({
      event: 'job.finished',
      queue: 'email',
      jobName: 'send-email',
      outcome: 'completed',
      durationMs: 12,
    })
    expect(
      jobRunEvent('email', 'send-email', new UnrecoverableError('VERSION_UNSUPPORTED'), 3)
    ).toMatchObject({ outcome: 'permanent_failure', reason: 'VERSION_UNSUPPORTED' })
  })

  it('never copies the text of a transient failure into the line', () => {
    const event = jobRunEvent('email', 'send-email', new Error('smtp password=hunter2'), 1)

    expect(JSON.stringify(event)).not.toContain('hunter2')
    expect(event).not.toHaveProperty('reason')
  })
})
