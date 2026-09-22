'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AuthErrorCode, type SystemRole } from '@amcore/shared'
import { useMutation } from '@tanstack/react-query'

import { getErrorCode, useApiError } from '@/shared/api'
import { consoleApi } from '@/shared/api/console-api'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { toast } from '@/shared/ui/toast'

export type StepUpPhase =
  { kind: 'closed' } | { kind: 'open' } | { kind: 'error'; message: string; terminal: boolean }

/**
 * Orchestrates the role-change action: an ordinary confirm-then-mutate flow
 * that can be interrupted exactly once by an ADR-037 step-up challenge.
 * The role mutation and the step-up mutation are two separate `useMutation`s
 * so each keeps its own `isPending`/error state; this hook only sequences
 * them. `router.refresh()` (not `invalidateQueries()`) re-fetches the Server
 * Component list — `UsersPage` never becomes TanStack Query state.
 */
export function useUserRoleChange(userId: string, targetRole: SystemRole) {
  const router = useRouteProgressRouter()
  const t = useTranslations('console')
  const describeError = useApiError()
  const [stepUp, setStepUp] = useState<StepUpPhase>({ kind: 'closed' })

  const roleMutation = useMutation({
    mutationFn: () => consoleApi.updateUserRole(userId, targetRole),
    onSuccess: () => {
      toast.add({ type: 'success', title: t('usersRoleChanged') })
      router.refresh()
    },
  })

  const stepUpMutation = useMutation({
    mutationFn: (password: string) => consoleApi.stepUp(password),
  })

  async function confirmRoleChange() {
    try {
      await roleMutation.mutateAsync()
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
      await roleMutation.mutateAsync()
      setStepUp({ kind: 'closed' })
    } catch (error) {
      // A second STEP_UP_REQUIRED means the underlying session died between
      // the successful step-up and this retry (e.g. revoked elsewhere) — not
      // something resubmitting the same password again would fix.
      if (getErrorCode(error) === AuthErrorCode.STEP_UP_REQUIRED) {
        setStepUp({ kind: 'error', message: describeError(error).message, terminal: true })
        return
      }
      setStepUp({ kind: 'closed' })
      toast.add({ type: 'error', title: describeError(error).message })
    }
  }

  return {
    confirmRoleChange,
    isSubmitting: roleMutation.isPending,
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
