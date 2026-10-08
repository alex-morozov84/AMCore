'use client'

import { useId } from 'react'

import { useRoleHref } from '@/shared/lib/role-links'
import { Checkbox } from '@/shared/ui/checkbox'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

type RoleChoice = { id: string; name: string; description: string | null; isSystem: boolean }

export function RoleChecklist({
  roles,
  selected,
  disabled,
  readOnly,
  onChange,
  labels,
  maxSelected,
}: {
  roles: RoleChoice[]
  selected: string[]
  disabled: boolean
  readOnly: boolean
  onChange: (ids: string[]) => void
  labels: {
    system: string
    custom: string
    noDescription: string
    empty: string
    /** Wording of the optional details link; needed only with `roleHref`. */
    details?: string
    detailsFor?: (name: string) => string
  }
  maxSelected?: number
}) {
  const prefix = useId()
  const roleHref = useRoleHref()
  return (
    <div className="space-y-3">
      {roles.map((role) => (
        <div key={role.id} className="flex gap-3 rounded-lg border p-3">
          {!readOnly && (
            <Checkbox
              id={`${prefix}-${role.id}`}
              checked={selected.includes(role.id)}
              disabled={
                disabled ||
                (!selected.includes(role.id) &&
                  maxSelected !== undefined &&
                  selected.length >= maxSelected)
              }
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...new Set([...selected, role.id])]
                    : selected.filter((id) => id !== role.id)
                )
              }
            />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            {readOnly ? (
              <p className="break-words font-medium">{role.name}</p>
            ) : (
              <label htmlFor={`${prefix}-${role.id}`} className="break-words font-medium">
                {role.name}
              </label>
            )}
            <p className="text-xs text-muted-foreground">
              {role.isSystem ? labels.system : labels.custom}
            </p>
            <p className="break-words text-sm text-muted-foreground">
              {role.description ?? labels.noDescription}
            </p>
          </div>
          {roleHref && labels.details && (
            <RouteProgressLink
              href={roleHref(role.id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={labels.detailsFor?.(role.name)}
              className="shrink-0 self-start text-sm underline underline-offset-4"
            >
              {labels.details}
            </RouteProgressLink>
          )}
        </div>
      ))}
      {roles.length === 0 && <p className="text-muted-foreground">{labels.empty}</p>}
    </div>
  )
}
