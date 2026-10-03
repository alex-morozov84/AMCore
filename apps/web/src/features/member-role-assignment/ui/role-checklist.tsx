'use client'
import { useTranslations } from 'next-intl'
import type { MemberRoleSummary } from '@amcore/shared'

import { Checkbox } from '@/shared/ui/checkbox'

export function RoleChecklist({
  roles,
  selected,
  disabled,
  readOnly,
  onChange,
}: {
  roles: MemberRoleSummary[]
  selected: string[]
  disabled: boolean
  readOnly: boolean
  onChange: (ids: string[]) => void
}) {
  const t = useTranslations('organizationMembers')
  return (
    <div className="space-y-3">
      {roles.map((role) => (
        <div key={role.id} className="flex gap-3 rounded-lg border p-3">
          {!readOnly && (
            <Checkbox
              id={`role-${role.id}`}
              checked={selected.includes(role.id)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...new Set([...selected, role.id])]
                    : selected.filter((id) => id !== role.id)
                )
              }
            />
          )}
          <div className="min-w-0 space-y-1">
            {readOnly ? (
              <p className="break-words font-medium">{role.name}</p>
            ) : (
              <label htmlFor={`role-${role.id}`} className="break-words font-medium">
                {role.name}
              </label>
            )}
            <p className="text-xs text-muted-foreground">
              {role.isSystem ? t('system') : t('custom')}
            </p>
            <p className="break-words text-sm text-muted-foreground">
              {role.description ?? t('noDescription')}
            </p>
          </div>
        </div>
      ))}
      {roles.length === 0 && <p className="text-muted-foreground">{t('emptyRoles')}</p>}
    </div>
  )
}
