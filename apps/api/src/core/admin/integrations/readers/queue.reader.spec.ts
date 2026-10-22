import type { AdminQueue } from '@amcore/shared'

import { aggregateQueues } from './queue.reader.js'

const available = (name: string, sampledAt: string): AdminQueue =>
  ({ name, status: 'available', sampledAt }) as unknown as AdminQueue
const unavailable = (name: string): AdminQueue =>
  ({ name, status: 'unavailable' }) as unknown as AdminQueue
const disabled = (name: string): AdminQueue =>
  ({ name, status: 'disabled' }) as unknown as AdminQueue

const NOW = Date.parse('2026-10-22T12:00:00.000Z')

describe('aggregateQueues', () => {
  it('does not fabricate a success when no queue is enabled', () => {
    const reading = aggregateQueues([disabled('a')], NOW)
    expect(reading.configuration).toBe('disabled')
    expect(reading.evidence).toMatchObject({ result: 'none', checkedAt: null })
  })

  it('is ok only when every enabled queue answered, using the oldest sample time', () => {
    const reading = aggregateQueues(
      [available('a', '2026-10-22T11:59:50.000Z'), available('b', '2026-10-22T11:59:58.000Z')],
      NOW
    )
    expect(reading.evidence).toMatchObject({
      result: 'ok',
      freshness: 'fresh',
      checkedAt: '2026-10-22T11:59:50.000Z',
    })
  })

  it('is failed and partial when some queues are unavailable', () => {
    const reading = aggregateQueues(
      [available('a', '2026-10-22T11:59:50.000Z'), unavailable('b')],
      NOW
    )
    expect(reading.evidence).toMatchObject({ result: 'failed', failure: 'partial' })
    expect(reading.facts).toContainEqual({ key: 'queues_unavailable', value: 1 })
  })

  it('is failed and unreachable, without a check time, when none answered', () => {
    const reading = aggregateQueues([unavailable('a'), unavailable('b')], NOW)
    expect(reading.evidence).toMatchObject({
      result: 'failed',
      failure: 'unreachable',
      freshness: 'none',
      checkedAt: null,
    })
  })

  it('marks an old sample stale and keeps the result', () => {
    const reading = aggregateQueues([available('a', '2026-10-22T11:58:00.000Z')], NOW)
    expect(reading.evidence).toMatchObject({ result: 'ok', freshness: 'stale' })
  })
})
