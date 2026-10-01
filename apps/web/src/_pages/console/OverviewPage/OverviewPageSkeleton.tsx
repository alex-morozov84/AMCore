import { Skeleton } from '@/shared/ui/skeleton'

const ROWS = [0, 1, 2, 3, 4]

/** Mirrors the header, independent identities, three resource cards and dependencies. */
export function OverviewPageSkeleton() {
  return (
    <section className="flex flex-col gap-4" aria-busy="true">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-9 w-52" />
          <Skeleton className="mt-2 h-5 w-64 max-w-full" />
          <Skeleton className="mt-3 h-5 w-64 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonCard rows={ROWS} />
        <SkeletonCard rows={[0, 1]} />
      </div>
      <Skeleton className="h-5 w-full" />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <SkeletonCard key={card} rows={ROWS} />
        ))}
      </div>
      <SkeletonCard rows={ROWS} />
    </section>
  )
}

function SkeletonCard({ rows }: { rows: number[] }) {
  return (
    <div className="rounded-lg border bg-surface-elevated p-6">
      <Skeleton className="h-6 w-40" />
      {rows.map((row) => (
        <div key={row} className="mt-4 flex justify-between gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  )
}
