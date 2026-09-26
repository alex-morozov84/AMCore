'use client'

import { useTranslations } from 'next-intl'
import type { SystemRole } from '@amcore/shared'

import { consoleApi } from '@/shared/api/console-api'
import { useStepUpMutation } from '@/shared/lib/console-step-up-mutation'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { toast } from '@/shared/ui/toast'

export type { StepUpPhase } from '@/shared/lib/console-step-up-mutation'

/**
 * Orchestrates the role-change action on top of the shared
 * `useStepUpMutation` (ADR-037). `router.refresh()` (not
 * `invalidateQueries()`) re-fetches the Server Component list —
 * `UsersPage` never becomes TanStack Query state.
 */
export function useUserRoleChange(userId: string, targetRole: SystemRole) {
  const router = useRouteProgressRouter()
  const t = useTranslations('console')

  const { confirm, isSubmitting, stepUp, isSteppingUp, submitStepUp, closeStepUp } =
    useStepUpMutation({
      mutationFn: () => consoleApi.updateUserRole(userId, targetRole),
      onSuccess: () => {
        toast.add({ type: 'success', title: t('usersRoleChanged') })
        router.refresh()
      },
    })

  return {
    confirmRoleChange: confirm,
    isSubmitting,
    stepUp,
    isSteppingUp,
    submitStepUp,
    closeStepUp,
  }
}
