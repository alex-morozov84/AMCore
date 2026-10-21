import { type Evidence, isNewer, PendingEvidence } from './scheduled-job-pending'

const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  kind: 'success',
  jobId: 'cleanup',
  cadence: 'daily',
  runId: 'a',
  startMono: 100,
  endMono: 110,
  durationMs: 10,
  code: null,
  summary: null,
  skipReason: null,
  dueAt: null,
  configVersion: 'v1',
  nextFireAt: null,
  ...over,
})

describe('isNewer', () => {
  it('orders by start time and breaks a tie by run id, so the winner is deterministic', () => {
    expect(isNewer({ startMono: 2, runId: 'a' }, { startMono: 1, runId: 'z' })).toBe(true)
    expect(isNewer({ startMono: 1, runId: 'b' }, { startMono: 1, runId: 'a' })).toBe(true)
    expect(isNewer({ startMono: 1, runId: 'a' }, { startMono: 1, runId: 'a' })).toBe(false)
  })
})

describe('PendingEvidence', () => {
  it('keeps the newest evidence of each kind and never lets a failure displace a success', () => {
    const pending = new PendingEvidence()
    pending.put(evidence({ kind: 'success', runId: 'ok', startMono: 100 }))
    pending.put(evidence({ kind: 'failure', runId: 'bad', startMono: 200, code: 'x' }))
    pending.put(evidence({ kind: 'success', runId: 'old', startMono: 50 }))
    const { evidence: taken } = pending.take('event')
    expect(taken.map((item) => `${item.kind}:${item.runId}`).sort()).toEqual([
      'failure:bad',
      'success:ok',
    ])
  })

  it('takes only the lane it is asked for, so a daily flush never carries frequent patches', () => {
    const pending = new PendingEvidence()
    pending.put(evidence({ jobId: 'cleanup', cadence: 'daily' }))
    pending.put(evidence({ jobId: 'notification-recovery', cadence: 'frequent' }))
    expect(pending.take('event').evidence.map((item) => item.jobId)).toEqual(['cleanup'])
    expect(pending.has('frequent')).toBe(true)
    expect(pending.has('event')).toBe(false)
    expect(pending.take('frequent').evidence.map((item) => item.jobId)).toEqual([
      'notification-recovery',
    ])
  })

  it('merges a failed write back by the same order, keeping what arrived meanwhile', () => {
    const pending = new PendingEvidence()
    pending.put(evidence({ runId: 'first', startMono: 100 }))
    const inFlight = pending.take('event')
    pending.put(evidence({ runId: 'second', startMono: 200 }))
    pending.restore(inFlight)
    expect(pending.take('event').evidence).toEqual([
      expect.objectContaining({ runId: 'second', startMono: 200 }),
    ])
  })

  it('restores an unsuccessful write’s starts, finishes and dropped counts', () => {
    const pending = new PendingEvidence()
    pending.startRun({ jobId: 'cleanup', runId: 'r1', startMono: 1, maxRuntimeMs: 1000 })
    pending.finishRun({
      jobId: 'cleanup',
      runId: 'r1',
      outcome: 'success',
      endMono: 2,
      durationMs: 1,
      code: null,
      summary: null,
    })
    pending.drop('cleanup', 'event', 2)
    const snapshot = pending.take('event')
    expect(pending.has('event')).toBe(false)
    pending.restore(snapshot)
    const again = pending.take('event')
    expect(again.starts).toHaveLength(1)
    expect(again.finishes).toHaveLength(1)
    expect(again.dropped.get('cleanup')).toBe(2)
  })

  it('tracks at most three unfinished runs per job and counts the refusal', () => {
    const pending = new PendingEvidence()
    const start = (runId: string) => ({ jobId: 'cleanup', runId, startMono: 1, maxRuntimeMs: 1 })
    expect([
      pending.startRun(start('1')),
      pending.startRun(start('2')),
      pending.startRun(start('3')),
    ]).toEqual([true, true, true])
    expect(pending.startRun(start('4'))).toBe(false)
    const snapshot = pending.take('event')
    expect(snapshot.starts).toHaveLength(3)
    expect(snapshot.dropped.get('cleanup')).toBe(1)
  })

  it('keeps its size bounded by the number of jobs, not by the number of ticks', () => {
    const pending = new PendingEvidence()
    for (let tick = 0; tick < 5000; tick += 1)
      pending.put(
        evidence({
          jobId: 'notification-recovery',
          cadence: 'frequent',
          runId: String(tick),
          startMono: tick,
        })
      )
    expect(pending.take('frequent').evidence).toHaveLength(1)
  })
})
