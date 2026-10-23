import { Skeleton } from '@/shared/ui/skeleton'

const ROWS = [0, 1, 2, 3, 4]

/** Mirrors the header, the data line with its controls, the desktop table and the mobile cards. */
export function IntegrationsPageSkeleton() {
  return (
    <section className="flex flex-col gap-4" aria-busy="true">
      <div>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-9 w-64" />
        <Skeleton className="mt-2 h-5 w-96 max-w-full" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      </div>
      <div className="flex flex-wrap justify-between gap-3" aria-hidden="true">
        <Skeleton className="h-5 w-56 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <div className="hidden rounded-lg border bg-surface-elevated p-4 md:block" aria-hidden="true">
        {ROWS.map((row) => (
          <div key={row} className="flex items-start gap-4 border-b py-4 last:border-b-0">
            <div className="flex-1">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="mt-2 h-4 w-72 max-w-full" />
            </div>
            {[0, 1, 2, 3, 4].map((cell) => (
              <Skeleton key={cell} className="h-5 w-20" />
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 md:hidden" aria-hidden="true">
        {ROWS.map((row) => (
          <div key={row} className="rounded-lg border bg-surface-elevated p-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-2 h-4 w-full" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((cell) => (
                <Skeleton key={cell} className="h-5 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
