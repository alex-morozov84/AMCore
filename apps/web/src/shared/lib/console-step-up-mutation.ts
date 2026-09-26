'use client'

import { useState } from 'react'
import { AuthErrorCode } from '@amcore/shared'
import { useMutation } from '@tanstack/react-query'

import { getErrorCode, useApiError } from '@/shared/api'
import { consoleApi } from '@/shared/api/console-api'
import { toast } from '@/shared/ui/toast'

export type StepUpPhase =
  { kind: 'closed' } | { kind: 'open' } | { kind: 'error'; message: string; terminal: boolean }

interface UseStepUpMutationOptions<TResult> {
  /** The caller's own action — e.g. a role change or a session revoke. */
  mutationFn: () => Promise<TResult>
  /** Called once the action has succeeded, including after a step-up retry. */
  onSuccess: (result: TResult) => void
}

/**
 * Console-scoped "confirm → mutate → on `STEP_UP_REQUIRED` open password
 * dialog → exactly one retry → terminal error on repeat" orchestration
 * (ADR-037). Originally written for `console-user-role`; extracted here
 * because `sessions-revoke-admin` needs the identical shape a second time.
 * The caller owns its own mutation function and success handling; the
 * step-up re-authentication call itself (always the same
 * `POST /auth/step-up`) and its generic failure messaging are not
 * caller-customized, so they live here rather than being duplicated.
 */
export function useStepUpMutation<TResult>({
  mutationFn,
  onSuccess,
}: UseStepUpMutationOptions<TResult>) {
  const describeError = useApiError()
  const [stepUp, setStepUp] = useState<StepUpPhase>({ kind: 'closed' })

  const primaryMutation = useMutation({ mutationFn })
  const stepUpMutation = useMutation({
    mutationFn: (password: string) => consoleApi.stepUp(password),
  })

  async function confirm() {
    try {
      const result = await primaryMutation.mutateAsync()
      onSuccess(result)
    } catch (error) {
      if (getErrorCode(error) === AuthErrorCode.STEP_UP_REQUIRED) {
        setStepUp({ kind: 'open' })
        return
      }
      toast.add({ type: 'error', title: describeError(error).message })
    }
  }

  async function submitStepUp(password: string) {
    try {
      await stepUpMutation.mutateAsync(password)
    } catch (error) {
      setStepUp({
        kind: 'error',
        message: describeError(error).message,
        terminal: isTerminalStepUpFailure(error),
      })
      return
    }
    await retryAfterStepUp()
  }

  async function retryAfterStepUp() {
    try {
      const result = await primaryMutation.mutateAsync()
      setStepUp({ kind: 'closed' })
      onSuccess(result)
    } catch (error) {
      // A second STEP_UP_REQUIRED means the underlying session died between
      // the successful step-up and this retry (e.g. revoked elsewhere) —
      // not something resubmitting the same password again would fix.
      if (getErrorCode(error) === AuthErrorCode.STEP_UP_REQUIRED) {
        setStepUp({ kind: 'error', message: describeError(error).message, terminal: true })
        return
      }
      setStepUp({ kind: 'closed' })
      toast.add({ type: 'error', title: describeError(error).message })
    }
  }

  return {
    confirm,
    isSubmitting: primaryMutation.isPending,
    stepUp,
    isSteppingUp: stepUpMutation.isPending,
    submitStepUp,
    closeStepUp: () => setStepUp({ kind: 'closed' }),
  }
}

function isTerminalStepUpFailure(error: unknown): boolean {
  const code = getErrorCode(error)
  return (
    code === AuthErrorCode.STEP_UP_REQUIRED || code === AuthErrorCode.STEP_UP_METHOD_UNAVAILABLE
  )
}
