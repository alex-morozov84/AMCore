import type { ComponentProps } from 'react'

import { FilterPanel } from '@/shared/ui/filter-panel'

export function ConsoleFilterPanel(props: ComponentProps<'div'>) {
  return <FilterPanel data-slot="console-filter-panel" {...props} />
}
