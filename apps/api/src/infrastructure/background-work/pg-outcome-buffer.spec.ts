import { PgOutcomeBuffer } from './pg-outcome-buffer'

describe('bounded PG-only outcome buffer', () => {
  let buffer: PgOutcomeBuffer
  beforeEach(() => {
    buffer = new PgOutcomeBuffer()
  })
  afterEach(() => {
    buffer.onModuleDestroy()
  })

  it('retries only finalization three times and preserves the first witnessed outcome', async () => {
    const finalize = jest.fn().mockRejectedValue(new Error('PG_UNAVAILABLE'))
    buffer.register('command', finalize)
    expect(buffer.enqueue('command', 'command:dispatch', { state: 'applied' })).toBe(true)
    expect(buffer.enqueue('command', 'command:dispatch', { state: 'unknown' })).toBe(true)
    for (let attempt = 0; attempt < 4; attempt += 1) await buffer.retryPending()
    expect(finalize).toHaveBeenCalledTimes(3)
    expect(finalize.mock.calls.every(([payload]) => payload.state === 'applied')).toBe(true)
  })

  it('removes a successfully persisted outcome without another invocation', async () => {
    const finalize = jest.fn().mockResolvedValue(undefined)
    buffer.register('provider', finalize)
    expect(buffer.enqueue('provider', 'inc:attempt', { certainty: 'accepted' })).toBe(true)
    await buffer.retryPending()
    await buffer.retryPending()
    expect(finalize).toHaveBeenCalledTimes(1)
  })

  it('bounds both entry count and logical bytes including identity overhead', () => {
    buffer.register('command', jest.fn())
    for (let index = 0; index < 32; index += 1)
      expect(buffer.enqueue('command', `${index}`, { state: 'applied' })).toBe(true)
    expect(buffer.enqueue('command', 'overflow', { state: 'applied' })).toBe(false)
    const other = new PgOutcomeBuffer()
    try {
      other.register('provider', jest.fn())
      expect(other.enqueue('provider', 'oversized', { value: 'x'.repeat(32768) })).toBe(false)
    } finally {
      other.onModuleDestroy()
    }
  })

  it('does not invoke unknown owners or retain invalid JSON and refuses after shutdown', () => {
    expect(buffer.enqueue('provider', 'attempt', {})).toBe(false)
    buffer.register('provider', jest.fn())
    expect(buffer.enqueue('provider', 'attempt', { invalid: NaN })).toBe(false)
    buffer.onModuleDestroy()
    expect(buffer.enqueue('provider', 'attempt', {})).toBe(false)
  })
})
