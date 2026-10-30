'use client'

import { useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOutIcon } from 'lucide-react'

import { usePathname } from '@/i18n/navigation'
import { apiClient } from '@/shared/api'
import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'
import { getConsoleSignInAgainHref } from '@/shared/lib/console-public-href'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Button } from '@/shared/ui/button'
import { DropdownMenuItem } from '@/shared/ui/dropdown-menu'

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
    mutationFn: async () => {
      entryId.current = crypto.randomUUID()
      const entry = await apiClient.post<{ returnEntryId: string }>(
        getConsolePublicApiPath('/auth/sign-in-entry'),
        { destination: pathname, locale },
        { headers: { 'x-amcore-context-session': contextSession ?? '' } }
      )
      returnId.current = entry.returnEntryId
      return apiClient.post(
        getConsolePublicApiPath('/auth/logout'),
        { returnEntryId: entry.returnEntryId },
        {
          headers: {
            'x-amcore-context-session': contextSession ?? '',
            'x-amcore-return-entry': entry.returnEntryId,
          },
        }
      )
    },
    onSuccess: navigate,
    // This deliberate re-entry never claims that an unknown logout succeeded.
    onError: navigate,
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
