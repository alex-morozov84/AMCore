import { useTranslations } from 'next-intl'

import { DataTableSurface } from '@/shared/ui/data-table-surface'
import { Skeleton } from '@/shared/ui/skeleton'

export function MemberListSkeleton() {
  const t = useTranslations('organizationMembers')
  return (
    <div role="status">
      <span className="sr-only">{t('loading')}</span>
      <DataTableSurface className="hidden md:block" aria-hidden="true">
        <div className="space-y-4 p-4">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="grid grid-cols-4 gap-6 border-b border-line-soft py-3">
              <Skeleton className="h-10 motion-reduce:animate-none" />
              <Skeleton className="h-6 motion-reduce:animate-none" />
              <Skeleton className="h-6 motion-reduce:animate-none" />
              <Skeleton className="h-8 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </DataTableSurface>
      <div className="space-y-3 md:hidden" aria-hidden="true">
        {[0, 1, 2].map((row) => (
          <div key={row} className="space-y-3 rounded-xl border bg-card p-6">
            <Skeleton className="h-8 w-2/3 motion-reduce:animate-none" />
            <Skeleton className="h-6 motion-reduce:animate-none" />
            <Skeleton className="h-8 w-1/2 motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </div>
  )
}
