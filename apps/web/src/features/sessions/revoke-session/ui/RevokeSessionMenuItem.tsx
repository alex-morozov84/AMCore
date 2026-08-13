'use client'

import { useTranslations } from 'next-intl'

import { DropdownMenuItem } from '@/shared/ui/dropdown-menu'

import { useRevokeSession } from '../model/use-revoke-session'

interface RevokeSessionMenuItemProps {
  sessionId: string
}

/**
 * No confirmation dialog — unlike "revoke other sessions" (bulk,
 * affects every other device at once), revoking one row is a routine,
 * easily-recognized table action. The current-session row never renders
 * this item at all (see the sessions table's column definition), so
 * accidentally signing yourself out via this menu isn't reachable.
 */
export function RevokeSessionMenuItem({ sessionId }: RevokeSessionMenuItemProps) {
  const t = useTranslations('sessions')
  const { mutate, isPending } = useRevokeSession()

  return (
    <DropdownMenuItem variant="destructive" disabled={isPending} onClick={() => mutate(sessionId)}>
      {t('revoke')}
    </DropdownMenuItem>
  )
}
