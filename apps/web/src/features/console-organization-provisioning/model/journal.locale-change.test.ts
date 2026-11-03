import { createInvitationOperationId } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isReplayable,
  type PendingProvisioning,
  type ProvisioningJournal,
  readProvisioningJournal,
  writeProvisioningJournal,
} from './journal'

// The next build serves Russian only; the journal was written while English was served too.
vi.mock('@amcore/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SERVED_LOCALES: ['ru'] as const,
  DEFAULT_LOCALE: 'ru' as const,
  coerceSupportedLocale: () => 'ru' as const,
}))

const key = 'amcore:organization-provisioning:v1:create'
const email = 'anna@example.test'
const create = (inviteLocale: 'en' | 'ru'): PendingProvisioning => ({
  kind: 'create',
  input: {
    operationId: createInvitationOperationId(),
    name: 'North shop',
    slug: 'north-shop',
    firstAdminEmail: email,
    inviteLocale,
  },
})
const row = (pending?: PendingProvisioning, locale: 'en' | 'ru' = 'en'): ProvisioningJournal => ({
  version: 1,
  actorId: 'operator',
  binding: 'a'.repeat(64),
  at: Date.now(),
  open: true,
  step: 3,
  draft: { name: 'North shop', slug: 'north-shop', firstAdminEmail: email, inviteLocale: locale },
  organizationId: 'org-1',
  pending,
})
const stored = (value: ProvisioningJournal) => {
  localStorage.setItem(key, JSON.stringify(value))
  return readProvisioningJournal(value.binding, value.actorId, 'create')
}
beforeEach(() => localStorage.clear())

describe('provisioning journal after the served languages changed', () => {
  it('keeps a frozen create exactly as it was sent, with its operation ID', () => {
    const pending = create('en')
    expect(stored(row(pending))?.pending).toEqual(pending)
  })
  it('keeps a frozen replace-recipient exactly as it was sent', () => {
    const pending: PendingProvisioning = {
      kind: 'replace-recipient',
      input: {
        operationId: createInvitationOperationId(),
        expectedRevision: 2,
        firstAdminEmail: email,
        inviteLocale: 'en',
      },
    }
    expect(stored(row(pending))?.pending).toEqual(pending)
  })
  it('maps only the editable draft to a served language', () => {
    const restored = stored(row(create('en'), 'en'))
    expect(restored?.draft.inviteLocale).toBe('ru')
    expect(restored?.pending?.input).toMatchObject({ inviteLocale: 'en' })
  })
  it('can write a frozen command back unchanged', () => {
    const pending = create('en')
    // The draft is editable and must be served; the frozen command is written as it is.
    expect(writeProvisioningJournal(row(pending, 'ru'), 'create')).toBe(true)
    expect(readProvisioningJournal('a'.repeat(64), 'operator', 'create')?.pending).toEqual(pending)
  })
  it('still discards a command that names no shipped catalogue', () => {
    const value = JSON.parse(JSON.stringify(row(create('en'))))
    value.pending.input.inviteLocale = 'de'
    localStorage.setItem(key, JSON.stringify(value))
    expect(readProvisioningJournal('a'.repeat(64), 'operator', 'create')).toBeUndefined()
  })
  it('says which saved commands this build may send again', () => {
    expect(isReplayable(create('en'))).toBe(false)
    expect(isReplayable(create('ru'))).toBe(true)
    expect(
      isReplayable({
        kind: 'cancel',
        input: { operationId: createInvitationOperationId(), expectedRevision: 1 },
      })
    ).toBe(true)
  })
})
