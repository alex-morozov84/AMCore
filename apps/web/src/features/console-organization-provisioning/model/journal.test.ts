import { DEFAULT_LOCALE } from '@amcore/shared'
import { createInvitationOperationId } from '@amcore/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  type ProvisioningJournal,
  readProvisioningJournal,
  writeProvisioningJournal,
} from './journal'

const key = 'amcore:organization-provisioning:v1:create'
const row = (): ProvisioningJournal => ({
  version: 1,
  actorId: 'operator',
  binding: 'a'.repeat(64),
  at: Date.now(),
  open: true,
  step: 3,
  draft: {
    name: 'North shop',
    slug: 'north-shop',
    firstAdminEmail: 'anna@example.test',
    inviteLocale: DEFAULT_LOCALE,
  },
  pending: {
    kind: 'create',
    input: {
      operationId: createInvitationOperationId(),
      name: 'North shop',
      slug: 'north-shop',
      firstAdminEmail: 'anna@example.test',
      inviteLocale: DEFAULT_LOCALE,
    },
  },
})
beforeEach(() => localStorage.clear())
describe('provisioning recovery journal', () => {
  it('retains the frozen request on reload without making a new operation', () => {
    const input = row()
    expect(writeProvisioningJournal(input, 'create')).toBe(true)
    expect(readProvisioningJournal(input.binding, input.actorId, 'create')).toEqual(input)
  })
  it('rejects secret-shaped extensions', () => {
    expect(
      writeProvisioningJournal(
        { ...row(), token: '<fake-test-token>' } as ProvisioningJournal,
        'create'
      )
    ).toBe(false)
  })
  it('retires another operator', () => {
    const input = row()
    writeProvisioningJournal(input, 'create')
    expect(readProvisioningJournal('b'.repeat(64), 'different-operator', 'create')).toBeUndefined()
    expect(localStorage.getItem(key)).toBeNull()
  })
  it('keeps the same actor’s frozen input after fresh login without retaining the old binding', () => {
    const input = row()
    writeProvisioningJournal(input, 'create')
    const restored = readProvisioningJournal('b'.repeat(64), input.actorId, 'create')
    expect(restored?.binding).toBe('b'.repeat(64))
    expect(restored?.pending).toEqual(input.pending)
  })
  it('removes expired PII while preserving an unresolved creation identity', () => {
    const input = row()
    input.at -= 86_400_001
    writeProvisioningJournal(input, 'create')
    const restored = readProvisioningJournal(input.binding, input.actorId, 'create')
    expect(restored?.pending).toBeUndefined()
    expect(restored?.draft.firstAdminEmail).toBe('')
    expect(restored?.expiredOperationId).toBe(input.pending!.input.operationId)
  })
  it('rejects malformed and oversized storage', () => {
    localStorage.setItem(key, 'x'.repeat(8193))
    expect(readProvisioningJournal('a'.repeat(64), 'operator', 'create')).toBeUndefined()
  })
})
