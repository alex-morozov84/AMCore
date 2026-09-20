'use client'

import type { ReactNode } from 'react'
import { Info } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

export interface InfoTooltipProps {
  /** The explanation shown in the tooltip and used as the trigger's accessible name. */
  label: string
  /** Defaults to a small `Info` glyph; override for a different affordance. */
  icon?: ReactNode
}

/**
 * A small, always-focusable help affordance (icon + tooltip) for a nearby
 * label/value that isn't self-evident — second-layer explanation only, never
 * the sole way to understand what's on screen. Wrapped in its own
 * `TooltipProvider` (0ms delay) so it responds immediately, unlike base-ui's
 * own longer default delay.
 */
export function InfoTooltip({
  label,
  icon = <Info className="size-3.5" aria-hidden="true" />,
}: InfoTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="text-foreground-muted hover:text-foreground"
              aria-label={label}
            />
          }
        >
          {icon}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
