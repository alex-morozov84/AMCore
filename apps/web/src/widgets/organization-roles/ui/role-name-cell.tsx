'use client'
import { useTranslations } from 'next-intl'
import type { RoleSummary } from '@amcore/shared'

import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip'

const CLAMP_HINT_LENGTH = 80

/** Name opens the role; the description is limited to two lines with the full text on hover or focus. */
export function RoleNameCell({ role, href }: { role: RoleSummary; href: string }) {
  const t = useTranslations('organizationRoles')
  const description = role.description?.trim() || null
  const text = (
    <span className="line-clamp-2 break-words text-left text-sm text-foreground-muted">
      {description ?? t('noDescription')}
    </span>
  )
  return (
    <div className="space-y-1">
      <RouteProgressLink
        href={href}
        aria-label={t('openRoleNamed', { name: role.name })}
        className="break-words font-medium underline-offset-4 hover:underline"
      >
        {role.name}
      </RouteProgressLink>
      {description && description.length > CLAMP_HINT_LENGTH ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<button type="button" className="block w-full" />}>
              {text}
            </TooltipTrigger>
            <TooltipContent className="max-w-sm break-words">{description}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        text
      )}
    </div>
  )
}
