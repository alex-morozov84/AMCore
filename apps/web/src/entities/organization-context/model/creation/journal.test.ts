import { beforeEach, describe, expect, it } from 'vitest'

import { organizationCreationJournal } from './journal'

const first = {
  version: 1 as const,
  binding: 'a'.repeat(64),
  actorId: 'actor',
  input: { name: 'Acme', operationId: 'a74ee478-72ee-4da1-81c1-65a743ac4cc5' },
}
const second = {
  ...first,
  input: { name: 'Second', operationId: 'e6bd13ea-e47c-4ed1-9346-69c97e55e8f6' },
}
const key = 'amcore:organization-creation:v1'
beforeEach(() => sessionStorage.clear())
describe('organization creation journal', () => {
  it('does not replace unresolved intent or let an old callback erase a newer request', () => {
    const journal = organizationCreationJournal()
    expect(journal.write(first)).toBe(true)
    expect(journal.write(second)).toBe(false)
    journal.clear(second)
    expect(journal.read(first.binding, first.actorId).attempt).toEqual(first)
    journal.clear(first)
    expect(journal.write(second)).toBe(true)
    journal.clear(first)
    expect(journal.read(first.binding, first.actorId).attempt).toEqual(second)
  })
  it('rejects unknown credential fields and oversized saved payloads', () => {
    const journal = organizationCreationJournal()
    expect(journal.write({ ...first, password: '<fake-test-password>' } as typeof first)).toBe(
      false
    )
    sessionStorage.setItem(key, JSON.stringify({ ...first, password: '<fake-test-password>' }))
    expect(journal.read(first.binding, first.actorId).attempt).toBeNull()
    sessionStorage.setItem(key, 'x'.repeat(4097))
    expect(journal.read(first.binding, first.actorId).attempt).toBeNull()
    expect(sessionStorage.getItem(key)).toBeNull()
  })
  it('retires the previous session projection on another login', () => {
    const journal = organizationCreationJournal()
    journal.write(first)
    expect(journal.read('b'.repeat(64), 'other')).toEqual({ attempt: null, available: true })
    expect(sessionStorage.getItem(key)).toBeNull()
  })
  it('reports denied storage without confirming an outcome', () => {
    const journal = organizationCreationJournal(() => {
      throw new Error('Denied')
    })
    expect(journal.write(first)).toBe(false)
    expect(journal.read(first.binding, first.actorId)).toEqual({ attempt: null, available: false })
    expect(() => journal.clear(first)).not.toThrow()
  })
})
