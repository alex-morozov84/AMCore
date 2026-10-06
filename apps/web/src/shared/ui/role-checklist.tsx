'use client'

import { useId } from 'react'

import { Checkbox } from '@/shared/ui/checkbox'

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
  labels: { system: string; custom: string; noDescription: string; empty: string }
  maxSelected?: number
}) {
  const prefix = useId()
  return (
    <div className="space-y-3">
      {roles.map((role) => (
        <div key={role.id} className="flex gap-3 rounded-lg border p-3">
          {!readOnly && (
            <Checkbox
              id={`${prefix}-${role.id}`}
              checked={selected.includes(role.id)}
              disabled={disabled || (!selected.includes(role.id) && maxSelected !== undefined && selected.length >= maxSelected)}
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
        </div>
      ))}
      {roles.length === 0 && <p className="text-muted-foreground">{labels.empty}</p>}
    </div>
  )
}
