import { composeRealtimeChannel } from './notification-realtime.constants'

describe('composeRealtimeChannel', () => {
  it('omits an empty namespace segment', () => {
    expect(composeRealtimeChannel('production', '')).toBe('production:notif:rt:v1')
  })

  it('inserts the namespace between env and base when set', () => {
    expect(composeRealtimeChannel('production', 'staging')).toBe('production:staging:notif:rt:v1')
  })

  it('distinguishes deployments that would otherwise share NODE_ENV', () => {
    const blue = composeRealtimeChannel('production', 'blue')
    const green = composeRealtimeChannel('production', 'green')
    expect(blue).not.toBe(green)
  })

  it('keeps web and worker on the same channel for identical inputs', () => {
    const web = composeRealtimeChannel('development', '')
    const worker = composeRealtimeChannel('development', '')
    expect(web).toBe(worker)
  })
})
