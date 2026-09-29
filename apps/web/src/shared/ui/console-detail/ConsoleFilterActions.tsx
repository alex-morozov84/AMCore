import type { ReactNode } from 'react'

/** Distinct reset and submit slots keep each screen's form semantics explicit. */
export function ConsoleFilterActions({ reset, submit }: { reset?: ReactNode; submit?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      {reset ?? <span />}
      {submit}
    </div>
  )
}
