import { describe, expect, it, vi } from 'vitest'

import { createInvitationAcceptJournal } from './accept-journal'

vi.mock('client-only', () => ({}))
const flow = 'f'.repeat(22)
const first = { operationId: '019a0000-0000-7000-8000-000000000001', expectedInviteId: 'invitation-example', expectedGeneration: 1 }
const second = { ...first, operationId: '019a0000-0000-7000-8000-000000000002' }
describe('invitation acceptance recovery journal', () => {
  it('does not overwrite an unresolved intent or clear a newer operation from a stale callback', () => {
    const journal = createInvitationAcceptJournal(() => sessionStorage)
    sessionStorage.clear()
    expect(journal.write(flow, first)).toBe(true)
    expect(journal.write(flow, second)).toBe(false)
    expect(journal.read(flow)).toEqual(first)
    journal.clear(flow, second.operationId)
    expect(journal.read(flow)).toEqual(first)
    journal.clear(flow, first.operationId)
    expect(journal.write(flow, second)).toBe(true)
    journal.clear(flow, first.operationId)
    expect(journal.read(flow)).toEqual(second)
  })
  it('rejects credential-shaped extensions and removes invalid stored projections', () => {
    const journal = createInvitationAcceptJournal(() => sessionStorage)
    sessionStorage.clear()
    expect(() => journal.write(flow, { ...first, credential: '<test-secret>' } as typeof first)).toThrow()
    const key = `amcore:invitation:accept:v1:${flow}`
    sessionStorage.setItem(key, JSON.stringify({ ...first, credential: '<test-secret>' }))
    expect(journal.read(flow)).toBeNull()
    expect(sessionStorage.getItem(key)).toBeNull()
  })
  it('reports storage degradation without treating absent journal as successful acceptance', () => {
    const journal = createInvitationAcceptJournal(() => { throw new Error('Storage unavailable') })
    expect(journal.write(flow, first)).toBe(false)
    expect(journal.read(flow)).toBeNull()
    expect(() => journal.clear(flow, first.operationId)).not.toThrow()
  })
})
