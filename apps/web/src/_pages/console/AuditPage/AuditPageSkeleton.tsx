import { Skeleton } from '@/shared/ui/skeleton'

import { AuditResultsSkeleton } from './AuditResultsSkeleton'

/** Admission-safe shape of the page; no event or identity data is rendered. */
export function AuditPageSkeleton({ label }: { label: string }) {
  return (
    <section className="space-y-4" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-elevated p-3 shadow-md">
        <Skeleton className="h-5 w-52" />
        <Skeleton className="h-9 w-48" />
      </div>
      <div className="space-y-4 rounded-lg border border-border bg-surface-elevated p-4 shadow-md">
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <AuditResultsSkeleton label={label} />
    </section>
  )
}
