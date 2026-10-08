import { useTranslations } from 'next-intl'

import { DataTableSurface } from '@/shared/ui/data-table-surface'
import { Skeleton } from '@/shared/ui/skeleton'

export function RoleListSkeleton() {
  const t = useTranslations('organizationRoles')
  return (
    <div role="status">
      <span className="sr-only">{t('loading')}</span>
      <DataTableSurface aria-hidden="true">
        <div className="space-y-4 p-4">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="grid grid-cols-4 gap-6 border-b border-line-soft py-3">
              <Skeleton className="h-10 motion-reduce:animate-none" />
              <Skeleton className="h-6 motion-reduce:animate-none" />
              <Skeleton className="h-6 motion-reduce:animate-none" />
              <Skeleton className="h-6 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </DataTableSurface>
    </div>
  )
}
