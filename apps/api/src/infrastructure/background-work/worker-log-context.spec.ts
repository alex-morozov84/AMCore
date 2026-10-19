import { CLS_ID } from 'nestjs-cls'

import { peekCorrelationId, workerLogStore } from './worker-log-context'

describe('worker log context', () => {
  it('reads only a well-formed correlation ID from the envelope', () => {
    expect(peekCorrelationId({ correlationId: 'req-1' })).toBe('req-1')
    expect(peekCorrelationId({ correlationId: 'bad value' })).toBeUndefined()
    expect(peekCorrelationId({ correlationId: 42 })).toBeUndefined()
    expect(peekCorrelationId({})).toBeUndefined()
    expect(peekCorrelationId(null)).toBeUndefined()
    expect(peekCorrelationId('text')).toBeUndefined()
  })

  it('builds the store with the request ID, work ID and job ID', () => {
    expect(
      workerLogStore('email.queued', { id: 'job-1', data: { correlationId: 'req-1' } })
    ).toEqual({
      [CLS_ID]: 'req-1',
      workId: 'email.queued',
      jobId: 'job-1',
    })
  })

  it('omits the ID for a job that carries none', () => {
    const store = workerLogStore('email.queued', { id: 'job-1', data: {} })
    expect(CLS_ID in store).toBe(false)
    expect(store).toEqual({ workId: 'email.queued', jobId: 'job-1' })
  })
})
