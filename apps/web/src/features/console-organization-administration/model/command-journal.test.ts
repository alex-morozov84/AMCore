import { DEFAULT_LOCALE } from '@amcore/shared'
import { createInvitationOperationId } from '@amcore/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  type AdministratorJournal,
  readAdministratorJournal,
  writeAdministratorJournal,
} from './command-journal'

const row = (): AdministratorJournal => {
  const operationId = createInvitationOperationId()
  return {
    actorId: 'operator',
    at: Date.now(),
    operationId,
    pending: {
      kind: 'create',
      input: {
        operationId,
        email: 'person@example.test',
        inviteLocale: DEFAULT_LOCALE,
        reason: 'TEST-49',
      },
    },
  }
}
beforeEach(() => localStorage.clear())
describe('additional administrator recovery journal', () => {
  it('recovers exact frozen input without creating another operation', () => {
    const value = row()
    expect(writeAdministratorJournal('org', value)).toBe(true)
    expect(readAdministratorJournal('org', 'operator')).toEqual(value)
    expect(readAdministratorJournal('another-org', 'operator')).toBeUndefined()
  })
  it('never admits a different actor or arbitrary secret extensions', () => {
    const value = row()
    writeAdministratorJournal('org', value)
    expect(readAdministratorJournal('org', 'different')).toBeUndefined()
    expect(
      writeAdministratorJournal('org', {
        ...value,
        token: '<fake-test-token>',
      } as AdministratorJournal)
    ).toBe(false)
  })
  it('purges expired email and reason while retaining the unresolved operation', () => {
    const value = row()
    value.at -= 86400001
    writeAdministratorJournal('org', value)
    const restored = readAdministratorJournal('org', 'operator')
    expect(restored).toEqual({
      actorId: value.actorId,
      at: value.at,
      operationId: value.operationId,
      pending: undefined,
    })
    expect(JSON.stringify(restored)).not.toContain('person@example.test')
    expect(JSON.stringify(restored)).not.toContain('TEST-49')
  })
})
