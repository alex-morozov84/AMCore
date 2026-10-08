'use client'
import { useTranslations } from 'next-intl'
import type { RoleSummary } from '@amcore/shared'

import { useRoleHref } from '@/shared/lib/role-links'
import { DataTableSurface } from '@/shared/ui/data-table-surface'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

/** Platform roles, kept apart from the editable table: readable, never changed or deleted. */
export function BuiltinRoles({ rows }: { rows: RoleSummary[] }) {
  const t = useTranslations('organizationRoles')
  const roleHref = useRoleHref()
  if (rows.length === 0) return null
  return (
    <section aria-labelledby="builtin-roles-title" className="space-y-2">
      <h3 id="builtin-roles-title" className="text-base font-semibold">
        {t('builtinTitle')}
      </h3>
      <p className="text-sm text-muted-foreground">{t('builtinHint')}</p>
      <DataTableSurface>
        <ul className="divide-y divide-line-soft">
          {rows.map((role) => (
            <li
              key={role.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              {roleHref ? (
                <RouteProgressLink
                  href={roleHref(role.id)}
                  aria-label={t('openRoleNamed', { name: role.name })}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {role.name}
                </RouteProgressLink>
              ) : (
                <span className="font-medium">{role.name}</span>
              )}
              <span className="text-sm text-muted-foreground">
                {t('holdersCount', { count: role.holderCount })}
              </span>
            </li>
          ))}
        </ul>
      </DataTableSurface>
    </section>
  )
}
