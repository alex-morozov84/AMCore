// init:project --mode=single: use-login.ts and use-register.ts (nearly
// identical shape). use-logout.ts is a separate file
// (project-plan-web-nav-logout.mjs) to stay under the repo's
// ~150-line-per-file guidance. Import order verified empirically (real
// eslint --fix against a disposable copy) rather than guessed — see
// project-plan-web-nav-links.mjs's header for why that matters here.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const USE_LOGIN_BEFORE = `'use client'

import type { UseFormSetError } from 'react-hook-form'
import type { LoginInput } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { userKeys } from '@/entities/user'
import { useRouter } from '@/i18n/navigation'
import { authApi } from '@/shared/api'
import { useFormMutation } from '@/shared/hooks'

export function useLogin(setError?: UseFormSetError<LoginInput>) {
  const router = useRouter()
  const queryClient = useQueryClient()

  return useFormMutation({
    mutationFn: (data: LoginInput) => authApi.login(data),
    setError, // Automatically set field-level errors from server
    onSuccess: (response) => {
      // The current user is server state — TanStack Query owns it, not a
      // separate client store (ai/models-talk.md "UI-rewiring slice").
      queryClient.setQueryData(userKeys.me(), response)
      // Honour the locale stored on the account, so a user whose preference is
      // Russian does not land on the English default after signing in.
      router.push('/', { locale: response.user.locale })
    },
  })
}
`

const USE_LOGIN_AFTER = `'use client'

import type { UseFormSetError } from 'react-hook-form'
import { useRouter } from 'next/navigation'
import type { LoginInput } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { userKeys } from '@/entities/user'
import { authApi } from '@/shared/api'
import { useFormMutation } from '@/shared/hooks'

export function useLogin(setError?: UseFormSetError<LoginInput>) {
  const router = useRouter()
  const queryClient = useQueryClient()

  return useFormMutation({
    mutationFn: (data: LoginInput) => authApi.login(data),
    setError, // Automatically set field-level errors from server
    onSuccess: (response) => {
      // The current user is server state — TanStack Query owns it, not a
      // separate client store (ai/models-talk.md "UI-rewiring slice").
      queryClient.setQueryData(userKeys.me(), response)
      router.push('/')
    },
  })
}
`

const USE_REGISTER_BEFORE = `'use client'

import type { UseFormSetError } from 'react-hook-form'
import type { RegisterInput } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { userKeys } from '@/entities/user'
import { useRouter } from '@/i18n/navigation'
import { authApi } from '@/shared/api'
import { useFormMutation } from '@/shared/hooks'

export function useRegister(setError?: UseFormSetError<RegisterInput>) {
  const router = useRouter()
  const queryClient = useQueryClient()

  return useFormMutation({
    mutationFn: (data: RegisterInput) => authApi.register(data),
    setError, // Automatically set field-level errors from server
    onSuccess: (response) => {
      // The current user is server state — TanStack Query owns it, not a
      // separate client store (ai/models-talk.md "UI-rewiring slice").
      queryClient.setQueryData(userKeys.me(), response)
      // Honour the locale stored on the account, so a user whose preference is
      // Russian does not land on the English default after signing in.
      router.push('/', { locale: response.user.locale })
    },
  })
}
`

const USE_REGISTER_AFTER = `'use client'

import type { UseFormSetError } from 'react-hook-form'
import { useRouter } from 'next/navigation'
import type { RegisterInput } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { userKeys } from '@/entities/user'
import { authApi } from '@/shared/api'
import { useFormMutation } from '@/shared/hooks'

export function useRegister(setError?: UseFormSetError<RegisterInput>) {
  const router = useRouter()
  const queryClient = useQueryClient()

  return useFormMutation({
    mutationFn: (data: RegisterInput) => authApi.register(data),
    setError, // Automatically set field-level errors from server
    onSuccess: (response) => {
      // The current user is server state — TanStack Query owns it, not a
      // separate client store (ai/models-talk.md "UI-rewiring slice").
      queryClient.setQueryData(userKeys.me(), response)
      router.push('/')
    },
  })
}
`

export function buildWebNavHooksSteps(root) {
  const files = [
    ['apps/web/src/features/auth-login/model/use-login.ts', USE_LOGIN_BEFORE, USE_LOGIN_AFTER],
    [
      'apps/web/src/features/auth-register/model/use-register.ts',
      USE_REGISTER_BEFORE,
      USE_REGISTER_AFTER,
    ],
  ]
  return files.map(([rel, expectedBefore, after]) =>
    exactContentStep(
      path.join(root, rel),
      { expectedBefore, after },
      `drop locale-aware navigation: ${rel}`
    )
  )
}
