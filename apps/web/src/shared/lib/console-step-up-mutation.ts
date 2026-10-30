'use client'

import { useEffect, useRef, useState } from 'react'
import { AuthErrorCode, type MfaProof, type MfaStepUpPending } from '@amcore/shared'
import { useMutation } from '@tanstack/react-query'

import { getErrorCode, useApiError } from '@/shared/api'
import { consoleApi } from '@/shared/api/console-api'
import { toast } from '@/shared/ui/toast'

export type StepUpPhase =
  | { kind: 'closed' }
  | { kind: 'open' }
  | { kind: 'proof'; flow: MfaStepUpPending; message?: string; unknown?: boolean }
  | { kind: 'error'; message: string; terminal: boolean }

interface UseStepUpMutationOptions<TResult> {
  /** The caller's own action — e.g. a role change or a session revoke. */
  mutationFn: () => Promise<TResult>
  /** Called once the action has succeeded, including after a step-up retry. */
  onSuccess: (result: TResult) => void
  /** Return true when the caller has handled this action failure. */
  onError?: (error: unknown) => boolean
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
  onError,
}: UseStepUpMutationOptions<TResult>) {
  const describeError = useApiError()
  const proofFlow = useRef<MfaStepUpPending | null>(null)
  const continuation = useRef(0)
  useEffect(
    () => () => {
      continuation.current += 1
    },
    []
  )
  const [stepUp, setStepUp] = useState<StepUpPhase>({ kind: 'closed' })

  const primaryMutation = useMutation({ mutationFn, retry: false })
  const stepUpMutation = useMutation({
    mutationFn: (input: string | MfaProof | null) => {
      if (typeof input === 'string') return consoleApi.stepUp(input)
      const flow = proofFlow.current
      if (!flow) throw new Error('Source proof flow required')
      return consoleApi.stepUpProof({
        flowBinding: flow.flowBinding,
        operationId: crypto.randomUUID(),
        ...(input ? { proof: input } : {}),
      })
    },
    retry: false,
  })

  async function confirm() {
    proofFlow.current = null
    const epoch = ++continuation.current
    try {
      const result = await primaryMutation.mutateAsync()
      if (epoch === continuation.current) onSuccess(result)
    } catch (error) {
      if (epoch !== continuation.current) return
      if (getErrorCode(error) === AuthErrorCode.STEP_UP_REQUIRED) {
        setStepUp({ kind: 'open' })
        return
      }
      if (!onError?.(error)) toast.add({ type: 'error', title: describeError(error).message })
    }
  }

  async function submitStepUp(input: string | MfaProof | null) {
    const epoch = continuation.current
    try {
      const next = await stepUpMutation.mutateAsync(input)
      if (epoch !== continuation.current) return
      if (next) {
        proofFlow.current = next
        if (next.requiredProofs.includes('password')) {
          proofFlow.current = null
          setStepUp({ kind: 'open' })
        } else setStepUp({ kind: 'proof', flow: next })
        return
      }
    } catch (error) {
      if (epoch !== continuation.current) return
      if (proofFlow.current && !isTerminalStepUpFailure(error)) {
        const code = getErrorCode(error)
        setStepUp({
          kind: 'proof',
          flow: proofFlow.current,
          message: describeError(error).message,
          unknown:
            code !== AuthErrorCode.MFA_INVALID_PROOF && code !== AuthErrorCode.RATE_LIMIT_EXCEEDED,
        })
      } else
        setStepUp({
          kind: 'error',
          message: describeError(error).message,
          terminal: isTerminalStepUpFailure(error),
        })
      return
    }
    if (epoch === continuation.current) await retryAfterStepUp(epoch)
  }

  async function retryAfterStepUp(epoch: number) {
    try {
      const result = await primaryMutation.mutateAsync()
      if (epoch !== continuation.current) return
      setStepUp({ kind: 'closed' })
      onSuccess(result)
    } catch (error) {
      if (epoch !== continuation.current) return
      // A second STEP_UP_REQUIRED means the underlying session died between
      // the successful step-up and this retry (e.g. revoked elsewhere) —
      // not something resubmitting the same password again would fix.
      if (getErrorCode(error) === AuthErrorCode.STEP_UP_REQUIRED) {
        setStepUp({ kind: 'error', message: describeError(error).message, terminal: true })
        return
      }
      setStepUp({ kind: 'closed' })
      if (!onError?.(error)) toast.add({ type: 'error', title: describeError(error).message })
    }
  }

  return {
    confirm,
    isSubmitting: primaryMutation.isPending,
    stepUp,
    isSteppingUp: stepUpMutation.isPending,
    submitStepUp,
    closeStepUp: () => {
      continuation.current += 1
      proofFlow.current = null
      setStepUp({ kind: 'closed' })
    },
  }
}

function isTerminalStepUpFailure(error: unknown): boolean {
  const code = getErrorCode(error)
  return (
    code === AuthErrorCode.STEP_UP_REQUIRED ||
    code === AuthErrorCode.STEP_UP_METHOD_UNAVAILABLE ||
    code === AuthErrorCode.AUTH_CONTEXT_CHANGED ||
    code === AuthErrorCode.SESSION_CHANGED
  )
}
