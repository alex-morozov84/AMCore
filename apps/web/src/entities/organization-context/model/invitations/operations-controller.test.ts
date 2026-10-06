import { describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import { invitationsClient } from '../../api/invitations-client'
import { createOrganizationAccessController } from '../access-controller'

import { createInvitationManagerJournal } from './operation-journal'
import { createInvitationManagerOperations } from './operations-controller'

vi.mock('client-only', () => ({}))
function setup() {
  const storage = new Map<string, string>()
  const journal = createInvitationManagerJournal(() => ({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value)
    },
    removeItem: (key) => {
      storage.delete(key)
    },
  }))
  const access = createOrganizationAccessController('a'.repeat(64), 'organization')
  access.setAuthority(true)
  access.setRefresh(async () => 'ready')
  const transport = { ...invitationsClient, create: vi.fn(), receipt: vi.fn() }
  return {
    access,
    journal,
    transport,
    storage,
    operations: createInvitationManagerOperations(access, transport, journal),
  }
}
const command = {
  kind: 'create' as const,
  input: { email: 'recipient@example.test', roleIds: ['member-role'] },
}

describe('manager stable command recovery', () => {
  it('returns confirmed settlement to the form and permits the next independent command', async () => {
    const f = setup()
    f.transport.create.mockResolvedValue({ status: 'invited' })
    expect(await f.operations.submit(command)).toMatchObject({
      status: 'committed',
      followup: 'ready',
    })
    const firstId = f.transport.create.mock.calls[0]![2]
    expect(await f.operations.submit(command)).toMatchObject({
      status: 'committed',
      followup: 'ready',
    })
    expect(f.transport.create).toHaveBeenCalledTimes(2)
    expect(f.transport.create.mock.calls[1]![2]).not.toBe(firstId)
  })

  it('blocks replacement commands after loss and explicitly replays the same intent/id', async () => {
    const f = setup()
    f.transport.create
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce({ status: 'invited' })
    f.transport.receipt.mockResolvedValue({ state: 'unknown' })
    await f.operations.submit(command)
    const saved = f.operations.getSnapshot().record!
    expect(f.operations.getSnapshot().status).toBe('unknown')
    expect(f.journal.read(f.access.binding, f.access.organizationId)).toEqual(saved)
    await f.operations.submit({ ...command, input: { email: 'different@example.test' } })
    expect(f.transport.create).toHaveBeenCalledTimes(1)
    await f.operations.recover()
    expect(f.transport.create).toHaveBeenCalledTimes(2)
    expect(f.transport.create.mock.calls[0]!.slice(0, 4)).toEqual(
      f.transport.create.mock.calls[1]!.slice(0, 4)
    )
    expect(f.operations.getSnapshot()).toMatchObject({
      status: 'committed',
      result: { status: 'invited' },
      followup: 'ready',
    })
    expect(f.storage.size).toBe(0)
  })

  it('restores an unresolved journal and settles its receipt without sending a new command', async () => {
    const f = setup()
    f.transport.create.mockRejectedValue(new TypeError('lost'))
    await f.operations.submit(command)
    const restored = createInvitationManagerOperations(f.access, f.transport, f.journal)
    expect(restored.getSnapshot().status).toBe('unknown')
    f.transport.receipt.mockResolvedValue({
      state: 'committed',
      kind: 'create',
      result: { status: 'invited' },
    })
    await restored.recover()
    expect(f.transport.create).toHaveBeenCalledTimes(1)
    expect(restored.getSnapshot().status).toBe('committed')
  })

  it('does not publish a late result or retain a journal after retirement', async () => {
    const f = setup()
    let finish!: (value: { status: 'invited' }) => void
    f.transport.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = f.operations.submit(command)
    f.operations.retire()
    finish({ status: 'invited' })
    await pending
    expect(f.operations.getSnapshot()).toMatchObject({ status: 'retired', result: undefined })
    expect(f.storage.size).toBe(0)
  })

  it.each(['INVITE_ALREADY_PENDING', 'INVITE_SETTLED'])(
    'settles a known %s rejection without offering replay',
    async (errorCode) => {
      const f = setup()
      f.transport.create.mockRejectedValue(new ApiRequestError(409, { errorCode } as never))
      await f.operations.submit(command)
      expect(f.operations.getSnapshot().status).toBe('rejected')
      expect(f.storage.size).toBe(0)
    }
  )

  it('retires a late headless result when its authority changes without a React subscriber', async () => {
    const f = setup()
    let finish!: (value: { status: 'invited' }) => void
    f.transport.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = f.operations.submit(command)
    f.access.setTarget('another-organization')
    finish({ status: 'invited' })
    await pending
    expect(f.operations.getSnapshot()).toMatchObject({ status: 'retired', result: undefined })
    expect(f.storage.size).toBe(0)
  })

  it('retains unknown recovery across effect replay without admitting stale callbacks', async () => {
    const f = setup()
    f.transport.create.mockRejectedValue(new TypeError('lost'))
    await f.operations.submit(command)
    const original = f.operations.getSnapshot().record
    f.operations.retire()
    f.operations.resume()
    expect(f.operations.getSnapshot()).toMatchObject({ status: 'unknown', record: original })
    expect(f.storage.size).toBe(1)
  })
})
