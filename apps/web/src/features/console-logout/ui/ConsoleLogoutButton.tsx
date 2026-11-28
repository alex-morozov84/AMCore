'use client'

import { useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOutIcon } from 'lucide-react'

import { usePathname } from '@/i18n/navigation'
import { apiClient, getErrorStatus } from '@/shared/api'
import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'
import { getConsoleSignInAgainHref } from '@/shared/lib/console-public-href'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Button } from '@/shared/ui/button'
import { DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import { toast } from '@/shared/ui/toast'

export function ConsoleLogoutButton({
  contextSession,
  menuItem = false,
}: {
  contextSession?: string
  menuItem?: boolean
}) {
  const router = useRouteProgressRouter()
  const t = useTranslations('console')
  const locale = useLocale()
  const pathname = usePathname()
  const queries = useQueryClient()
  const returnId = useRef<string | undefined>(undefined)
  const entryId = useRef<string | undefined>(undefined)
  const navigate = () => {
    queries.clear()
    router.replace(
      `${getConsoleSignInAgainHref()}?entryId=${entryId.current ?? crypto.randomUUID()}` +
        `${returnId.current ? `&returnEntryId=${returnId.current}` : ''}`
    )
  }
  const { mutate, isPending } = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!returnId.current) {
        entryId.current = crypto.randomUUID()
        const entry = await apiClient.post<{ returnEntryId: string }>(
          getConsolePublicApiPath('/auth/sign-in-entry'),
          { destination: pathname, locale },
          { headers: { 'x-amcore-context-session': contextSession ?? '' } }
        )
        returnId.current = entry.returnEntryId
      }
      return apiClient.post<{ state: string }>(
        getConsolePublicApiPath('/auth/logout'),
        { returnEntryId: returnId.current },
        {
          headers: {
            'x-amcore-context-session': contextSession ?? '',
            'x-amcore-return-entry': returnId.current,
          },
        }
      )
    },
    onSuccess: ({ state }) => {
      if (state === 'logged_out') navigate()
      else toast.add({ type: 'warning', title: t('logoutUnconfirmed') })
    },
    onError: (error) => {
      queries.clear()
      const status = getErrorStatus(error)
      const canRetry = !status || ![401, 403, 409].includes(status)
      const id = `console-sign-out:${entryId.current}`
      toast.add({
        id,
        type: 'warning',
        title: t('logoutUnconfirmed'),
        ...(canRetry && {
          timeout: 0,
          actionProps: {
            children: t('retryLogout'),
            onClick: () => {
              toast.close(id)
              mutate()
            },
          },
        }),
      })
    },
  })

  if (menuItem)
    return (
      <DropdownMenuItem onClick={() => mutate()} disabled={isPending}>
        <LogOutIcon className="size-4" aria-hidden="true" />
        {isPending ? t('signingOut') : t('signOut')}
      </DropdownMenuItem>
    )

  return (
    <Button variant="ghost" size="sm" onClick={() => mutate()} disabled={isPending}>
      <LogOutIcon className="size-4" aria-hidden="true" />
      {isPending ? t('signingOut') : t('signOut')}
    </Button>
  )
}
