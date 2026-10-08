'use client'
import { useTranslations } from 'next-intl'
import type { RoleSummary } from '@amcore/shared'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip'

/** Notes a reader should see without opening the role; each carries a short explanation. */
export function RoleFlags({ role }: { role: RoleSummary }) {
  const t = useTranslations('organizationRoles')
  const flags: { key: string; label: string; hint: string }[] = []
  if (role.advancedState === 'present')
    flags.push({ key: 'advanced', label: t('flagAdvanced'), hint: t('flagAdvancedHint') })
  if (role.advancedState === 'unknown')
    flags.push({
      key: 'unknown',
      label: t('flagAdvancedUnknown'),
      hint: t('flagAdvancedUnknownHint'),
    })
  if (role.grantsFullControl)
    flags.push({ key: 'full', label: t('flagFullControl'), hint: t('flagFullControlHint') })
  if (flags.length === 0) return null
  return (
    <TooltipProvider>
      <span className="flex flex-wrap gap-1">
        {flags.map((flag) => (
          <Tooltip key={flag.key}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="rounded border border-border px-2 py-0.5 text-xs"
                />
              }
            >
              {flag.label}
            </TooltipTrigger>
            <TooltipContent>{flag.hint}</TooltipContent>
          </Tooltip>
        ))}
      </span>
    </TooltipProvider>
  )
}
