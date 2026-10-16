import { describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import { createOrganizationCreationController } from './controller'
import { organizationCreationJournal } from './journal'

const admission = { binding: 'a'.repeat(64), actor: { id: 'actor', email: 'actor@example.test' } }
function fixture() {
  const values = new Map<string, string>()
  const journal = organizationCreationJournal(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }))
  const result = { organizationId: 'company', completedAt: new Date().toISOString() }
  const deps = {
    bootstrap: vi.fn().mockResolvedValue(admission),
    authority: vi.fn().mockResolvedValue({ binding: admission.binding, data: {} }),
    create: vi.fn().mockResolvedValue({ id: result.organizationId, createdAt: result.completedAt }),
    result: vi.fn().mockResolvedValue(result),
    policy: vi.fn(),
  }
  const controller = createOrganizationCreationController(admission, deps, journal)
  controller.hydrate()
  return { controller, deps, journal, values, result }
}
const failure = (status: number, errorCode: string) =>
  new ApiRequestError(status, { errorCode } as never)

describe('creation recovery and identity', () => {
  it('dismisses a definite slug rejection so a cancelled form starts without the old error', async () => {
    const { controller, deps, journal } = fixture()
    deps.create.mockRejectedValueOnce(failure(409, 'CONFLICT'))
    await controller.submit({ name: 'Acme', slug: 'acme' })
    expect(controller.getSnapshot()).toMatchObject({ phase: 'rejected' })
    expect(controller.getSnapshot().error).toBeDefined()
    expect(controller.getSnapshot().attempt).toBeUndefined()
    expect(journal.read(admission.binding, admission.actor.id).attempt).toBeNull()
    controller.dismiss()
    expect(controller.getSnapshot()).toEqual({ phase: 'idle', storageAvailable: true })
    await controller.submit({ name: 'Acme', slug: 'acme-new' })
    expect(controller.getSnapshot()).toMatchObject({ phase: 'succeeded', access: 'ready' })
  })

  it('freezes a lost response, restores it on reload and repeats the same operation exactly', async () => {
    const { controller, deps, journal } = fixture()
    deps.create.mockRejectedValueOnce(new Error('lost response'))
    await controller.submit({ name: 'Acme' })
    const original = controller.getSnapshot().attempt!
    expect(controller.getSnapshot().phase).toBe('unknown')
    const reloaded = createOrganizationCreationController(admission, deps, journal)
    reloaded.hydrate()
    expect(reloaded.getSnapshot().attempt).toEqual(original)
    await reloaded.repeat()
    expect(deps.create.mock.calls[1]![0]).toEqual(deps.create.mock.calls[0]![0])
    expect(reloaded.getSnapshot()).toMatchObject({ phase: 'succeeded', access: 'ready' })
  })

  it('does not infer rollback from a missing result or disabled-policy retry', async () => {
    const { controller, deps } = fixture()
    deps.create.mockRejectedValueOnce(new Error('lost response'))
    await controller.submit({ name: 'Acme' })
    const attempt = controller.getSnapshot().attempt
    deps.result.mockRejectedValueOnce(failure(404, 'ORGANIZATION_CREATION_RESULT_NOT_FOUND'))
    await controller.check()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'unknown', attempt })
    deps.create.mockRejectedValueOnce(failure(403, 'ORGANIZATION_CREATION_DISABLED'))
    await controller.repeat()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'unknown', attempt })
  })

  it('keeps a changed-grant result terminal and never repeats it to restore access', async () => {
    const { controller, deps } = fixture()
    deps.create.mockRejectedValueOnce(new Error('lost response'))
    await controller.submit({ name: 'Acme' })
    deps.result.mockRejectedValueOnce(failure(409, 'ORGANIZATION_CREATION_RESULT_CHANGED'))
    await controller.check()
    expect(controller.getSnapshot().phase).toBe('rejected')
    expect(controller.getSnapshot().attempt).toBeDefined()
    await controller.repeat()
    expect(deps.create).toHaveBeenCalledTimes(1)
    controller.dismiss()
    expect(controller.getSnapshot().phase).toBe('idle')
  })

  it('retires a replaced admission before any mutation and removes its saved selection on a new login', async () => {
    const { controller, deps, journal } = fixture()
    deps.bootstrap.mockResolvedValue({
      binding: 'b'.repeat(64),
      actor: { id: 'other', email: 'other@example.test' },
    })
    await controller.submit({ name: 'Acme' })
    expect(controller.getSnapshot().phase).toBe('session-retired')
    expect(deps.create).not.toHaveBeenCalled()
    expect(journal.read('b'.repeat(64), 'other').attempt).toBeNull()
  })

  it('drops a late successful response after the consumer retires', async () => {
    const { controller, deps } = fixture()
    let resolve!: (value: unknown) => void
    deps.create.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const running = controller.submit({ name: 'Acme' })
    await vi.waitFor(() => expect(deps.create).toHaveBeenCalled())
    controller.retire()
    resolve({ id: 'company', createdAt: new Date().toISOString() })
    await running
    expect(controller.getSnapshot().phase).not.toBe('succeeded')
    expect(deps.authority).not.toHaveBeenCalled()
  })

  it('distinguishes confirmed commit from a failed access check', async () => {
    const { controller, deps } = fixture()
    deps.authority.mockRejectedValueOnce(failure(404, 'NOT_FOUND'))
    await controller.submit({ name: 'Acme' })
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'succeeded',
      access: 'changed',
      result: { organizationId: 'company' },
    })
    expect(controller.getSnapshot().attempt).toBeDefined()
  })

  it('keeps recovery in memory and reports storage denial', async () => {
    const { deps } = fixture()
    const controller = createOrganizationCreationController(
      admission,
      deps,
      organizationCreationJournal(() => {
        throw new Error('denied')
      })
    )
    controller.hydrate()
    deps.create.mockRejectedValueOnce(new Error('lost response'))
    await controller.submit({ name: 'Acme' })
    expect(controller.getSnapshot()).toMatchObject({ phase: 'unknown', storageAvailable: false })
    await controller.check()
    expect(controller.getSnapshot().phase).toBe('succeeded')
  })
})
