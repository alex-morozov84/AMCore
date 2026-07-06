import { composeAiRunRealtimeChannel } from './ai-run-realtime.constants'

/**
 * Unit tests for the AI run realtime channel composition (Track C — ADR-054, Arc C.5). The channel
 * must be env- and version-namespaced; an empty namespace collapses cleanly, and web (subscriber)
 * and worker (publisher) resolve the same string from the same inputs.
 */
describe('composeAiRunRealtimeChannel', () => {
  it('composes env + base + version when the namespace is empty', () => {
    expect(composeAiRunRealtimeChannel('production', '')).toBe('production:ai:run:rt:v1')
  })

  it('inserts the namespace segment between env and base when set', () => {
    expect(composeAiRunRealtimeChannel('production', 'blue')).toBe('production:blue:ai:run:rt:v1')
  })

  it('is stable for identical inputs (web + worker resolve the same channel)', () => {
    expect(composeAiRunRealtimeChannel('staging', 'ns')).toBe(
      composeAiRunRealtimeChannel('staging', 'ns')
    )
  })
})
