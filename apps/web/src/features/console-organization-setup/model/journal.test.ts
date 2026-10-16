import { DEFAULT_LOCALE } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readSetupJournal, type SetupJournalRecord, writeSetupJournal } from './journal'

const record: SetupJournalRecord = {
  version: 1,
  binding: 'a'.repeat(64),
  actorId: 'operator',
  draft: { email: 'anna@example.test', name: 'Acme', slug: 'acme' },
  pending: { kind: 'prepare', input: { email: 'anna@example.test', locale: DEFAULT_LOCALE } },
}
const key = 'amcore:initial-organization-setup:v1'
beforeEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})
describe('initial setup journal', () => {
  it('reads earlier records without a wizard step and retains the new review step', () => {
    expect(writeSetupJournal(record)).toBe(true)
    expect(readSetupJournal(record.binding, record.actorId)?.step).toBeUndefined()
    expect(writeSetupJournal({ ...record, step: 'review' })).toBe(true)
    expect(readSetupJournal(record.binding, record.actorId)?.step).toBe('review')
  })
  it('retains the exact selected recipient, locale and frozen request across reload', () => {
    expect(writeSetupJournal(record)).toBe(true)
    expect(readSetupJournal(record.binding, record.actorId)).toEqual(record)
  })
  it('rejects secret-shaped extensions and bounded malformed projections', () => {
    expect(writeSetupJournal({ ...record, token: '<fake-test-token>' } as SetupJournalRecord)).toBe(
      false
    )
    sessionStorage.setItem(key, JSON.stringify({ ...record, token: '<fake-test-token>' }))
    expect(readSetupJournal(record.binding, record.actorId)).toBeUndefined()
    sessionStorage.setItem(key, 'x'.repeat(8193))
    expect(readSetupJournal(record.binding, record.actorId)).toBeUndefined()
    expect(sessionStorage.getItem(key)).toBeNull()
  })
  it('removes the retired operator projection on another admission', () => {
    writeSetupJournal(record)
    expect(readSetupJournal('b'.repeat(64), 'other')).toBeUndefined()
    expect(sessionStorage.getItem(key)).toBeNull()
  })
  it('does not invent recovery data when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Denied')
    })
    expect(readSetupJournal(record.binding, record.actorId)).toBeUndefined()
    expect(writeSetupJournal(record)).toBe(false)
  })
})
