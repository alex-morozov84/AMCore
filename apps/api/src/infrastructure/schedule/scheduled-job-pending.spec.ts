import {
  type Evidence,
  isNewer,
  PendingEvidence,
  type RunFinish,
  type RunStart,
} from './scheduled-job-pending'

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
  clock: { anchor: null },
  ...over,
})
const start = (runId: string, over: Partial<RunStart> = {}): RunStart => ({
  jobId: 'cleanup',
  runId,
  startMono: 1,
  maxRuntimeMs: 1_800_000,
  clock: { anchor: null },
  ...over,
})
const finish = (runId: string, over: Partial<RunFinish> = {}): RunFinish => ({
  jobId: 'cleanup',
  runId,
  outcome: 'success',
  startMono: 1,
  endMono: 2,
  durationMs: 1,
  code: null,
  summary: null,
  clock: { anchor: null },
  ...over,
})

describe('isNewer', () => {
  it('orders by start time and breaks a tie by run id, so the winner is deterministic', () => {
    expect(isNewer({ startMono: 2, runId: 'a' }, { startMono: 1, runId: 'z' })).toBe(true)
    expect(isNewer({ startMono: 1, runId: 'b' }, { startMono: 1, runId: 'a' })).toBe(true)
    expect(isNewer({ startMono: 1, runId: 'a' }, { startMono: 1, runId: 'a' })).toBe(false)
  })
})

describe('evidence', () => {
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

describe('run records', () => {
  it('tracks at most three unfinished runs per job and counts the refusal', () => {
    const pending = new PendingEvidence()
    expect(['1', '2', '3'].map((id) => pending.startRun(start(id)))).toEqual([true, true, true])
    expect(pending.startRun(start('4'))).toBe(false)
    const snapshot = pending.take('event')
    expect(snapshot.starts).toHaveLength(3)
    expect(snapshot.dropped.get('cleanup')).toBe(1)
  })

  it('accepts a finish only for a run whose start was accepted, and ignores the rest', () => {
    const pending = new PendingEvidence()
    expect(pending.finishRun(finish('never-started'))).toBe(false)
    expect(pending.has('event')).toBe(false)
    for (const id of ['1', '2', '3']) pending.startRun(start(id))
    expect(pending.startRun(start('refused'))).toBe(false)
    expect(pending.finishRun(finish('refused'))).toBe(false)
    expect(pending.take('event').finishes).toHaveLength(0)
  })

  it('accepts a finish for a run whose start was already written', () => {
    const pending = new PendingEvidence()
    pending.startRun(start('r1'))
    pending.take('event')
    expect(pending.finishRun(finish('r1'))).toBe(true)
    expect(pending.take('event').finishes.map((item) => item.runId)).toEqual(['r1'])
  })

  it('keeps a thousand start/finish pairs of one job inside its record limit while nothing is written', () => {
    const pending = new PendingEvidence()
    for (let run = 0; run < 1000; run += 1) {
      pending.startRun(start(`run-${run}`, { startMono: run }))
      pending.finishRun(finish(`run-${run}`, { startMono: run, endMono: run + 1 }))
    }
    const snapshot = pending.take('event')
    expect(snapshot.starts.length).toBeLessThanOrEqual(PendingEvidence.RECORDS_PER_JOB)
    expect(snapshot.finishes.length).toBeLessThanOrEqual(PendingEvidence.RECORDS_PER_JOB)
    expect(snapshot.dropped.get('cleanup')).toBeGreaterThan(0)
  })

  it('never grows past the record limit when a failed write is restored over newer starts', () => {
    const pending = new PendingEvidence()
    for (const id of ['a', 'b', 'c']) pending.startRun(start(id))
    const inFlight = pending.take('event')
    for (const id of ['d', 'e', 'f']) pending.startRun(start(id))
    pending.restore(inFlight)
    // Three tracked runs per job at most: only the first three starts were ever accepted.
    expect(pending.take('event').starts.length).toBeLessThanOrEqual(PendingEvidence.RECORDS_PER_JOB)
  })

  it('restores records up to the limit and counts what does not fit', () => {
    const pending = new PendingEvidence()
    const ids = Array.from({ length: 12 }, (_, index) => `r${index}`)
    const inFlight = {
      lane: 'event' as const,
      evidence: [],
      starts: ids.map((id) => start(id)),
      finishes: [],
      dropped: new Map<string, number>(),
    }
    pending.restore(inFlight)
    const after = pending.take('event')
    expect(after.starts).toHaveLength(PendingEvidence.RECORDS_PER_JOB)
    expect(after.dropped.get('cleanup')).toBe(2)
  })

  it('restores starts, finishes and dropped counts of a failed write', () => {
    const pending = new PendingEvidence()
    pending.startRun(start('r1'))
    pending.finishRun(finish('r1'))
    pending.drop('cleanup', 'event', 2)
    const snapshot = pending.take('event')
    expect(pending.has('event')).toBe(false)
    pending.restore(snapshot)
    const again = pending.take('event')
    expect(again.starts).toHaveLength(1)
    expect(again.finishes).toHaveLength(1)
    expect(again.dropped.get('cleanup')).toBe(2)
  })

  it('frees the slot of a tracked run that outlived its maximum runtime', () => {
    const pending = new PendingEvidence()
    for (const id of ['1', '2', '3'])
      pending.startRun(start(id, { startMono: 0, maxRuntimeMs: 10 }))
    expect(pending.startRun(start('late', { startMono: 5 }))).toBe(false)
    expect(pending.startRun(start('later', { startMono: 100 }))).toBe(true)
  })
})

describe('released slots', () => {
  it('accepts the late finish of a run whose slot was released, once, and only for that run', () => {
    const pending = new PendingEvidence()
    pending.startRun(start('A', { startMono: 0, maxRuntimeMs: 100 }))
    pending.take('event') // A's start is already written
    expect(pending.startRun(start('B', { startMono: 101, maxRuntimeMs: 100 }))).toBe(true)
    expect(pending.finishRun(finish('A', { startMono: 0, endMono: 110 }))).toBe(true)
    expect(pending.finishRun(finish('A', { startMono: 0, endMono: 111 }))).toBe(false)
    expect(pending.finishRun(finish('never', { startMono: 0 }))).toBe(false)
    expect(pending.take('event').finishes.map((item) => item.runId)).toEqual(['A'])
  })

  it('remembers at most seven released runs per job, so memory stays bounded', () => {
    const pending = new PendingEvidence()
    for (let i = 0; i < 12; i += 1)
      pending.startRun(start(`r${i}`, { startMono: i * 1000, maxRuntimeMs: 10 }))
    pending.startRun(start('last', { startMono: 100_000, maxRuntimeMs: 10 }))
    const accepted = Array.from({ length: 12 }, (_, i) => `r${i}`).filter((id) =>
      pending.finishRun(finish(id, { startMono: 0 }))
    )
    expect(accepted.length).toBeLessThanOrEqual(PendingEvidence.RELEASED_PER_JOB)
  })
})
