import { CYCLE_BUSY, CYCLE_NOT_READY, CYCLE_SHUTDOWN, cycleOutcome } from './dispatch-cycle'

describe('cycleOutcome', () => {
  it('records a pass that did not run as a skip, never as a success', () => {
    expect(cycleOutcome(CYCLE_NOT_READY)).toEqual({ skipped: 'not_ready' })
    expect(cycleOutcome(CYCLE_SHUTDOWN)).toEqual({ skipped: 'shutdown' })
    // The reap ran but every lane was taken: not a completed pass.
    expect(cycleOutcome(CYCLE_BUSY)).toEqual({ skipped: 'busy' })
  })

  it('records a completed pass as success, or partial when isolated units failed', () => {
    expect(cycleOutcome({ status: 'completed', isolatedFailures: 0 })).toEqual({
      outcome: 'success',
    })
    expect(cycleOutcome({ status: 'completed', isolatedFailures: 3 })).toEqual({
      outcome: 'partial',
      code: 'isolated_failure',
      summary: { counts: { isolatedFailures: 3 }, codes: [] },
    })
  })
})
