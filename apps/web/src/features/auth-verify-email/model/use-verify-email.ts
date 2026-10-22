'use client'

import type { VerifyEmailInput } from '@amcore/shared'
import { useMutation } from '@tanstack/react-query'

import { type AuthActionBase, authActions } from '@/shared/api/auth-api'

/**
 * Plain `useMutation`, not `useFormMutation` — there is no form here (the
 * token comes from the URL and fires automatically on mount), so there is
 * no `setError`/field to attach a server validation error to.
 */
export function useVerifyEmail(actionBase: AuthActionBase = '/auth') {
  return useMutation({
    mutationFn: (data: VerifyEmailInput) => authActions(actionBase).verifyEmail(data),
  })
}
