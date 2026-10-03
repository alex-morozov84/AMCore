'use client'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

export function RoleBadges({
  roles,
  empty,
  missingDescription,
}: {
  roles: { id: string; name: string; description?: string | null }[]
  empty: string
  missingDescription?: string
}) {
  if (roles.length === 0) return <span className="text-muted-foreground">{empty}</span>
  return (
    <TooltipProvider>
      <span className="flex flex-wrap gap-1">
        {roles.map((role) =>
          missingDescription !== undefined ? (
            <Tooltip key={role.id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-0.5 text-xs"
                  />
                }
              >
                {role.name}
              </TooltipTrigger>
              <TooltipContent>{role.description || missingDescription}</TooltipContent>
            </Tooltip>
          ) : (
            <span key={role.id} className="rounded border border-border px-2 py-0.5 text-xs">
              {role.name}
            </span>
          )
        )}
      </span>
    </TooltipProvider>
  )
}
