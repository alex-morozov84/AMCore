import { Skeleton } from '@/shared/ui/skeleton'

const DEPENDENCY_ROWS = Array.from({ length: 5 }, (_, index) => index)

/** Mirrors the Overview heading and status-card structure. */
export function OverviewPageSkeleton() {
  return (
    <section className="flex flex-col gap-4" aria-busy="true">
      <div>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-9 w-52" />
        <Skeleton className="mt-2 h-5 w-80" />
      </div>
      <div className="rounded-lg border border-border bg-surface-elevated p-6 shadow-md">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-1 h-5 w-24" />
          </div>
          <div>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-1 h-5 w-16" />
          </div>
        </dl>
        <div className="mt-6">
          <Skeleton className="h-3 w-28" />
          <ul className="mt-2 flex flex-col gap-1">
            {DEPENDENCY_ROWS.map((row) => (
              <OverviewDependencySkeleton key={row} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function OverviewDependencySkeleton() {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-line-soft py-1 last:border-0">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-5 w-16" />
    </li>
  )
}
