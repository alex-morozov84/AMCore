import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import { useOwnApiKeySecret } from './hooks'
import { OwnApiKeyController } from './own-api-key-controller'

vi.mock('client-only', () => ({}))
const input = {
  name: 'Export',
  organizationId: 'cmp00000000000000000000000',
  scopes: ['read:Organization'],
}
const result = {
  ...input,
  id: 'key-a',
  key: '<fake-secret>',
  expiresAt: null,
  createdAt: '2026-10-19T00:00:00.000Z',
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function setup() {
  const client = {
    verify: vi.fn().mockResolvedValue({ verified: true as const }),
    create: vi.fn().mockResolvedValue(result),
    list: vi.fn().mockResolvedValue({ data: [], page: 1, limit: 20, total: 0 }),
    revoke: vi.fn().mockResolvedValue({ revoked: true as const }),
  }
  const controller = new OwnApiKeyController({ binding: 'a'.repeat(64), actorId: 'actor' }, client)
  controller.setTarget('cmp00000000000000000000000')
  return { controller, client }
}
beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})
describe('own-key actor host', () => {
  it('retains exact-key revocation uncertainty and confirmed receipt independently of GET failures', async () => {
    const { controller, client } = setup()
    client.revoke.mockRejectedValueOnce(new Error('lost response'))
    await expect(controller.revoke('key-a')).rejects.toThrow('lost response')
    expect(controller.getRevocationSnapshot()).toMatchObject({ phase: 'unknown', keyId: 'key-a' })
    client.list.mockRejectedValue(new Error('read failed'))
    await expect(
      controller.list({ page: 1, limit: 20, status: 'all' }, new AbortController().signal)
    ).rejects.toThrow('read failed')
    expect(controller.getRevocationSnapshot().phase).toBe('unknown')
    expect(client.revoke).toHaveBeenCalledTimes(1)
    await controller.revoke('key-a')
    expect(controller.getRevocationSnapshot()).toEqual({ phase: 'confirmed', keyId: 'key-a' })
    await expect(
      controller.list({ page: 1, limit: 20, status: 'all' }, new AbortController().signal)
    ).rejects.toThrow('read failed')
    expect(controller.getRevocationSnapshot().phase).toBe('confirmed')
    controller.session.retire()
    expect(controller.getRevocationSnapshot()).toEqual({ phase: 'idle' })
  })

  it('keeps local validation refusal editable and cannot dismiss a pending/unknown attempt as saved', async () => {
    const { controller, client } = setup()
    await controller.create({ ...input, scopes: [] })
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', error: expect.any(Error) })
    expect(client.create).not.toHaveBeenCalled()
    client.create.mockRejectedValueOnce(new Error('network'))
    await controller.create(input)
    controller.acknowledgeSaved()
    expect(controller.getSnapshot().phase).toBe('unknown')
  })

  it('projects the transient secret reactively without a Query provider or response cache', async () => {
    const { controller } = setup()
    const { result: projection } = renderHook(() =>
      useOwnApiKeySecret(controller, input.organizationId)
    )
    expect(projection.current).toBeUndefined()
    await act(async () => {
      await controller.create(input)
    })
    expect(projection.current).toBe(result.key)
    act(() => controller.session.conceal())
    expect(projection.current).toBeUndefined()
    await act(async () => {
      await controller.session.freshCheck()
    })
    expect(projection.current).toBe(result.key)
    act(() => controller.acknowledgeSaved())
    expect(projection.current).toBeUndefined()
  })

  it('verifies before POST and again after 201; journal never contains plaintext', async () => {
    const { controller, client } = setup()
    await controller.create(input)
    expect(client.verify).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().phase).toBe('confirmed')
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(result.key)
    expect(controller.secretForDisplay()).toBe(result.key)
    controller.session.conceal()
    expect(controller.secretForDisplay()).toBeUndefined()
    await controller.session.check()
    expect(controller.secretForDisplay()).toBe(result.key)
    controller.acknowledgeSaved()
    expect(controller.secretForDisplay()).toBeUndefined()
  })
  it('keeps a confirmed result concealed when its postflight probe fails, then recovers', async () => {
    const { controller, client } = setup()
    client.verify
      .mockResolvedValueOnce({ verified: true })
      .mockRejectedValueOnce(new ApiRequestError(503, undefined))
    await controller.create(input)
    expect(controller.getSnapshot().phase).toBe('confirmed')
    expect(controller.secretForDisplay()).toBeUndefined()
    await controller.session.check()
    expect(controller.secretForDisplay()).toBe(result.key)
  })
  it('retires for the same actor with a new login and drops the previous secret', async () => {
    const { controller, client } = setup()
    await controller.create(input)
    client.verify.mockRejectedValueOnce(new ApiRequestError(409, undefined))
    await controller.session.check()
    expect(controller.session.getSnapshot()).toBe('retired')
    expect(controller.secretForDisplay()).toBeUndefined()
    expect(controller.getSnapshot().phase).toBe('idle')
  })
  it('does not replay unknown creation; inspection and acknowledgment only open a fresh draft', async () => {
    const { controller, client } = setup()
    client.create.mockRejectedValueOnce(new Error('network'))
    await controller.create(input)
    expect(controller.getSnapshot().phase).toBe('unknown')
    controller.setTarget('cmp00000000000000000000001')
    controller.closeDraft()
    await controller.create(input)
    controller.dismissUnknown(true)
    expect(controller.getSnapshot().phase).toBe('unknown')
    await controller.inspect()
    controller.dismissUnknown(false)
    expect(controller.getSnapshot().phase).toBe('unknown')
    controller.dismissUnknown(true)
    expect(controller.getSnapshot().phase).toBe('idle')
    expect(client.create).toHaveBeenCalledTimes(1)
  })
  it('cannot dispatch from a closed preflight draft', async () => {
    const { controller, client } = setup()
    const probe = deferred<{ verified: true }>()
    client.verify.mockReturnValueOnce(probe.promise)
    const creation = controller.create(input)
    await Promise.resolve()
    controller.closeDraft()
    probe.resolve({ verified: true })
    await creation
    expect(client.create).not.toHaveBeenCalled()
  })
  it('keeps only a safe ID from a late 201 for a previous target', async () => {
    const { controller, client } = setup()
    const response = deferred<typeof result>()
    client.create.mockReturnValueOnce(response.promise)
    const creation = controller.create(input)
    await vi.waitFor(() => expect(client.create).toHaveBeenCalledTimes(1))
    controller.setTarget('cmp00000000000000000000001')
    response.resolve(result)
    await creation
    expect(controller.getSnapshot()).toMatchObject({ phase: 'createdSecretLost', keyId: result.id })
    expect(controller.secretForDisplay()).toBeUndefined()
  })
  it('does not copy after identity changes at copy preflight', async () => {
    const { controller, client } = setup()
    await controller.create(input)
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    client.verify.mockRejectedValueOnce(new ApiRequestError(401, undefined))
    expect(await controller.copy()).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })
})

describe('independent operation lifetimes', () => {
  it.each(['target', 'epoch', 'discard'] as const)(
    'settles exact DELETE after %s invalidation and permits another command',
    async (change) => {
      const { controller, client } = setup()
      const response = deferred<{ revoked: true }>()
      client.revoke.mockReturnValueOnce(response.promise)
      const removing = controller.revoke('key-a')
      await vi.waitFor(() => expect(client.revoke).toHaveBeenCalledOnce())
      if (change === 'target') controller.setTarget('cmp00000000000000000001')
      if (change === 'epoch') controller.session.invalidate()
      if (change === 'discard') {
        controller.discard()
        expect(controller.getRevocationSnapshot()).toMatchObject({
          phase: 'unknown',
          keyId: 'key-a',
        })
      }
      response.resolve({ revoked: true })
      expect(await removing).toBe(true)
      expect(controller.getRevocationSnapshot()).toEqual({ phase: 'confirmed', keyId: 'key-a' })
      expect(await controller.revoke('key-b')).toBe(true)
      expect(client.revoke.mock.calls[1]?.[1]).toBe('key-b')
    }
  )
  it('cancels an undispatched DELETE on disposal without stranding pending', async () => {
    const { controller, client } = setup()
    const probe = deferred<{ verified: true }>()
    client.verify.mockReturnValueOnce(probe.promise)
    const removing = controller.revoke('key-a')
    await vi.waitFor(() => expect(client.verify).toHaveBeenCalledOnce())
    controller.discard()
    probe.resolve({ verified: true })
    expect(await removing).toBe(false)
    expect(client.revoke).not.toHaveBeenCalled()
    expect(controller.getRevocationSnapshot().phase).toBe('refused')
    expect(await controller.revoke('key-b')).toBe(true)
  })
  it('ignores a late acknowledgment after actor retirement', async () => {
    const { controller, client } = setup()
    const response = deferred<{ revoked: true }>()
    client.revoke.mockReturnValueOnce(response.promise)
    const removing = controller.revoke('key-a')
    await vi.waitFor(() => expect(client.revoke).toHaveBeenCalledOnce())
    controller.session.retire()
    response.resolve({ revoked: true })
    expect(await removing).toBe(false)
    expect(controller.getRevocationSnapshot()).toEqual({ phase: 'idle' })
    expect(await controller.revoke('key-b')).toBe(false)
  })
  it('does not let an abandoned DELETE overwrite a newer deliberate operation', async () => {
    const { controller, client } = setup()
    const first = deferred<{ revoked: true }>(),
      second = deferred<{ revoked: true }>()
    client.revoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const old = controller.revoke('key-a')
    await vi.waitFor(() => expect(client.revoke).toHaveBeenCalledOnce())
    controller.discard()
    const next = controller.revoke('key-b', { name: 'Retained B' })
    await vi.waitFor(() => expect(client.revoke).toHaveBeenCalledTimes(2))
    first.resolve({ revoked: true })
    expect(await old).toBe(false)
    expect(controller.getRevocationSnapshot()).toMatchObject({ phase: 'pending', keyId: 'key-b' })
    second.resolve({ revoked: true })
    expect(await next).toBe(true)
    expect(controller.getRevocationSnapshot()).toMatchObject({
      phase: 'confirmed',
      keyId: 'key-b',
      name: 'Retained B',
    })
  })
  it('retains post-disposal DELETE uncertainty until an explicit retry', async () => {
    const { controller, client } = setup()
    const response = deferred<{ revoked: true }>()
    client.revoke.mockReturnValueOnce(response.promise)
    const removing = controller.revoke('key-a')
    await vi.waitFor(() => expect(client.revoke).toHaveBeenCalledOnce())
    controller.discard()
    response.resolve({ revoked: true })
    await removing
    client.revoke.mockRejectedValueOnce(new Error('lost reply'))
    await expect(controller.revoke('key-b')).rejects.toThrow('lost reply')
    controller.discard()
    expect(controller.getRevocationSnapshot()).toMatchObject({ phase: 'unknown', keyId: 'key-b' })
    expect(await controller.revoke('key-b')).toBe(true)
  })
  it('freezes all submitted fields before asynchronous creation authority', async () => {
    const { controller, client } = setup()
    const authority = deferred<boolean>()
    const verify = vi.fn().mockReturnValue(authority.promise)
    const submitted = { ...input, scopes: [...input.scopes] }
    const creating = controller.create(submitted, 'Acme', verify)
    await vi.waitFor(() => expect(verify).toHaveBeenCalledOnce())
    submitted.name = 'Never submitted'
    submitted.scopes.push('delete:Organization')
    authority.resolve(true)
    await creating
    expect(client.create.mock.calls[0]?.[1]).toEqual(input)
  })
})
