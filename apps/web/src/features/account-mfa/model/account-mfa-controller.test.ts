// @vitest-environment node
import type { MfaBrowserResult, MfaBrowserView } from '@amcore/shared'
import { describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import { AccountMfaController } from './account-mfa-controller'

const flow: MfaBrowserView = {
  kind: 'flow',
  accountLabel: 'Demo operator',
  purpose: 'initial_setup',
  state: 'enrollment_required',
  expiresAt: '2030-01-01T00:00:00.000Z',
  requiredProofs: [],
  remainingCodes: 0,
  generation: 0,
}
const enrollment: MfaBrowserResult = {
  view: flow,
  enrollment: { secret: '<setup-key>', otpauthUri: 'otpauth://totp/demo?secret=<setup-key>' },
}
function held<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('account MFA secret and command containment', () => {
  it('retains the original flow intent across concealment and sends it with later status/commands', async () => {
    const flowBinding = crypto.randomUUID()
    const view = { ...flow, flowBinding }
    const inspect = vi.fn(async () => view)
    const command = vi.fn(async () => ({ view }))
    const controller = new AccountMfaController({ inspect, command })
    await controller.inspect()
    controller.conceal()
    await controller.inspect()
    expect(inspect).toHaveBeenLastCalledWith(undefined, flowBinding)
    await controller.command({ action: 'start_enrollment' })
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ flowBinding }))
  })
  it('refuses another flow after a pending cookie switch without displaying its identity', async () => {
    const first = { ...flow, flowBinding: crypto.randomUUID() }
    const inspect = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({
        ...first,
        flowBinding: crypto.randomUUID(),
        accountLabel: 'Other account',
      })
    const controller = new AccountMfaController({ inspect, command: async () => enrollment })
    await controller.inspect()
    controller.conceal()
    await controller.inspect()
    expect(controller.getSnapshot()).toEqual({ phase: 'changed' })
    expect(controller.getSecrets()).toEqual({})
  })
  it('discards a late secret response after the view was concealed', async () => {
    const response = held<MfaBrowserResult>()
    const controller = new AccountMfaController({
      inspect: async () => flow,
      command: () => response.promise,
    })
    await controller.inspect()
    const pending = controller.command({ action: 'start_enrollment' })
    controller.conceal()
    response.resolve(enrollment)
    await pending
    expect(controller.getSecrets()).toEqual({})
    expect(controller.getSnapshot()).toEqual(expect.objectContaining({ phase: 'loading' }))
  })

  it('settles an unknown result through a read without resending the proof', async () => {
    const inspect = vi.fn(async () => flow)
    const command = vi.fn(async (): Promise<MfaBrowserResult> => {
      throw new TypeError('transport')
    })
    const controller = new AccountMfaController({ inspect, command })
    await controller.inspect()
    await controller.command({ action: 'verify', proof: { method: 'totp', code: '012345' } })
    const operationId = controller.getSnapshot().operationId
    expect(controller.getSnapshot().phase).toBe('unknown')
    await controller.command({ action: 'verify', proof: { method: 'totp', code: '012345' } })
    await controller.inspect()
    expect(command).toHaveBeenCalledTimes(1)
    expect(inspect).toHaveBeenLastCalledWith(operationId)
  })

  it('rejects backend credentials accidentally included in a browser response', async () => {
    const controller = new AccountMfaController({
      inspect: async () => flow,
      command: async () => ({ ...enrollment, continuation: '<backend-capability>' }),
    })
    await controller.inspect()
    await controller.command({ action: 'start_enrollment' })
    expect(controller.getSecrets()).toEqual({})
    expect(controller.getSnapshot().phase).toBe('unknown')
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('<backend-capability>')
  })

  it('keeps secrets outside its public snapshot and clears them on a new read', async () => {
    const controller = new AccountMfaController({
      inspect: async () => flow,
      command: async () => enrollment,
    })
    await controller.inspect()
    await controller.command({ action: 'start_enrollment' })
    expect(controller.getSecrets().enrollment?.secret).toBe('<setup-key>')
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('<setup-key>')
    await controller.inspect()
    expect(controller.getSecrets()).toEqual({})
  })

  it('drops identity and secrets when the authority changes', async () => {
    const controller = new AccountMfaController({
      inspect: async () => flow,
      command: async () => {
        throw new ApiRequestError(409, undefined)
      },
    })
    await controller.inspect()
    await controller.command({ action: 'start_enrollment' })
    expect(controller.getSnapshot()).toEqual({ phase: 'changed' })
    expect(controller.getSecrets()).toEqual({})
  })
})

it.each([429, 401, 503] as const)(
  'classifies settings-start HTTP %s without replaying it',
  async (status) => {
    const settings: MfaBrowserView = {
      kind: 'settings',
      accountLabel: 'Fixture',
      protected: true,
      eligible: true,
      remainingCodes: 10,
    }
    const command = vi.fn(async (): Promise<MfaBrowserResult> => {
      throw new ApiRequestError(status, undefined, status === 429 ? 37 : undefined)
    })
    const resolveStart = vi.fn(async () => ({ view: settings }))
    const inspect = vi.fn(async () => settings)
    const controller = new AccountMfaController({ inspect, command, resolveStart })
    await controller.inspect()
    await controller.command({ action: 'start_code_rotation' })
    expect(controller.getSnapshot().phase).toBe(
      status === 429 ? 'ready' : status === 401 ? 'changed' : 'unknown'
    )
    if (status === 429) {
      expect((controller.getSnapshot().error as ApiRequestError).retryAfterSeconds).toBe(37)
      expect(controller.getRecoveryReference()).toBeUndefined()
      await controller.inspect()
      expect(resolveStart).not.toHaveBeenCalled()
    } else if (status === 503) {
      expect(controller.getRecoveryReference()?.startPurpose).toBe('rotate_codes')
      await controller.reconcile()
      expect(resolveStart).toHaveBeenCalledTimes(1)
    }
    expect(command).toHaveBeenCalledTimes(1)
  }
)
