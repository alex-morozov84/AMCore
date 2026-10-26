import { ConservativeCooldown } from './conservative-cooldown'

describe('Conservative cooldown admission', () => {
  let wall: number
  let monotonic: number
  let clock: ConservativeCooldown
  beforeEach(() => {
    jest.useFakeTimers()
    wall = 100000
    monotonic = 0
    clock = new ConservativeCooldown(() => ({ wall, monotonic }), 1)
  })
  afterEach(() => {
    clock.close()
    jest.useRealTimers()
  })
  const step = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 500) {
      const delta = Math.min(500, ms - elapsed)
      wall += delta
      monotonic += delta
      jest.advanceTimersByTime(delta)
    }
  }

  it('requires the entire delay, including the exact boundary, without wall credit', () => {
    expect(clock.remaining('intent', 1, 2000)).toBe(2000)
    step(1500)
    expect(clock.remaining('intent', 1, 2000)).toBe(500)
    step(500)
    expect(clock.remaining('intent', 1, 2000)).toBe(0)
  })
  it.each([3600000, -3600000])('discards credit on wall step %s', (jump) => {
    clock.remaining('intent', 1, 2000)
    step(1000)
    wall += jump
    expect(clock.remaining('intent', 1, 2000)).toBe(2000)
  })
  it('starts a full delay after process restart or owner change', () => {
    clock.remaining('intent', 1, 2000)
    step(1500)
    clock.close()
    clock = new ConservativeCooldown(() => ({ wall, monotonic }))
    expect(clock.remaining('intent', 1, 2000)).toBe(2000)
  })
  it('discards credit after a long observation gap or suspension', () => {
    clock.remaining('intent', 1, 2000)
    step(500)
    wall += 30000
    monotonic += 30000
    expect(clock.remaining('intent', 1, 2000)).toBe(2000)
  })
  it('does not count paused monotonic time as elapsed', () => {
    clock.remaining('intent', 1, 2000)
    wall += 30000
    expect(clock.remaining('intent', 1, 2000)).toBe(2000)
  })
  it('bounds anchor capacity and starts over on a new result revision', () => {
    clock.remaining('intent', 1, 2000)
    expect(() => clock.remaining('other', 1, 2000)).toThrow('STORAGE_LIMIT')
    step(1000)
    expect(clock.remaining('intent', 2, 2000)).toBe(2000)
    clock.forget('intent')
    expect(clock.remaining('other', 1, 2000)).toBe(2000)
  })
  it('rejects invalid durations, but zero needs no timer or capacity', () => {
    expect(clock.remaining('intent', 1, 0)).toBe(0)
    for (const bad of [-1, 86400001, NaN, 0.5])
      expect(() => clock.remaining('intent', 1, bad)).toThrow('CONTENT_UNSUPPORTED')
  })
})
