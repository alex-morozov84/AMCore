// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { parseConsoleSource } from './parse-console-source'
describe('read-only source links', () => {
  it('distinguishes queue focus from durable work, with only the supported failed view', () => {
    expect(parseConsoleSource({ focus: 'queue-a' }, 'background')).toEqual({
      selection: { kind: 'queue', id: 'queue-a' },
    })
    expect(parseConsoleSource({ work: 'different-work', state: 'failed' }, 'background')).toEqual({
      selection: { kind: 'work', id: 'different-work', state: 'failed' },
    })
    expect(parseConsoleSource({ work: 'different-work' }, 'background')).toEqual({
      selection: { kind: 'work', id: 'different-work' },
    })
    expect(parseConsoleSource({ focus: 'crm_sync' }, 'integration')).toEqual({
      selection: { kind: 'integration', id: 'crm_sync' },
    })
  })
  it.each([
    { focus: ['a', 'b'] },
    { focus: '../../login' },
    { focus: 'a', work: 'b' },
    { focus: 'a', state: 'failed' },
    { work: 'a', state: 'unknown' },
    { work: 'a', state: ['failed'] },
    { state: 'failed' },
  ])('refuses ambiguous query %j', (params) => {
    expect(parseConsoleSource(params, 'background')).toEqual({ invalid: true })
  })
  it.each(['scheduled', 'integration'] as const)('rejects work controls on %s', (kind) => {
    expect(parseConsoleSource({ work: 'a', state: 'failed' }, kind)).toEqual({ invalid: true })
    expect(parseConsoleSource({}, kind)).toEqual({})
  })
})
