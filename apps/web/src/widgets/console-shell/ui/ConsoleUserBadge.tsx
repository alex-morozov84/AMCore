'use client'

import { useTranslations } from 'next-intl'
import type { UserResponse } from '@amcore/shared'

function initialsFor(user: UserResponse): string {
  const source = user.name?.trim() || user.email
  const parts = source.split(/\s+/).filter(Boolean)
  const initials = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2)
  return initials.toUpperCase()
}

/** Chrome only - identity display, never an authorization decision. */
export function ConsoleUserBadge({ user }: { user: UserResponse | null }) {
  const t = useTranslations('console')
  if (!user) return null

  return (
    <div className="flex items-center gap-2">
      <span className="flex size-7 items-center justify-center rounded-md bg-console-accent/8 font-[family-name:var(--console-font-mono)] text-xs font-bold text-console-accent">
        {initialsFor(user)}
      </span>
      <span className="hidden flex-col leading-tight sm:flex">
        <span className="text-xs font-semibold">{user.name || user.email}</span>
        <span className="font-[family-name:var(--console-font-mono)] text-[10px] tracking-[0.05em] text-foreground-faint uppercase">
          {t('superAdminRole')}
        </span>
      </span>
    </div>
  )
}
