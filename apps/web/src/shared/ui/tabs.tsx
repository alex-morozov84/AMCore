'use client'

import type { ComponentProps } from 'react'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'

import { cn } from '@/shared/lib/utils'

type RootProps = Omit<ComponentProps<typeof TabsPrimitive.Root>, 'className'> & {
  className?: string
}
type ListProps = Omit<ComponentProps<typeof TabsPrimitive.List>, 'className'> & {
  className?: string
}
type TriggerProps = Omit<ComponentProps<typeof TabsPrimitive.Tab>, 'className'> & {
  className?: string
}
type ContentProps = Omit<ComponentProps<typeof TabsPrimitive.Panel>, 'className'> & {
  className?: string
}

function Tabs({ className, orientation = 'horizontal', ...props }: RootProps) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      orientation={orientation}
      className={cn('group/tabs flex gap-2 data-[orientation=horizontal]:flex-col', className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: ListProps) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'flex gap-1 rounded-lg bg-muted p-1 group-data-[orientation=vertical]/tabs:flex-col',
        className
      )}
      {...props}
    />
  )
}
function TabsTrigger({ className, ...props }: TriggerProps) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        'flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none data-active:bg-background data-active:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-50 data-disabled:cursor-not-allowed',
        className
      )}
      {...props}
    />
  )
}
function TabsContent({ className, ...props }: ContentProps) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn('outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      {...props}
    />
  )
}
export { Tabs, TabsContent, TabsList, TabsTrigger }
