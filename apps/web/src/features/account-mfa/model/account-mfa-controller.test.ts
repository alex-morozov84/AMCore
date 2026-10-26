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
