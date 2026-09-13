'use client'

import { useTranslations } from 'next-intl'
import { useMutation } from '@tanstack/react-query'
import { LogOutIcon } from 'lucide-react'

import { apiClient } from '@/shared/api'
import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Button } from '@/shared/ui/button'

export function ConsoleLogoutButton() {
  const router = useRouteProgressRouter()
  const t = useTranslations('console')
  const { mutate, isPending } = useMutation({
    mutationFn: () => apiClient.post<void>(getConsolePublicApiPath('/auth/logout')),
    onSettled: () => router.replace('/login'),
  })

  return (
    <Button variant="ghost" size="sm" onClick={() => mutate()} disabled={isPending}>
      <LogOutIcon className="size-4" aria-hidden="true" />
      {isPending ? t('signingOut') : t('signOut')}
    </Button>
  )
}
