'use client'

import { AUDIT_ACTIONS } from '@amcore/shared'
import { ChevronDown } from 'lucide-react'

import { buttonVariants } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'

import type { AuditCopy } from './audit-copy'

export function AuditActionPicker({
  selected,
  onChange,
  copy,
  locale,
}: {
  selected: string[]
  onChange: (actions: string[]) => void
  copy: AuditCopy
  locale: string
}) {
  const labels = [...AUDIT_ACTIONS].sort((left, right) =>
    copy.actions[left].localeCompare(copy.actions[right], locale)
  )
  const unknown = selected.filter((code) => !AUDIT_ACTIONS.some((known) => known === code))
  const caption =
    selected.length === 0
      ? copy.allActions
      : selected.length === 1
        ? (copy.actions[selected[0] as keyof AuditCopy['actions']] ?? selected[0])
        : `${copy.selectedActions}: ${selected.length}`

  function toggle(code: string, checked: boolean) {
    onChange(checked ? [...selected, code] : selected.filter((item) => item !== code))
  }

  return (
    <div className="space-y-1 text-sm">
      <span className="font-medium">{copy.action}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          className={buttonVariants({
            variant: 'outline',
            className: 'flex h-9 w-full min-w-0 justify-between gap-2',
          })}
        >
          <span className="truncate">{caption}</span>
          <ChevronDown aria-hidden size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-80 min-w-64 overflow-y-auto">
          {selected.length > 0 && (
            <DropdownMenuItem className="cursor-pointer" onClick={() => onChange([])}>
              {copy.clearActions}
            </DropdownMenuItem>
          )}
          {[...unknown, ...labels].map((code) => {
            const checked = selected.includes(code)
            return (
              <DropdownMenuCheckboxItem
                key={code}
                checked={checked}
                closeOnClick={false}
                disabled={!checked && selected.length >= 10}
                onCheckedChange={(next) => toggle(code, next)}
                className="cursor-pointer"
              >
                {copy.actions[code as keyof AuditCopy['actions']] ?? code}
              </DropdownMenuCheckboxItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-xs text-muted-foreground">{copy.actionHelp}</p>
    </div>
  )
}
