'use client'

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import { Input } from '@/shared/ui/input'

const Combobox = ComboboxPrimitive.Root
const ComboboxList = ComboboxPrimitive.List

function ComboboxTrigger({ className, children, ...props }: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      className={cn(
        'flex h-9 min-w-48 cursor-pointer items-center justify-between gap-3 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxInput(props: ComboboxPrimitive.Input.Props) {
  return <ComboboxPrimitive.Input render={<Input />} {...props} />
}

function ComboboxContent({ className, children, ...props }: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner align="start" sideOffset={4} className="z-50 outline-none">
        <ComboboxPrimitive.Popup
          className={cn(
            'flex max-h-(--available-height) w-80 max-w-[calc(100vw-2rem)] min-w-(--anchor-width) flex-col gap-2 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md outline-none',
            className
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-sm py-2 pr-8 pl-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator className="absolute right-2">
        <CheckIcon aria-hidden="true" className="size-4" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

export { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger }
