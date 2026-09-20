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
      <span className="flex size-7 items-center justify-center rounded-md bg-console-accent/8 font-console-mono text-xs font-bold text-console-accent">
        {initialsFor(user)}
      </span>
      <span className="hidden flex-col leading-tight sm:flex">
        <span className="text-xs font-semibold">{user.name || user.email}</span>
        {/* `foreground-faint` fails WCAG AA contrast at this size (2.52:1,
            caught by the Storybook a11y check) - `foreground-muted` is the
            faintest tier that stays AA-safe for normal-size text. */}
        <span className="font-console-mono text-[10px] tracking-wider text-foreground-muted uppercase">
          {t('superAdminRole')}
        </span>
      </span>
    </div>
  )
}
