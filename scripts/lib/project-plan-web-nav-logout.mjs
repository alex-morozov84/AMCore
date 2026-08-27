// init:project --mode=single: use-logout.ts. Split from
// project-plan-web-nav-hooks.mjs (use-login/use-register) to stay under
// the repo's ~150-line-per-file guidance. Import order verified
// empirically — see project-plan-web-nav-links.mjs's header.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const USE_LOGOUT_BEFORE = `'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useRouter } from '@/i18n/navigation'
import { authApi } from '@/shared/api'

export function useLogout() {
  const router = useRouter()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      // Clears the cached current-user query along with everything else —
      // the next \`useCurrentUser()\` mount re-fetches and correctly sees no
      // session, rather than serving stale cached user data.
      queryClient.clear()
      router.push('/login')
    },
    onError: () => {
      // Even on error, clear local state
      queryClient.clear()
      router.push('/login')
    },
  })
}
`

const USE_LOGOUT_AFTER = `'use client'

import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { authApi } from '@/shared/api'

export function useLogout() {
  const router = useRouter()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      // Clears the cached current-user query along with everything else —
      // the next \`useCurrentUser()\` mount re-fetches and correctly sees no
      // session, rather than serving stale cached user data.
      queryClient.clear()
      router.push('/login')
    },
    onError: () => {
      // Even on error, clear local state
      queryClient.clear()
      router.push('/login')
    },
  })
}
`

export function buildWebNavLogoutSteps(root) {
  const rel = 'apps/web/src/features/auth-logout/model/use-logout.ts'
  return [
    exactContentStep(
      path.join(root, rel),
      { expectedBefore: USE_LOGOUT_BEFORE, after: USE_LOGOUT_AFTER },
      `drop locale-aware navigation: ${rel}`
    ),
  ]
}
