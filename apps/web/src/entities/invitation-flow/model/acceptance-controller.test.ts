import { describe, expect, it, vi } from 'vitest'

import type { invitationFlowClient } from '../api/flow-client'

import { createInvitationAcceptJournal } from './accept-journal'
import { createInvitationAcceptanceController } from './acceptance-controller'

vi.mock('client-only', () => ({}))
const binding = { flowId: 'f'.repeat(22), flowRevision: 1, sessionBinding: 'a'.repeat(64) }
const intent = { expectedInviteId: 'invitation-example', expectedGeneration: 1 }
const result = { status: 'accepted' as const, organizationId: 'organization-example', memberId: 'member-example' }
function fixture() {
  const values = new Map<string, string>()
  const journal = createInvitationAcceptJournal(() => ({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) }, removeItem: key => { values.delete(key) } }))
  const transport = { accept: vi.fn<typeof invitationFlowClient.accept>().mockResolvedValue({ binding, data: result }),
    recover: vi.fn<typeof invitationFlowClient.recover>().mockResolvedValue({ state: 'unknown' }) }
  const controller = createInvitationAcceptanceController(binding, intent, transport, journal)
  return { journal, transport, controller }
}
describe('headless explicit invitation settlement', () => {
  it('persists exact intent before the first send and clears it only after a verified result', async () => {
    const current = fixture()
    current.transport.accept.mockImplementationOnce(async () => {
      expect(current.journal.read(binding.flowId)).toMatchObject(intent)
      return { binding, data: result }
    })
    expect(current.transport.accept).not.toHaveBeenCalled()
    await current.controller.accept()
    expect(current.controller.getSnapshot()).toMatchObject({ status: 'committed', result })
    expect(current.journal.read(binding.flowId)).toBeNull()
  })
  it('preserves the operation on unknown transport and retries only the same ID/target after explicit recovery', async () => {
    const current = fixture()
    current.transport.accept.mockRejectedValueOnce(new Error('transport lost'))
    await current.controller.accept()
    const first = current.transport.accept.mock.calls[0]
    expect(current.controller.getSnapshot().status).toBe('unknown')
    await current.controller.accept()
    expect(current.transport.accept).toHaveBeenCalledTimes(1)
    await current.controller.recover(true)
    expect(current.transport.accept).toHaveBeenCalledTimes(2)
    expect(current.transport.accept.mock.calls[1]?.[0]).toEqual(first?.[0])
  })
  it('keeps unknown GET unresolved when no current flow permits a retry', async () => {
    const current = fixture()
    current.transport.accept.mockRejectedValueOnce(new Error('transport lost'))
    await current.controller.accept()
    await current.controller.recover(false)
    expect(current.controller.getSnapshot().status).toBe('unknown')
    expect(current.transport.accept).toHaveBeenCalledTimes(1)
  })
  it('does not publish a late result after account retirement', async () => {
    const current = fixture()
    let resolve!: (value: { binding: typeof binding; data: typeof result }) => void
    current.transport.accept.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = current.controller.accept()
    current.controller.retire()
    resolve({ binding, data: result })
    await pending
    expect(current.controller.getSnapshot().status).toBe('retired')
    expect(current.journal.read(binding.flowId)).not.toBeNull()
  })
  it('keeps a memory descriptor when tab storage is disabled', async () => {
    const journal = createInvitationAcceptJournal(() => { throw new Error('storage denied') })
    const transport = { accept: vi.fn().mockRejectedValue(new Error('transport lost')), recover: vi.fn() }
    const controller = createInvitationAcceptanceController(binding, intent, transport, journal)
    await controller.accept()
    expect(controller.getSnapshot()).toMatchObject({ status: 'unknown', persistent: false, descriptor: intent })
    await controller.accept()
    expect(transport.accept).toHaveBeenCalledTimes(1)
  })
  it('reports removed access from durable proof without sending a new acceptance', async () => {
    const current = fixture()
    current.transport.accept.mockRejectedValueOnce(new Error('transport lost'))
    await current.controller.accept()
    const descriptor = current.controller.getSnapshot().descriptor!
    const controller = createInvitationAcceptanceController(binding, intent, {
      accept: current.transport.accept,
      recover: vi.fn<typeof invitationFlowClient.recover>().mockResolvedValue({ state: 'committed', intent: descriptor, result, access: 'removed' }),
    }, current.journal)
    await controller.recover(true)
    expect(controller.getSnapshot().status).toBe('access_removed')
    expect(current.transport.accept).toHaveBeenCalledTimes(1)
  })
})
