'use client'

import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

import { Button } from './button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './dropdown-menu'

export interface RowActionsMenuProps {
  /** Accessible name for the trigger — not shown visually, read by assistive tech only. */
  label: string
  children: ReactNode
  align?: 'start' | 'end'
}

/**
 * A compact "⋮" trigger for a table row's actions, opening a menu of items.
 * Fixed size regardless of how many items it holds or how long their labels
 * are in any given language, so every row in a column looks identical and
 * adding a second action never reflows the table.
 */
export function RowActionsMenu({ label, children, align = 'end' }: RowActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <span className="sr-only">{label}</span>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
