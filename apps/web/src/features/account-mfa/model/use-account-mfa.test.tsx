import type { MfaBrowserView } from '@amcore/shared'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'

import { AccountMfaController } from './account-mfa-controller'
import { useAccountMfa } from './use-account-mfa'

it('observes a newly issued secret and removes it from the view on pagehide', async () => {
  const view: MfaBrowserView = {
    kind: 'flow',
    accountLabel: 'Demo',
    purpose: 'initial_setup',
    state: 'enrollment_required',
    expiresAt: '2030-01-01T00:00:00.000Z',
    requiredProofs: [],
    remainingCodes: 0,
    generation: 0,
  }
  const controller = new AccountMfaController({
    inspect: async () => view,
    command: async () => ({
      view,
      enrollment: {
        secret: '<setup-key>',
        otpauthUri: 'otpauth://totp/demo?secret=<setup-key>',
      },
    }),
  })
  const hook = renderHook(() => useAccountMfa(controller))
  await waitFor(() => expect(hook.result.current.phase).toBe('ready'))
  await act(() => controller.command({ action: 'start_enrollment' }))
  expect(hook.result.current.secrets.enrollment?.secret).toBe('<setup-key>')
  act(() => {
    window.dispatchEvent(new Event('pagehide'))
  })
  expect(hook.result.current.secrets).toEqual({})
  expect(hook.result.current.view).toBeUndefined()
})
